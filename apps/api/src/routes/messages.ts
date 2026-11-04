import type { FastifyInstance } from "fastify";
import { can, editMessageSchema, emojiSchema, newId, normalizeArabic, reportSchema, sendMessageSchema } from "@majlis/shared";
import { requireAuth } from "../auth";
import type { Ctx } from "../context";
import { badRequest, forbidden, HttpError } from "../errors";
import { createLimiter } from "../ratelimit";

export function messageRoutes(app: FastifyInstance, ctx: Ctx) {
  const { sql, repo, emit } = ctx;
  app.addHook("preHandler", requireAuth);
  const sendLimit = createLimiter(5, 5_000); // 5 messages / 5s per user
  const reactLimit = createLimiter(20, 10_000);

  app.get<{ Params: { id: string }; Querystring: { before?: string; limit?: string } }>(
    "/channels/:id/messages",
    async (req) => {
      const { channel } = await repo.channelContentAccess(req.params.id, req.userId);
      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
      return repo.messages({ channelId: channel.id, before: req.query.before, limit, viewerId: req.userId });
    },
  );

  app.post<{ Params: { id: string } }>("/channels/:id/messages", async (req, reply) => {
    const { channel, role } = await repo.channelContentAccess(req.params.id, req.userId);
    if (channel.type !== "text" || !can(role, "message.send")) throw forbidden();
    if (channel.postPolicy === "staff" && role === "member") throw new HttpError(403, "staff_only");
    sendLimit(req.userId);
    const input = sendMessageSchema.parse(req.body);
    if (!input.content && input.attachmentIds.length === 0) throw badRequest("empty_message");
    const uploads = await ctx.files.requireUploads(input.attachmentIds, {
      serverId: channel.serverId,
      purposes: ["attachment"],
      ownerId: req.userId,
    });
    if (input.replyToId) {
      const [parent] = await sql`SELECT channel_id FROM messages WHERE id = ${input.replyToId}`;
      if (!parent || parent.channelId !== channel.id) throw badRequest("invalid_reply");
    }
    const id = newId();
    await sql.begin(async (tx) => {
      await tx`
        INSERT INTO messages (id, channel_id, author_id, content, content_norm, reply_to_id)
        VALUES (${id}, ${channel.id}, ${req.userId}, ${input.content}, ${normalizeArabic(input.content)}, ${input.replyToId ?? null})`;
      for (const [position, u] of uploads.entries()) {
        // The primary key stops one upload being attached to two messages at once;
        // the NOT EXISTS stops reuse across messages.
        const inserted = await tx`
          INSERT INTO message_attachments (message_id, upload_id, position)
          SELECT ${id}, ${u.id}, ${position}
          WHERE NOT EXISTS (SELECT 1 FROM message_attachments WHERE upload_id = ${u.id})
          RETURNING 1`;
        if (inserted.length === 0) throw badRequest("invalid_upload");
      }
    });
    const message = { ...(await repo.message(id, req.userId)), nonce: input.nonce };
    await emit({ serverIds: [channel.serverId] }, { t: "MESSAGE_CREATE", d: message });
    reply.code(201);
    return message;
  });

  app.patch<{ Params: { id: string } }>("/messages/:id", async (req) => {
    const existing = await repo.message(req.params.id, req.userId);
    await repo.requireMember(existing.serverId, req.userId);
    if (existing.author.id !== req.userId) throw forbidden();
    const { content } = editMessageSchema.parse(req.body);
    const [row] = await sql<{ editedAt: Date }[]>`
      UPDATE messages SET content = ${content}, content_norm = ${normalizeArabic(content)}, edited_at = now()
      WHERE id = ${existing.id} RETURNING edited_at`;
    const editedAt = row!.editedAt.toISOString();
    await emit(
      { serverIds: [existing.serverId] },
      { t: "MESSAGE_UPDATE", d: { id: existing.id, channelId: existing.channelId, serverId: existing.serverId, content, editedAt } },
    );
    return { ...existing, content, editedAt };
  });

  app.delete<{ Params: { id: string } }>("/messages/:id", async (req, reply) => {
    const existing = await repo.message(req.params.id, req.userId);
    const role = await repo.requireMember(existing.serverId, req.userId);
    if (existing.author.id !== req.userId && !can(role, "message.deleteOthers")) throw forbidden();
    await sql`DELETE FROM messages WHERE id = ${existing.id}`;
    await emit(
      { serverIds: [existing.serverId] },
      { t: "MESSAGE_DELETE", d: { id: existing.id, channelId: existing.channelId, serverId: existing.serverId } },
    );
    reply.code(204);
  });

  app.put<{ Params: { id: string; emoji: string } }>("/messages/:id/reactions/:emoji", async (req, reply) => {
    const emoji = emojiSchema.parse(req.params.emoji);
    const m = await repo.message(req.params.id, req.userId);
    await repo.channelContentAccess(m.channelId, req.userId);
    reactLimit(req.userId);
    const inserted = await sql`
      INSERT INTO reactions (message_id, user_id, emoji) VALUES (${m.id}, ${req.userId}, ${emoji})
      ON CONFLICT DO NOTHING RETURNING 1`;
    if (inserted.length) {
      await emit(
        { serverIds: [m.serverId] },
        { t: "REACTION_ADD", d: { messageId: m.id, channelId: m.channelId, serverId: m.serverId, userId: req.userId, emoji } },
      );
    }
    reply.code(204);
  });

  app.delete<{ Params: { id: string; emoji: string } }>("/messages/:id/reactions/:emoji", async (req, reply) => {
    const emoji = emojiSchema.parse(req.params.emoji);
    const m = await repo.message(req.params.id, req.userId);
    await repo.requireMember(m.serverId, req.userId);
    const deleted = await sql`
      DELETE FROM reactions WHERE message_id = ${m.id} AND user_id = ${req.userId} AND emoji = ${emoji} RETURNING 1`;
    if (deleted.length) {
      await emit(
        { serverIds: [m.serverId] },
        { t: "REACTION_REMOVE", d: { messageId: m.id, channelId: m.channelId, serverId: m.serverId, userId: req.userId, emoji } },
      );
    }
    reply.code(204);
  });

  /** User-generated-content reporting (required by both app stores). */
  app.post<{ Params: { id: string } }>("/messages/:id/report", async (req, reply) => {
    const { reason } = reportSchema.parse(req.body);
    const m = await repo.message(req.params.id, req.userId);
    await repo.requireMember(m.serverId, req.userId);
    await sql`
      INSERT INTO reports (id, message_id, server_id, reporter_id, reported_user_id, content_snapshot, reason)
      VALUES (${newId()}, ${m.id}, ${m.serverId}, ${req.userId}, ${m.author.id}, ${m.content}, ${reason})`;
    reply.code(204);
  });
}
