import { buildApp } from "./app";
import { config } from "./config";
import { createDb } from "./db";

const sql = createDb();
const app = await buildApp({ sql });

const shutdown = async () => {
  await app.close();
  await sql.end({ timeout: 5 });
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

await app.listen({ port: config.port, host: process.env.HOST ?? "0.0.0.0" });
