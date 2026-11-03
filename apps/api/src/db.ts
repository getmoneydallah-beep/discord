import postgres from "postgres";
import { config } from "./config";

export type Sql = postgres.Sql<{}>;

export function createDb(url = config.databaseUrl): Sql {
  return postgres(url, {
    max: 10,
    // snake_case columns in SQL ↔ camelCase in JS
    transform: postgres.camel,
    onnotice: () => {},
  }) as unknown as Sql;
}
