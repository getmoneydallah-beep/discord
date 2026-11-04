import { TIERS, type Channel, type Me, type Member, type Message, type Role, type Server, type TeacherTier, type User } from "@majlis/shared";
import type { Sql } from "./db";
import { forbidden, HttpError, notFound } from "./errors";
import { uploadJson, type Files, type UploadRow } from "./files";

/* ----------------------------- serializers ----------------------------- */

type Row = Record<string, any>;
const iso = (d: Date | string | null) => (d == null ? null : new Date(d).toISOString());

export const toUser = (r: Row): User => ({
  id: r.id,
  username: r.username,
  displayName: r.displayName,
  avatarUrl: r.avatarUrl ?? null,
});

export const toMe = (r: Row): Me => ({
  ...toUser(r),
  email: r.email,
  locale: r.locale,
  createdAt: iso(r.createdAt)!,
});

export const toServer = (r: Row): Server => ({
  id: r.id,
  name: r.name,
  iconUrl: r.iconUrl ?? null,
  ownerId: r.ownerId,
  createdAt: iso(r.createdAt)!,
});

export const toChannel = (r: Row, locked = false): Channel => ({
  id: r.id,
  serverId: r.serverId,
  name: r.name,
  type: r.type,
  parentId: r.parentId ?? null,
  position: r.position,
  topic: r.topic ?? null,
  access: r.access ?? "free",
  locked,
});

/** Entitlement statuses that open content. past_due keeps access during Whop's retry window. */
export const LIVE_ENTITLEMENT = ["active", "trialing", "past_due"] as const;

const toMember = (r: Row): Member => ({
  serverId: r.serverId,
  role: r.role,
  nickname: r.nickname ?? null,
  joinedAt: iso(r.joinedAt)!,
  user: { id: r.userId, username: r.username, displayName: r.displayName, avatarUrl: r.avatarUrl ?? null },
});

const toMessage = (r: Row): Message => ({
  id: r.id,
  channelId: r.channelId,
  serverId: r.serverId,
  content: r.content,
  replyToId: r.replyToId ?? null,
  editedAt: iso(r.editedAt),
  createdAt: iso(r.createdAt)!,
  author: { id: r.authorId, username: r.authorUsername, displayName: r.authorDisplayName, avatarUrl: r.authorAvatarUrl ?? null },
  reactions: r.reactions ?? [],
  attachments: [],
});

/* ------------------------------ queries ------------------------------- */

export function createRepo(sql: Sql, files: Files) {
  async function membership(serverId: string, userId: string): Promise<Role | null> {
    const [row] = await sql<{ role: Role }[]>`
      SELECT role FROM server_members WHERE server_id = ${serverId} AND user_id = ${userId}`;
    return row?.role ?? null;
  }

  /** Throws 404 (not 403) for non-members so server IDs can't be probed. */
  async function requireMember(serverId: string, userId: string): Promise<Role> {
    const role = await membership(serverId, userId);
    if (!role) throw notFound("server_not_found");
    return role;
  }

  async function getChannel(channelId: string): Promise<Channel> {
    const [row] = await sql`SELECT * FROM channels WHERE id = ${channelId}`;
    if (!row) throw notFound("channel_not_found");
    return toChannel(row);
  }

  /** Loads a text channel and the caller's role in its server. */
  async function channelAccess(channelId: string, userId: string) {
    const channel = await getChannel(channelId);
    const role = await membership(channel.serverId, userId);
    if (!role) throw notFound("channel_not_found");
    return { channel, role };
  }

  /**
   * Can this user open a channel's content? Owners/admins always can; free
   * channels are open to members; paid ones need a live entitlement whose
   * offer unlocks the channel or the whole server.
   */
  async function canAccessChannel(channel: Pick<Channel, "id" | "serverId" | "access">, userId: string, role: Role | null) {
    if (!role) return false;
    if (role !== "member" || channel.access !== "paid") return true;
    const [row] = await sql<{ ok: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM entitlements e JOIN offer_grants g ON g.offer_id = e.offer_id
        WHERE e.user_id = ${userId} AND e.server_id = ${channel.serverId}
          AND e.status = ANY(${LIVE_ENTITLEMENT as unknown as string[]})
          AND (e.ends_at IS NULL OR e.ends_at > now())
          AND (g.target_type = 'server' OR (g.target_type = 'channel' AND g.target_id = ${channel.id}))
      ) AS ok`;
    return Boolean(row?.ok);
  }

  /** IDs of the paid channels in a server this user can't open. */
  async function lockedChannelIds(serverId: string, userId: string, role: Role): Promise<Set<string>> {
    if (role !== "member") return new Set();
    const rows = await sql<{ id: string }[]>`
      SELECT c.id FROM channels c
      WHERE c.server_id = ${serverId} AND c.access = 'paid'
        AND NOT EXISTS (
          SELECT 1 FROM entitlements e JOIN offer_grants g ON g.offer_id = e.offer_id
          WHERE e.user_id = ${userId} AND e.server_id = ${serverId}
            AND e.status = ANY(${LIVE_ENTITLEMENT as unknown as string[]})
            AND (e.ends_at IS NULL OR e.ends_at > now())
            AND (g.target_type = 'server' OR (g.target_type = 'channel' AND g.target_id = c.id))
        )`;
    return new Set(rows.map((r) => r.id));
  }

  /** Like channelAccess, but also requires access to the channel's content (403 "locked" otherwise). */
  async function channelContentAccess(channelId: string, userId: string) {
    const access = await channelAccess(channelId, userId);
    if (!(await canAccessChannel(access.channel, userId, access.role))) throw new HttpError(403, "locked");
    return access;
  }

  /** The tier whose limits apply to a teacher right now. */
  async function tierOf(userId: string): Promise<TeacherTier> {
    const [row] = await sql<{ tier: TeacherTier }[]>`
      SELECT tier FROM teacher_subscriptions
      WHERE user_id = ${userId} AND status IN ('trialing', 'active', 'past_due')`;
    return row?.tier ?? "free";
  }

  async function serverOwnerTier(serverId: string) {
    const [row] = await sql<{ ownerId: string }[]>`SELECT owner_id FROM servers WHERE id = ${serverId}`;
    if (!row) throw notFound("server_not_found");
    const tier = await tierOf(row.ownerId);
    return { ownerId: row.ownerId, tier, limits: TIERS[tier] };
  }

  async function getUser(userId: string): Promise<User | null> {
    const [row] = await sql`SELECT id, username, display_name, avatar_url FROM users WHERE id = ${userId}`;
    return row ? toUser(row) : null;
  }

  async function getMember(serverId: string, userId: string): Promise<Member | null> {
    const [row] = await sql`
      SELECT m.server_id, m.user_id, m.role, m.nickname, m.joined_at, u.username, u.display_name, u.avatar_url
      FROM server_members m JOIN users u ON u.id = m.user_id
      WHERE m.server_id = ${serverId} AND m.user_id = ${userId}`;
    return row ? toMember(row) : null;
  }

  async function serverDetail(serverId: string, userId: string) {
    const myRole = await requireMember(serverId, userId);
    const [server] = await sql`SELECT * FROM servers WHERE id = ${serverId}`;
    if (!server) throw notFound("server_not_found");
    const channels = await sql`SELECT * FROM channels WHERE server_id = ${serverId} ORDER BY position, created_at`;
    const locked = await lockedChannelIds(serverId, userId, myRole);
    const members = await sql`
      SELECT m.server_id, m.user_id, m.role, m.nickname, m.joined_at, u.username, u.display_name, u.avatar_url
      FROM server_members m JOIN users u ON u.id = m.user_id
      WHERE m.server_id = ${serverId}
      ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.display_name`;
    return {
      server: toServer(server),
      channels: channels.map((c) => toChannel(c, locked.has(c.id))),
      members: members.map(toMember),
      myRole,
    };
  }

  async function userServerIds(userId: string): Promise<string[]> {
    const rows = await sql<{ serverId: string }[]>`SELECT server_id FROM server_members WHERE user_id = ${userId}`;
    return rows.map((r) => r.serverId);
  }

  /** All users who share at least one server with `userId` (including themselves). */
  async function peers(userId: string): Promise<string[]> {
    const rows = await sql<{ userId: string }[]>`
      SELECT DISTINCT m2.user_id FROM server_members m1
      JOIN server_members m2 ON m2.server_id = m1.server_id
      WHERE m1.user_id = ${userId}`;
    return rows.map((r) => r.userId);
  }

  /**
   * Messages with author and aggregated reactions. `viewerId` decides the
   * per-user `me` flag on reactions.
   */
  async function messages(opts: { channelId?: string; ids?: string[]; before?: string; limit?: number; viewerId: string }) {
    const { channelId, ids, before, limit = 50, viewerId } = opts;
    const rows = await sql`
      SELECT m.id, m.channel_id, c.server_id, m.content, m.reply_to_id, m.edited_at, m.created_at,
             u.id AS author_id, u.username AS author_username, u.display_name AS author_display_name,
             u.avatar_url AS author_avatar_url,
             COALESCE((
               SELECT json_agg(json_build_object('emoji', r.emoji, 'count', r.cnt, 'me', r.me) ORDER BY r.first)
               FROM (
                 SELECT emoji, count(*)::int AS cnt, bool_or(user_id = ${viewerId}) AS me, min(created_at) AS first
                 FROM reactions WHERE message_id = m.id GROUP BY emoji
               ) r
             ), '[]'::json) AS reactions,
             COALESCE((
               SELECT json_agg(${sql.unsafe(uploadJson)} ORDER BY ma.position)
               FROM message_attachments ma JOIN uploads u ON u.id = ma.upload_id
               WHERE ma.message_id = m.id
             ), '[]'::json) AS attachments
      FROM messages m
      JOIN channels c ON c.id = m.channel_id
      JOIN users u ON u.id = m.author_id
      WHERE TRUE
        ${channelId ? sql`AND m.channel_id = ${channelId}` : sql``}
        ${ids ? sql`AND m.id = ANY(${ids})` : sql``}
        ${before ? sql`AND m.id < ${before}` : sql``}
      ORDER BY m.id DESC
      LIMIT ${limit}`;
    return Promise.all(
      rows.map(async (r) => ({
        ...toMessage(r),
        attachments: await Promise.all((r.attachments as UploadRow[]).map(files.toAttachment)),
      })),
    ).then((list) => list.reverse());
  }

  async function message(id: string, viewerId: string): Promise<Message> {
    const [m] = await messages({ ids: [id], viewerId, limit: 1 });
    if (!m) throw notFound("message_not_found");
    return m;
  }

  async function requireOwnerOrAdmin(serverId: string, userId: string) {
    const role = await requireMember(serverId, userId);
    if (role === "member") throw forbidden();
    return role;
  }

  return {
    membership,
    requireMember,
    requireOwnerOrAdmin,
    getChannel,
    channelAccess,
    channelContentAccess,
    canAccessChannel,
    lockedChannelIds,
    tierOf,
    serverOwnerTier,
    getMember,
    getUser,
    serverDetail,
    userServerIds,
    peers,
    messages,
    message,
  };
}

export type Repo = ReturnType<typeof createRepo>;
