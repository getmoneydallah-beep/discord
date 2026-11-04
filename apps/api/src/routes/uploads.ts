import type { FastifyInstance } from "fastify";
import { can, createUploadSchema, fileKind, newId, purposeAccepts, UPLOAD_LIMITS, type UploadTicket } from "@majlis/shared";
import { requireAuth } from "../auth";
import type { Ctx } from "../context";
import { badRequest, forbidden, HttpError, notFound } from "../errors";
import type { UploadRow } from "../files";
import { createLimiter } from "../ratelimit";
import { storageKey } from "../storage";

/**
 * Upload flow (identical for R2 and local dev storage):
 *   1. POST /servers/:id/uploads  → { upload, put: { url, headers } }
 *   2. client PUTs the file bytes straight to put.url (R2)
 *   3. POST /uploads/:id/complete → API verifies the object and marks it ready
 *   4. the upload id is attached to a message, lesson or course cover
 */
export function uploadRoutes(app: FastifyInstance, ctx: Ctx) {
  const { sql, repo, storage, files } = ctx;
  app.addHook("preHandler", requireAuth);
  const limit = createLimiter(60, 60_000);

  app.post<{ Params: { id: string } }>("/servers/:id/uploads", async (req, reply) => {
    const serverId = req.params.id;
    const role = await repo.requireMember(serverId, req.userId);
    const input = createUploadSchema.parse(req.body);
    // Course content can only be uploaded by people who can manage channels.
    if (input.purpose !== "attachment" && !can(role, "channel.manage")) throw forbidden();
    if (input.size > UPLOAD_LIMITS[input.purpose]) throw new HttpError(413, "file_too_large");
    if (!purposeAccepts(input.purpose, input.contentType)) throw badRequest("invalid_file_type");
    limit(req.userId);

    // Storage is paid for by the majlis owner's plan; members' attachments count too.
    const { limits } = await repo.serverOwnerTier(serverId);
    const [{ used } = { used: 0 }] = await sql<{ used: string }[]>`
      SELECT COALESCE(SUM(size), 0) AS used FROM uploads WHERE server_id = ${serverId}`;
    if (Number(used) + input.size > limits.storageGb * 1024 ** 3) throw new HttpError(413, "storage_quota_exceeded");

    const id = newId();
    const key = storageKey(serverId, id, input.filename);
    const [row] = await sql<UploadRow[]>`
      INSERT INTO uploads (id, server_id, owner_id, storage_key, filename, content_type, size, kind, purpose)
      VALUES (${id}, ${serverId}, ${req.userId}, ${key}, ${input.filename}, ${input.contentType}, ${input.size},
              ${fileKind(input.contentType)}, ${input.purpose})
      RETURNING *`;
    const ticket: UploadTicket = {
      upload: await files.toUpload(row!),
      put: await storage.presignPut(key, input.contentType),
    };
    reply.code(201);
    return ticket;
  });

  app.post<{ Params: { id: string } }>("/uploads/:id/complete", async (req) => {
    const [row] = await sql<UploadRow[]>`SELECT * FROM uploads WHERE id = ${req.params.id}`;
    if (!row || row.ownerId !== req.userId) throw notFound("upload_not_found");
    if (row.status === "ready") return files.toUpload(row);

    const size = await storage.head(row.storageKey);
    if (size === null) throw badRequest("upload_missing");
    // Presigned PUTs can't enforce a size, so check what actually arrived.
    if (size > UPLOAD_LIMITS[row.purpose!]) {
      await storage.delete(row.storageKey);
      await sql`DELETE FROM uploads WHERE id = ${row.id}`;
      throw new HttpError(413, "file_too_large");
    }
    const [updated] = await sql<UploadRow[]>`
      UPDATE uploads SET status = 'ready', size = ${size} WHERE id = ${row.id} RETURNING *`;
    return files.toUpload(updated!);
  });

  /** Cancel an upload that hasn't been attached to anything yet. */
  app.delete<{ Params: { id: string } }>("/uploads/:id", async (req, reply) => {
    const [row] = await sql<UploadRow[]>`
      SELECT u.* FROM uploads u WHERE u.id = ${req.params.id}
        AND NOT EXISTS (SELECT 1 FROM message_attachments x WHERE x.upload_id = u.id)
        AND NOT EXISTS (SELECT 1 FROM lesson_attachments x WHERE x.upload_id = u.id)
        AND NOT EXISTS (SELECT 1 FROM lessons x WHERE x.video_upload_id = u.id)
        AND NOT EXISTS (SELECT 1 FROM courses x WHERE x.cover_upload_id = u.id)`;
    if (!row || row.ownerId !== req.userId) throw notFound("upload_not_found");
    await storage.delete(row.storageKey);
    await sql`DELETE FROM uploads WHERE id = ${row.id}`;
    reply.code(204);
  });
}
