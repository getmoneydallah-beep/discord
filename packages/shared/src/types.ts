import type { ChannelType, Locale, Role } from "./schemas";

export interface User {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface Me extends User {
  email: string;
  locale: Locale;
  createdAt: string;
}

export interface Server {
  id: string;
  name: string;
  iconUrl: string | null;
  ownerId: string;
  createdAt: string;
}

export interface Channel {
  id: string;
  serverId: string;
  name: string;
  type: ChannelType;
  parentId: string | null;
  position: number;
  topic: string | null;
}

export interface Member {
  serverId: string;
  user: User;
  role: Role;
  nickname: string | null;
  joinedAt: string;
}

export interface ReactionSummary {
  emoji: string;
  count: number;
  me: boolean;
}

export interface Message {
  id: string;
  channelId: string;
  serverId: string;
  author: User;
  content: string;
  replyToId: string | null;
  editedAt: string | null;
  createdAt: string;
  reactions: ReactionSummary[];
  nonce?: string;
}

export interface Invite {
  code: string;
  serverId: string;
  serverName: string;
  memberCount: number;
  expiresAt: string | null;
  maxUses: number | null;
  uses: number;
}

export type PresenceStatus = "online" | "offline";

export interface ServerDetail {
  server: Server;
  channels: Channel[];
  members: Member[];
  myRole: Role;
}

export interface AuthResponse {
  token: string;
  user: Me;
}

export interface ApiErrorBody {
  error: string;
  message?: string;
  details?: unknown;
}
