import type { Role } from "./schemas";

const RANK: Record<Role, number> = { owner: 3, admin: 2, member: 1 };

export type Action =
  | "message.send"
  | "message.deleteOthers"
  | "channel.manage"
  | "server.manage"
  | "server.delete"
  | "invite.create"
  | "member.kick"
  | "member.ban"
  | "member.setRole";

const REQUIRED: Record<Action, Role> = {
  "message.send": "member",
  "invite.create": "member",
  "message.deleteOthers": "admin",
  "channel.manage": "admin",
  "server.manage": "admin",
  "member.kick": "admin",
  "member.ban": "admin",
  "member.setRole": "owner",
  "server.delete": "owner",
};

export function can(role: Role, action: Action): boolean {
  return RANK[role] >= RANK[REQUIRED[action]];
}

/** Moderators can only act on members strictly below their own rank. */
export function outranks(actor: Role, target: Role): boolean {
  return RANK[actor] > RANK[target];
}
