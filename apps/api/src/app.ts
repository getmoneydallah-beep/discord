import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import { ZodError } from "zod";
import { createBus, type Bus } from "./bus";
import { config } from "./config";
import type { Ctx } from "./context";
import type { Sql } from "./db";
import { HttpError } from "./errors";
import { registerGateway } from "./gateway";
import { createFiles, startUploadGc } from "./files";
import { createRepo } from "./repo";
import { courseRoutes } from "./routes/courses";
import { uploadRoutes } from "./routes/uploads";
import { localStorage, r2Storage, type Storage } from "./storage";
import { authRoutes } from "./routes/auth";
import { messageRoutes } from "./routes/messages";
import { serverRoutes } from "./routes/servers";
import { billingRoutes, whopWebhookRoutes } from "./routes/billing";
import { createBilling } from "./billing";
import { createWhop, createWhopConnector, WhopError, type WhopApi, type WhopConnector } from "./whop";
import { createSecretBox } from "./crypto";

export interface BuildOptions {
  sql: Sql;
  bus?: Bus;
  storage?: Storage;
  logger?: boolean;
  /** Majlis's own Whop account (teacher plans); null disables plan checkout. Defaults to WHOP_* env vars. */
  whop?: WhopApi | null;
  /** Builds clients for teachers' own Whop accounts from their pasted keys. */
  connector?: WhopConnector | null;
}

export function createWhopFromEnv(): WhopApi | null {
  const { apiKey, accountId, env } = config.whop;
  return apiKey && accountId ? createWhop({ apiKey, accountId, env }) : null;
}

export function createStorage(): Storage {
  return config.r2
    ? r2Storage(config.r2)
    : localStorage({ dir: config.storageDir, secret: config.jwtSecret, baseUrl: config.publicUrl });
}

export async function buildApp({
  sql,
  bus = createBus(config.redisUrl),
  storage = createStorage(),
  logger = true,
  whop = createWhopFromEnv(),
  connector = createWhopConnector(config.whop.env),
}: BuildOptions) {
  const app = Fastify({
    logger: logger
      ? { level: config.isProd ? "info" : "debug", redact: ["req.headers.authorization", "req.body.apiKey", "apiKey"] }
      : false,
    trustProxy: true, // behind Fly's proxy / Cloudflare
    bodyLimit: 1024 * 1024,
  });

  await app.register(cors, {
    origin: config.corsOrigins.length ? config.corsOrigins : true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  });
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      const first = err.issues[0]?.message;
      const code = first && /^[a-z_]+$/.test(first) ? first : "validation_error";
      return reply.code(400).send({ error: code, details: err.issues });
    }
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.code });
    if (err instanceof WhopError) {
      req.log.error({ err }, "whop api error");
      return reply.code(502).send({ error: "checkout_failed" });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.code(status).send({ error: "bad_request", message: (err as Error).message });
    req.log.error(err);
    return reply.code(500).send({ error: "internal_error" });
  });

  const files = createFiles(sql, storage);
  const repo = createRepo(sql, files);
  const gateway = registerGateway(app, { bus, repo });
  const emit: Ctx["emit"] = (scope, event) => bus.publish({ scope, event });
  const billing = createBilling({
    sql,
    whop,
    connector,
    box: createSecretBox(config.keysEncryptionKey),
    webUrl: config.webUrl,
    webhookBaseUrl: config.webhookBaseUrl,
    emit,
    log: app.log,
  });
  const ctx: Ctx = {
    sql,
    repo,
    storage,
    files,
    bus,
    gateway,
    webUrl: config.webUrl,
    emit,
    whop,
    billing,
  };

  app.get("/health", async () => {
    await sql`SELECT 1`;
    return { ok: true };
  });

  authRoutes(app, ctx);
  await app.register(async (scoped) => {
    serverRoutes(scoped, ctx);
  });
  await app.register(async (scoped) => {
    messageRoutes(scoped, ctx);
  });
  await app.register(async (scoped) => {
    uploadRoutes(scoped, ctx);
  });
  await app.register(async (scoped) => {
    courseRoutes(scoped, ctx);
  });
  await app.register(async (scoped) => {
    billingRoutes(scoped, ctx);
  });
  await app.register(async (scoped) => {
    whopWebhookRoutes(scoped, ctx);
  });
  if ("register" in storage) await (storage as ReturnType<typeof localStorage>).register(app);

  const gc = startUploadGc(sql, storage, app.log);
  // Daily check of teachers' Whop keys, so a revoked key pauses selling before a student tries to pay.
  const connectionCheck = setInterval(() => void billing.checkConnections().catch((err: unknown) => app.log.warn({ err }, "whop connection check failed")), 24 * 3_600_000);
  connectionCheck.unref();
  app.decorate("uploadGc", gc);

  app.addHook("onClose", async () => {
    gc.stop();
    clearInterval(connectionCheck);
    await bus.close();
  });

  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    uploadGc: ReturnType<typeof startUploadGc>;
  }
}
