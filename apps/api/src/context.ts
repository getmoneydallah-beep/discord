import type { Bus, Scope } from "./bus";
import type { Sql } from "./db";
import type { GatewayHandle } from "./gateway";
import type { Repo } from "./repo";
import type { Files } from "./files";
import type { Storage } from "./storage";
import type { ServerEvent } from "@majlis/shared";
import type { Billing } from "./billing";
import type { WhopApi } from "./whop";

export interface Ctx {
  sql: Sql;
  repo: Repo;
  storage: Storage;
  files: Files;
  bus: Bus;
  gateway: GatewayHandle;
  webUrl: string;
  emit: (scope: Scope, event: ServerEvent) => Promise<void>;
  whop: WhopApi | null;
  billing: Billing;
}
