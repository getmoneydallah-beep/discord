function required(name: string, fallback?: string): string {
  const v = process.env[name] || fallback;
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

const isProd = process.env.NODE_ENV === "production";

export const config = {
  isProd,
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required("DATABASE_URL", isProd ? undefined : "postgres://majlis:majlis@localhost:5432/majlis"),
  redisUrl: process.env.REDIS_URL || null,
  jwtSecret: required("JWT_SECRET", isProd ? undefined : "dev-secret-do-not-use-in-production"),
  corsOrigins: (process.env.CORS_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  webUrl: process.env.WEB_URL ?? "http://localhost:3000",
  /** Public URL of this API (used for local-storage file URLs). */
  publicUrl: process.env.PUBLIC_API_URL ?? `http://localhost:${process.env.PORT ?? 4000}`,
  /** Cloudflare R2. When unset, files are stored on local disk (dev only). */
  r2: process.env.R2_ACCOUNT_ID
    ? {
        accountId: process.env.R2_ACCOUNT_ID,
        accessKeyId: required("R2_ACCESS_KEY_ID"),
        secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
        bucket: required("R2_BUCKET"),
      }
    : null,
  storageDir: process.env.STORAGE_DIR ?? ".uploads",
  /** Whop (payments). Without WHOP_API_KEY, billing endpoints answer 503 "billing_unavailable". */
  whop: {
    env: (process.env.WHOP_ENV === "production" ? "production" : "sandbox") as "sandbox" | "production",
    apiKey: process.env.WHOP_API_KEY || null,
    accountId: process.env.WHOP_ACCOUNT_ID || null,
    webhookSecret: process.env.WHOP_WEBHOOK_SECRET || null,
  },
  /**
   * Encrypts teachers' Whop API keys at rest (64 hex chars: `openssl rand -hex 32`).
   * Required in production.
   */
  keysEncryptionKey: process.env.WHOP_KEYS_ENCRYPTION_KEY || (isProd ? "" : "dev-only-whop-keys-encryption-key"),
  /** Public https base URL Whop sends teachers' webhooks to (defaults to PUBLIC_API_URL). */
  webhookBaseUrl: process.env.WHOP_WEBHOOK_BASE_URL || process.env.PUBLIC_API_URL || `http://localhost:${process.env.PORT ?? 4000}`,
};

// Local disk storage in production is only allowed when explicitly requested
// (e.g. a single Fly machine with a persistent volume, before R2 is set up).
if (isProd && !config.r2 && process.env.ALLOW_LOCAL_STORAGE !== "true") {
  throw new Error("R2_* env vars are required in production (or set ALLOW_LOCAL_STORAGE=true with a persistent volume)");
}

if (isProd && !/^[0-9a-f]{64}$/i.test(config.keysEncryptionKey)) {
  throw new Error("WHOP_KEYS_ENCRYPTION_KEY (64 hex chars) is required in production");
}

if (isProd && config.jwtSecret.length < 32) {
  throw new Error("JWT_SECRET must be at least 32 characters in production");
}
