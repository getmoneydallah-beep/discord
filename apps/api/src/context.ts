import type { Bus, Scope } from "./bus";
import type { Sql } from "./db";
import type { GatewayHandle } from "./gateway";
import type { Repo } from "./repo";
import type { ServerEvent } from "@majlis/shared";

export interface Ctx {
  sql: Sql;
  repo: Repo;
  bus: Bus;
  gateway: GatewayHandle;
  webUrl: string;
  emit: (scope: Scope, event: ServerEvent) => Promise<void>;
}
