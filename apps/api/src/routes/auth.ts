import type { FastifyInstance } from "fastify";
import { loginSchema, registerSchema, updateMeSchema, newId } from "@majlis/shared";
import { hashPassword, requireAuth, signToken, verifyPassword } from "../auth";
import type { Ctx } from "../context";
import { HttpError } from "../errors";
import { createLimiter } from "../ratelimit";
import { toMe } from "../repo";

export function authRoutes(app: FastifyInstance, ctx: Ctx) {
  const { sql } = ctx;
  const authLimit = createLimiter(10, 60_000);

  app.post("/auth/register", async (req, reply) => {
    authLimit(`ip:${req.ip}`);
    const input = registerSchema.parse(req.body);
    const taken = await sql<{ email: string; username: string }[]>`
      SELECT email, username FROM users WHERE email = ${input.email} OR username = ${input.username}`;
    if (taken.some((r) => r.email.toLowerCase() === input.email)) throw new HttpError(409, "email_taken");
    if (taken.length) throw new HttpError(409, "username_taken");

    const id = newId();
    const passwordHash = await hashPassword(input.password);
    const [row] = await sql`
      INSERT INTO users (id, email, username, display_name, password_hash, locale)
      VALUES (${id}, ${input.email}, ${input.username}, ${input.displayName}, ${passwordHash}, ${input.locale})
      RETURNING *`;
    reply.code(201);
    return { token: await signToken(id), user: toMe(row!) };
  });

  app.post("/auth/login", async (req) => {
    authLimit(`ip:${req.ip}`);
    const input = loginSchema.parse(req.body);
    const [row] = await sql`SELECT * FROM users WHERE email = ${input.email}`;
    if (!row || !(await verifyPassword(input.password, row.passwordHash))) {
      throw new HttpError(401, "invalid_credentials");
    }
    return { token: await signToken(row.id), user: toMe(row) };
  });

  app.get("/me", { preHandler: requireAuth }, async (req) => {
    const [row] = await sql`SELECT * FROM users WHERE id = ${req.userId}`;
    if (!row) throw new HttpError(401, "unauthorized");
    return toMe(row);
  });

  app.patch("/me", { preHandler: requireAuth }, async (req) => {
    const input = updateMeSchema.parse(req.body);
    const [row] = await sql`
      UPDATE users SET
        display_name = COALESCE(${input.displayName ?? null}, display_name),
        locale = COALESCE(${input.locale ?? null}, locale),
        avatar_url = ${input.avatarUrl === undefined ? sql`avatar_url` : input.avatarUrl}
      WHERE id = ${req.userId} RETURNING *`;
    if (!row) throw new HttpError(401, "unauthorized");
    if (input.displayName) ctx.gateway.renameUser(req.userId, input.displayName);
    return toMe(row);
  });

  /**
   * Account deletion (required by the App Store and Google Play).
   * Servers the user owns are deleted; their messages and memberships cascade.
   */
  app.delete("/me", { preHandler: requireAuth }, async (req, reply) => {
    const owned = await sql<{ id: string }[]>`SELECT id FROM servers WHERE owner_id = ${req.userId}`;
    const memberOf = await ctx.repo.userServerIds(req.userId);
    await sql`DELETE FROM users WHERE id = ${req.userId}`;
    for (const s of owned) await ctx.emit({ serverIds: [s.id] }, { t: "SERVER_DELETE", d: { id: s.id } });
    const ownedIds = new Set(owned.map((s) => s.id));
    for (const serverId of memberOf.filter((s) => !ownedIds.has(s))) {
      await ctx.emit({ serverIds: [serverId] }, { t: "MEMBER_REMOVE", d: { serverId, userId: req.userId } });
    }
    ctx.gateway.closeUser(req.userId);
    reply.code(204);
  });
}
