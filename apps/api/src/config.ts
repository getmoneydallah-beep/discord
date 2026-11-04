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
};

// Local disk storage in production is only allowed when explicitly requested
// (e.g. a single Fly machine with a persistent volume, before R2 is set up).
if (isProd && !config.r2 && process.env.ALLOW_LOCAL_STORAGE !== "true") {
  throw new Error("R2_* env vars are required in production (or set ALLOW_LOCAL_STORAGE=true with a persistent volume)");
}

if (isProd && config.jwtSecret.length < 32) {
  throw new Error("JWT_SECRET must be at least 32 characters in production");
}
