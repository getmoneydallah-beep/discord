import { createHmac, timingSafeEqual } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform, type Readable } from "node:stream";
import { AwsClient } from "aws4fetch";
import type { FastifyInstance } from "fastify";

/**
 * Object storage. Production uses Cloudflare R2 through presigned URLs, so
 * clients upload and download directly and file bytes never pass through the
 * API. Development falls back to the local disk with the same signed-URL flow.
 */
export interface Storage {
  readonly driver: "r2" | "local";
  /** URL the client PUTs the raw bytes to. */
  presignPut(key: string, contentType: string): Promise<{ url: string; headers: Record<string, string> }>;
  /** Short-lived URL to view or download the object. */
  presignGet(key: string, opts?: { filename?: string; download?: boolean; contentType?: string }): Promise<string>;
  /** Object size in bytes, or null if it doesn't exist. */
  head(key: string): Promise<number | null>;
  delete(key: string): Promise<void>;
}

const PUT_TTL = 3 * 3600; // large course videos can take a while on mobile networks
const GET_TTL = 6 * 3600;

/**
 * Sign GET URLs from the start of the current hour so they stay identical for
 * an hour: browsers and CDNs can then cache images and video segments.
 * Every URL is valid for at least GET_TTL - 1h.
 */
function hourBucket(now = Date.now()) {
  return Math.floor(now / 3_600_000) * 3_600_000;
}

function contentDisposition(filename: string, download: boolean) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${download ? "attachment" : "inline"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/* ----------------------------------- R2 ----------------------------------- */

export function r2Storage(cfg: { accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string }): Storage {
  const aws = new AwsClient({
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    service: "s3",
    region: "auto",
  });
  const endpoint = `https://${cfg.accountId}.r2.cloudflarestorage.com/${cfg.bucket}`;
  const objectUrl = (key: string) => `${endpoint}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const amzDate = (ms: number) => new Date(ms).toISOString().replace(/[:-]|\.\d{3}/g, "");

  return {
    driver: "r2",
    async presignPut(key, contentType) {
      const url = new URL(objectUrl(key));
      url.searchParams.set("X-Amz-Expires", String(PUT_TTL));
      const signed = await aws.sign(url.toString(), { method: "PUT", aws: { signQuery: true } });
      // Content-Type is not signed, so the client can send whatever the file is; we record it at upload creation.
      return { url: signed.url, headers: { "content-type": contentType } };
    },
    async presignGet(key, opts = {}) {
      const url = new URL(objectUrl(key));
      url.searchParams.set("X-Amz-Expires", String(GET_TTL));
      if (opts.filename) url.searchParams.set("response-content-disposition", contentDisposition(opts.filename, !!opts.download));
      // Serve the type we validated at upload time, not whatever header the uploader sent with the bytes.
      if (opts.contentType) url.searchParams.set("response-content-type", opts.contentType);
      const signed = await aws.sign(url.toString(), {
        method: "GET",
        aws: { signQuery: true, datetime: amzDate(hourBucket()) },
      });
      return signed.url;
    },
    async head(key) {
      const res = await aws.fetch(objectUrl(key), { method: "HEAD" });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`R2 HEAD failed: ${res.status}`);
      return Number(res.headers.get("content-length") ?? 0);
    },
    async delete(key) {
      const res = await aws.fetch(objectUrl(key), { method: "DELETE" });
      if (!res.ok && res.status !== 404) throw new Error(`R2 DELETE failed: ${res.status}`);
    },
  };
}

/* ------------------------------ local (dev) ------------------------------- */

const MAX_LOCAL_BYTES = 5 * 1024 ** 3;

export interface LocalStorage extends Storage {
  /** Registers the PUT/GET routes that stand in for R2. */
  register(app: FastifyInstance): Promise<void>;
  setBaseUrl(url: string): void;
}

export function localStorage(opts: { dir: string; secret: string; baseUrl: string }): LocalStorage {
  const root = resolve(opts.dir);
  let baseUrl = opts.baseUrl.replace(/\/$/, "");

  const sign = (method: string, key: string, exp: number, extra = "") =>
    createHmac("sha256", opts.secret).update(`${method}\n${key}\n${exp}\n${extra}`).digest("base64url");

  const pathFor = (key: string) => {
    const p = resolve(root, key);
    if (!p.startsWith(root + sep)) throw new Error("invalid key");
    return p;
  };

  const urlFor = (key: string, params: Record<string, string>) =>
    `${baseUrl}/storage/${key.split("/").map(encodeURIComponent).join("/")}?${new URLSearchParams(params)}`;

  const verify = (method: string, key: string, q: Record<string, string | undefined>, extra = q.dl ?? "") => {
    const exp = Number(q.exp);
    if (!q.sig || !exp || exp < Date.now() / 1000) return false;
    const expected = Buffer.from(sign(method, key, exp, extra));
    const got = Buffer.from(q.sig);
    return expected.length === got.length && timingSafeEqual(expected, got);
  };

  const storage: LocalStorage = {
    driver: "local",
    setBaseUrl(url) {
      baseUrl = url.replace(/\/$/, "");
    },
    async presignPut(key, contentType) {
      const exp = Math.floor(Date.now() / 1000) + PUT_TTL;
      // The declared content type is part of the signature: a PUT with any other type is rejected.
      return { url: urlFor(key, { exp: String(exp), sig: sign("PUT", key, exp, contentType) }), headers: { "content-type": contentType } };
    },
    async presignGet(key, o = {}) {
      const exp = Math.floor(hourBucket() / 1000) + GET_TTL;
      const dl = o.filename ? contentDisposition(o.filename, !!o.download) : "";
      return urlFor(key, { exp: String(exp), ...(dl ? { dl } : {}), sig: sign("GET", key, exp, dl) });
    },
    async head(key) {
      try {
        return (await stat(pathFor(key))).size;
      } catch {
        return null;
      }
    },
    async delete(key) {
      await rm(pathFor(key), { force: true });
      await rm(`${pathFor(key)}.meta`, { force: true });
    },

    async register(app) {
      await app.register(async (scoped) => {
        // Accept any body as a raw stream on these routes only.
        scoped.removeAllContentTypeParsers();
        scoped.addContentTypeParser("*", (_req, payload, done) => done(null, payload));

        scoped.put<{ Params: { "*": string }; Querystring: Record<string, string> }>("/storage/*", async (req, reply) => {
          const key = req.params["*"];
          const contentType = String(req.headers["content-type"] ?? "");
          if (!verify("PUT", key, req.query, contentType)) return reply.code(403).send({ error: "invalid_signature" });
          const file = pathFor(key);
          await mkdir(dirname(file), { recursive: true });
          let bytes = 0;
          const limit = new Transform({
            transform(chunk: Buffer, _enc, cb) {
              bytes += chunk.length;
              cb(bytes > MAX_LOCAL_BYTES ? new Error("too large") : null, chunk);
            },
          });
          await pipeline(req.body as Readable, limit, createWriteStream(file));
          await writeFile(`${file}.meta`, JSON.stringify({ contentType }));
          return reply.code(200).send();
        });

        // Supports HTTP Range so <video> can seek.
        scoped.get<{ Params: { "*": string }; Querystring: Record<string, string> }>("/storage/*", async (req, reply) => {
          const key = req.params["*"];
          if (!verify("GET", key, req.query)) return reply.code(403).send({ error: "invalid_signature" });
          const file = pathFor(key);
          let size: number;
          try {
            size = (await stat(file)).size;
          } catch {
            return reply.code(404).send({ error: "not_found" });
          }
          const meta = JSON.parse(await readFile(`${file}.meta`, "utf8").catch(() => "{}")) as { contentType?: string };
          reply.header("content-type", meta.contentType ?? "application/octet-stream");
          reply.header("accept-ranges", "bytes");
          reply.header("cache-control", "private, max-age=3600");
          if (req.query.dl) reply.header("content-disposition", req.query.dl);

          const range = req.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
          if (range && size > 0) {
            let start = range[1] ? Number(range[1]) : size - Number(range[2]);
            let end = range[1] && range[2] ? Number(range[2]) : size - 1;
            start = Math.max(0, start);
            end = Math.min(size - 1, end);
            if (start > end) return reply.code(416).header("content-range", `bytes */${size}`).send();
            reply.code(206).header("content-range", `bytes ${start}-${end}/${size}`).header("content-length", end - start + 1);
            return reply.send(createReadStream(file, { start, end }));
          }
          reply.header("content-length", size);
          return reply.send(createReadStream(file));
        });
      });
    },
  };
  return storage;
}

export const storageKey = (serverId: string, uploadId: string, filename: string) => {
  const ext = (filename.match(/\.([A-Za-z0-9]{1,8})$/)?.[1] ?? "").toLowerCase();
  return join(serverId, ext ? `${uploadId}.${ext}` : uploadId).split(sep).join("/");
};
