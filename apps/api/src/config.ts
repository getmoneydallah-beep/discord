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
  /** Earnings stay pending this many days (refund window) before they can be paid out. */
  payoutHoldDays: Number(process.env.PAYOUT_HOLD_DAYS ?? 14),
  /** Minimum available balance (minor units, e.g. 10000 = 100.00 SAR) before a payout is suggested. */
  payoutMinMinor: Number(process.env.PAYOUT_MIN_MINOR ?? 10_000),
  /** Emails of Majlis staff who can open the owner Payouts page. */
  platformAdminEmails: (process.env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
};

// Local disk storage in production is only allowed when explicitly requested
// (e.g. a single Fly machine with a persistent volume, before R2 is set up).
if (isProd && !config.r2 && process.env.ALLOW_LOCAL_STORAGE !== "true") {
  throw new Error("R2_* env vars are required in production (or set ALLOW_LOCAL_STORAGE=true with a persistent volume)");
}

if (isProd && config.jwtSecret.length < 32) {
  throw new Error("JWT_SECRET must be at least 32 characters in production");
}
