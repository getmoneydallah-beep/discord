import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDb, type Sql } from "./db";

const here = dirname(fileURLToPath(import.meta.url));
// src/ in dev, dist/ in production; migrations/ sits next to both.
const MIGRATIONS_DIR = join(here, "..", "migrations");

export async function migrate(sql: Sql, log: (msg: string) => void = console.log) {
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
  // Serialize concurrent migrators (e.g. several instances booting at once).
  await sql`SELECT pg_advisory_lock(727274)`;
  try {
    const rows = await sql<{ name: string }[]>`SELECT name FROM schema_migrations`;
    const applied = new Set(rows.map((r) => r.name));
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      if (applied.has(file)) continue;
      const body = await readFile(join(MIGRATIONS_DIR, file), "utf8");
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`INSERT INTO schema_migrations (name) VALUES (${file})`;
      });
      log(`applied ${file}`);
    }
  } finally {
    await sql`SELECT pg_advisory_unlock(727274)`;
  }
}

// Run directly: `pnpm db:migrate` or `node dist/migrate.js`
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const sql = createDb();
  migrate(sql)
    .then(() => console.log("migrations up to date"))
    .catch((err: unknown) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => sql.end());
}
