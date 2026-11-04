import type { FastifyBaseLogger } from "fastify";
import type { Attachment, FileKind, Upload, UploadPurpose } from "@majlis/shared";
import type { Sql } from "./db";
import { badRequest } from "./errors";
import type { Storage } from "./storage";

/** Shape the SQL helpers below select (json keys are camelCase). */
export interface UploadRow {
  id: string;
  storageKey: string;
  filename: string;
  contentType: string;
  size: number | string;
  kind: FileKind;
  purpose?: UploadPurpose;
  status?: "pending" | "ready";
  serverId?: string | null;
  ownerId?: string | null;
}

/** SQL fragment: json object for an uploads row aliased `u`. */
export const uploadJson = `json_build_object(
  'id', u.id, 'storageKey', u.storage_key, 'filename', u.filename,
  'contentType', u.content_type, 'size', u.size, 'kind', u.kind)`;

export function createFiles(sql: Sql, storage: Storage) {
  async function toAttachment(row: UploadRow): Promise<Attachment> {
    return {
      id: row.id,
      filename: row.filename,
      contentType: row.contentType,
      size: Number(row.size),
      kind: row.kind,
      // Plain files download with their original (possibly Arabic) name; media plays inline.
      url: await storage.presignGet(row.storageKey, { filename: row.filename, download: row.kind === "file" }),
    };
  }

  async function toUpload(row: UploadRow): Promise<Upload> {
    return { ...(await toAttachment(row)), purpose: row.purpose!, status: row.status! };
  }

  /**
   * Loads uploads by id and checks they can be attached: same server, ready,
   * and an allowed purpose. Returns them in the requested order.
   */
  async function requireUploads(
    ids: string[],
    opts: { serverId: string; purposes: UploadPurpose[]; ownerId?: string },
  ): Promise<UploadRow[]> {
    if (ids.length === 0) return [];
    if (new Set(ids).size !== ids.length) throw badRequest("duplicate_upload");
    const rows = await sql<UploadRow[]>`SELECT * FROM uploads WHERE id = ANY(${ids})`;
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids.map((id) => {
      const r = byId.get(id);
      if (
        !r ||
        r.serverId !== opts.serverId ||
        r.status !== "ready" ||
        !opts.purposes.includes(r.purpose!) ||
        (opts.ownerId && r.ownerId !== opts.ownerId)
      ) {
        throw badRequest("invalid_upload");
      }
      return r;
    });
  }

  return { toAttachment, toUpload, requireUploads };
}

export type Files = ReturnType<typeof createFiles>;

/**
 * Garbage collector: deletes R2 objects nobody references any more —
 * abandoned uploads, files of deleted messages/lessons, and everything from
 * deleted servers. Uploads younger than 24h are kept so in-progress
 * messages and lessons can still attach them.
 */
export function startUploadGc(sql: Sql, storage: Storage, log: FastifyBaseLogger, intervalMs = 3_600_000) {
  async function sweep() {
    const [{ locked } = { locked: false }] = await sql<{ locked: boolean }[]>`SELECT pg_try_advisory_lock(727275) AS locked`;
    if (!locked) return 0;
    try {
      const rows = await sql<{ id: string; storageKey: string }[]>`
        SELECT u.id, u.storage_key FROM uploads u
        WHERE u.created_at < now() - interval '24 hours'
          AND NOT EXISTS (SELECT 1 FROM message_attachments x WHERE x.upload_id = u.id)
          AND NOT EXISTS (SELECT 1 FROM lesson_attachments x WHERE x.upload_id = u.id)
          AND NOT EXISTS (SELECT 1 FROM lessons x WHERE x.video_upload_id = u.id)
          AND NOT EXISTS (SELECT 1 FROM courses x WHERE x.cover_upload_id = u.id)
        LIMIT 500`;
      for (const r of rows) {
        await storage.delete(r.storageKey);
        await sql`DELETE FROM uploads WHERE id = ${r.id}`;
      }
      if (rows.length) log.info({ count: rows.length }, "upload gc: deleted unreferenced files");
      return rows.length;
    } finally {
      await sql`SELECT pg_advisory_unlock(727275)`;
    }
  }
  const timer = setInterval(() => void sweep().catch((err: unknown) => log.error({ err }, "upload gc failed")), intervalMs);
  timer.unref();
  return { sweep, stop: () => clearInterval(timer) };
}
