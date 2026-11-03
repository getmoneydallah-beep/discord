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
};

if (isProd && config.jwtSecret.length < 32) {
  throw new Error("JWT_SECRET must be at least 32 characters in production");
}
