import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  can,
  createChannelSchema,
  createInviteSchema,
  createServerSchema,
  newId,
  normalizeArabic,
  outranks,
  setRoleSchema,
  type Invite,
} from "@majlis/shared";
import { requireAuth } from "../auth";
import type { Ctx } from "../context";
import { badRequest, forbidden, HttpError, notFound } from "../errors";
import { toChannel, toServer } from "../repo";

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
function inviteCode(len = 8) {
  const bytes = randomBytes(len);
  let s = "";
  for (const b of bytes) s += BASE62[b % 62];
  return s;
}

/** Channel names: trim, collapse whitespace to "-", keep any script (Arabic included). */
function channelName(name: string) {
  return name.trim().replace(/\s+/g, "-").slice(0, 100);
}

export function serverRoutes(app: FastifyInstance, ctx: Ctx) {
  const { sql, repo, emit } = ctx;
  app.addHook("preHandler", requireAuth);

  app.get("/servers", async (req) => {
    const rows = await sql`
      SELECT s.* FROM servers s JOIN server_members m ON m.server_id = s.id
      WHERE m.user_id = ${req.userId} ORDER BY m.joined_at`;
    return rows.map(toServer);
  });

  app.post("/servers", async (req, reply) => {
    const { name } = createServerSchema.parse(req.body);
    const serverId = newId();
    await sql.begin(async (tx) => {
      await tx`INSERT INTO servers (id, name, owner_id) VALUES (${serverId}, ${name}, ${req.userId})`;
      await tx`INSERT INTO server_members (server_id, user_id, role) VALUES (${serverId}, ${req.userId}, 'owner')`;
      // Default channel: "عام" (general)
      await tx`INSERT INTO channels (id, server_id, name, position) VALUES (${newId()}, ${serverId}, 'عام', 0)`;
    });
    const detail = await repo.serverDetail(serverId, req.userId);
    await emit({ userIds: [req.userId] }, { t: "SERVER_CREATE", d: detail.server });
    reply.code(201);
    return detail;
  });

  app.get<{ Params: { id: string } }>("/servers/:id", async (req) => repo.serverDetail(req.params.id, req.userId));

  app.patch<{ Params: { id: string } }>("/servers/:id", async (req) => {
    const role = await repo.requireMember(req.params.id, req.userId);
    if (!can(role, "server.manage")) throw forbidden();
    const { name } = createServerSchema.parse(req.body);
    const [row] = await sql`UPDATE servers SET name = ${name} WHERE id = ${req.params.id} RETURNING *`;
    const server = toServer(row!);
    await emit({ serverIds: [server.id] }, { t: "SERVER_UPDATE", d: server });
    return server;
  });

  app.delete<{ Params: { id: string } }>("/servers/:id", async (req, reply) => {
    const role = await repo.requireMember(req.params.id, req.userId);
    if (!can(role, "server.delete")) throw forbidden();
    await sql`DELETE FROM servers WHERE id = ${req.params.id}`;
    await emit({ serverIds: [req.params.id] }, { t: "SERVER_DELETE", d: { id: req.params.id } });
    reply.code(204);
  });

  /* ------------------------------ channels ------------------------------ */

  app.post<{ Params: { id: string } }>("/servers/:id/channels", async (req, reply) => {
    const serverId = req.params.id;
    const role = await repo.requireMember(serverId, req.userId);
    if (!can(role, "channel.manage")) throw forbidden();
    const input = createChannelSchema.parse(req.body);
    if (input.parentId) {
      const parent = await repo.getChannel(input.parentId);
      if (parent.serverId !== serverId || parent.type !== "category") throw badRequest("invalid_parent");
    }
    const [{ next } = { next: 0 }] = await sql<{ next: number }[]>`
      SELECT COALESCE(MAX(position) + 1, 0)::int AS next FROM channels WHERE server_id = ${serverId}`;
    const [row] = await sql`
      INSERT INTO channels (id, server_id, name, type, parent_id, position, topic)
      VALUES (${newId()}, ${serverId}, ${channelName(input.name)}, ${input.type}, ${input.parentId ?? null}, ${next}, ${input.topic ?? null})
      RETURNING *`;
    const channel = toChannel(row!);
    await emit({ serverIds: [serverId] }, { t: "CHANNEL_CREATE", d: channel });
    reply.code(201);
    return channel;
  });

  app.delete<{ Params: { id: string } }>("/channels/:id", async (req, reply) => {
    const { channel, role } = await repo.channelAccess(req.params.id, req.userId);
    if (!can(role, "channel.manage")) throw forbidden();
    await sql`DELETE FROM channels WHERE id = ${channel.id}`;
    await emit({ serverIds: [channel.serverId] }, { t: "CHANNEL_DELETE", d: { id: channel.id, serverId: channel.serverId } });
    reply.code(204);
  });

  /* --------------------------- members & moderation --------------------------- */

  async function removeMember(serverId: string, userId: string) {
    await sql`DELETE FROM server_members WHERE server_id = ${serverId} AND user_id = ${userId}`;
    await emit({ serverIds: [serverId] }, { t: "MEMBER_REMOVE", d: { serverId, userId } });
  }

  app.delete<{ Params: { id: string; userId: string } }>("/servers/:id/members/:userId", async (req, reply) => {
    const serverId = req.params.id;
    const myRole = await repo.requireMember(serverId, req.userId);
    const targetId = req.params.userId === "@me" ? req.userId : req.params.userId;

    if (targetId === req.userId) {
      // Leaving. The owner must delete the server (or transfer ownership, later).
      if (myRole === "owner") throw new HttpError(400, "owner_cannot_leave");
    } else {
      const targetRole = await repo.membership(serverId, targetId);
      if (!targetRole) throw notFound("member_not_found");
      if (!can(myRole, "member.kick") || !outranks(myRole, targetRole)) throw forbidden();
    }
    await removeMember(serverId, targetId);
    reply.code(204);
  });

  app.put<{ Params: { id: string; userId: string } }>("/servers/:id/bans/:userId", async (req, reply) => {
    const { id: serverId, userId: targetId } = req.params;
    const myRole = await repo.requireMember(serverId, req.userId);
    const targetRole = await repo.membership(serverId, targetId);
    if (!can(myRole, "member.ban") || targetId === req.userId) throw forbidden();
    if (targetRole && !outranks(myRole, targetRole)) throw forbidden();
    await sql`
      INSERT INTO server_bans (server_id, user_id, banned_by) VALUES (${serverId}, ${targetId}, ${req.userId})
      ON CONFLICT DO NOTHING`;
    if (targetRole) await removeMember(serverId, targetId);
    reply.code(204);
  });

  app.patch<{ Params: { id: string; userId: string } }>("/servers/:id/members/:userId", async (req) => {
    const { id: serverId, userId: targetId } = req.params;
    const myRole = await repo.requireMember(serverId, req.userId);
    if (!can(myRole, "member.setRole")) throw forbidden();
    const { role } = setRoleSchema.parse(req.body);
    const targetRole = await repo.membership(serverId, targetId);
    if (!targetRole) throw notFound("member_not_found");
    if (targetRole === "owner") throw forbidden();
    await sql`UPDATE server_members SET role = ${role} WHERE server_id = ${serverId} AND user_id = ${targetId}`;
    const member = (await repo.getMember(serverId, targetId))!;
    await emit({ serverIds: [serverId] }, { t: "MEMBER_UPDATE", d: member });
    return member;
  });

  /* ------------------------------- invites ------------------------------- */

  async function inviteInfo(code: string): Promise<Invite | null> {
    const [row] = await sql`
      SELECT i.*, s.name AS server_name,
        (SELECT count(*)::int FROM server_members m WHERE m.server_id = i.server_id) AS member_count
      FROM invites i JOIN servers s ON s.id = i.server_id
      WHERE i.code = ${code}
        AND (i.expires_at IS NULL OR i.expires_at > now())
        AND (i.max_uses IS NULL OR i.uses < i.max_uses)`;
    if (!row) return null;
    return {
      code: row.code,
      serverId: row.serverId,
      serverName: row.serverName,
      memberCount: row.memberCount,
      expiresAt: row.expiresAt ? new Date(row.expiresAt).toISOString() : null,
      maxUses: row.maxUses ?? null,
      uses: row.uses,
    };
  }

  app.post<{ Params: { id: string } }>("/servers/:id/invites", async (req, reply) => {
    const serverId = req.params.id;
    const role = await repo.requireMember(serverId, req.userId);
    if (!can(role, "invite.create")) throw forbidden();
    const input = createInviteSchema.parse(req.body ?? {});
    const code = inviteCode();
    const expiresAt = input.expiresInHours ? new Date(Date.now() + input.expiresInHours * 3_600_000) : null;
    await sql`
      INSERT INTO invites (code, server_id, inviter_id, max_uses, expires_at)
      VALUES (${code}, ${serverId}, ${req.userId}, ${input.maxUses ?? null}, ${expiresAt})`;
    reply.code(201);
    return { ...(await inviteInfo(code))!, url: `${ctx.webUrl}/invite/${code}` };
  });

  app.get<{ Params: { code: string } }>("/invites/:code", async (req) => {
    const invite = await inviteInfo(req.params.code);
    if (!invite) throw notFound("invalid_invite");
    return invite;
  });

  app.post<{ Params: { code: string } }>("/invites/:code", async (req) => {
    const invite = await inviteInfo(req.params.code);
    if (!invite) throw notFound("invalid_invite");
    const serverId = invite.serverId;
    if (await repo.membership(serverId, req.userId)) return repo.serverDetail(serverId, req.userId);
    const [ban] = await sql`SELECT 1 FROM server_bans WHERE server_id = ${serverId} AND user_id = ${req.userId}`;
    if (ban) throw new HttpError(403, "banned");

    const joined = await sql.begin(async (tx) => {
      // Re-check the use limit atomically.
      const updated = await tx`
        UPDATE invites SET uses = uses + 1
        WHERE code = ${invite.code} AND (max_uses IS NULL OR uses < max_uses) RETURNING code`;
      if (updated.length === 0) return false;
      await tx`INSERT INTO server_members (server_id, user_id) VALUES (${serverId}, ${req.userId}) ON CONFLICT DO NOTHING`;
      return true;
    });
    if (!joined) throw notFound("invalid_invite");

    const member = (await repo.getMember(serverId, req.userId))!;
    await emit({ serverIds: [serverId] }, { t: "MEMBER_ADD", d: member });

    // Presence: the joiner may have connected before sharing any server with
    // these members, so neither side has seen the other's status yet.
    const detail = await repo.serverDetail(serverId, req.userId);
    const online = await ctx.bus.online(detail.members.map((m) => m.user.id));
    for (const userId of online) {
      if (userId === req.userId) continue;
      await emit({ userIds: [req.userId] }, { t: "PRESENCE_UPDATE", d: { userId, status: "online" } });
    }
    if (online.includes(req.userId)) {
      await emit({ serverIds: [serverId] }, { t: "PRESENCE_UPDATE", d: { userId: req.userId, status: "online" } });
    }
    return detail;
  });

  /* ------------------------------- search -------------------------------- */

  app.get<{ Params: { id: string }; Querystring: { q?: string } }>("/servers/:id/search", async (req) => {
    const serverId = req.params.id;
    await repo.requireMember(serverId, req.userId);
    // Arabic-aware: normalise the query exactly like stored content, then prefix-match each word.
    const terms = normalizeArabic(req.query.q ?? "")
      .split(" ")
      .map((t) => t.replace(/[^\p{L}\p{N}_]/gu, ""))
      .filter(Boolean)
      .slice(0, 8);
    if (terms.length === 0) return [];
    const tsquery = terms.map((t) => `${t}:*`).join(" & ");
    const rows = await sql<{ id: string }[]>`
      SELECT m.id FROM messages m JOIN channels c ON c.id = m.channel_id
      WHERE c.server_id = ${serverId} AND m.search @@ to_tsquery('simple', ${tsquery})
      ORDER BY m.id DESC LIMIT 25`;
    if (rows.length === 0) return [];
    return repo.messages({ ids: rows.map((r) => r.id), viewerId: req.userId, limit: 25 });
  });
}
