import type { Channel, Member, Message, PresenceStatus, Server } from "./types";

/**
 * Real-time gateway protocol (JSON over WebSocket).
 *
 * Client connects to  wss://<api>/gateway?token=<jwt>
 * Server sends READY, then dispatch events for every server the user belongs to.
 * Mutations (send message, etc.) go through REST; the gateway is for push +
 * lightweight ephemeral signals (typing, heartbeat).
 */
export type ServerEvent =
  | { t: "READY"; d: { userId: string; online: string[] } }
  | { t: "MESSAGE_CREATE"; d: Message }
  | { t: "MESSAGE_UPDATE"; d: { id: string; channelId: string; serverId: string; content: string; editedAt: string } }
  | { t: "MESSAGE_DELETE"; d: { id: string; channelId: string; serverId: string } }
  | { t: "REACTION_ADD"; d: ReactionEvent }
  | { t: "REACTION_REMOVE"; d: ReactionEvent }
  | { t: "TYPING_START"; d: { channelId: string; serverId: string; userId: string; displayName: string } }
  | { t: "PRESENCE_UPDATE"; d: { userId: string; status: PresenceStatus } }
  | { t: "CHANNEL_CREATE"; d: Channel }
  | { t: "CHANNEL_DELETE"; d: { id: string; serverId: string } }
  | { t: "CHANNEL_UPDATE"; d: Channel }
  /** Course structure or content changed; clients refetch the course. */
  | { t: "COURSE_UPDATE"; d: { courseId: string; serverId: string } }
  | { t: "MEMBER_ADD"; d: Member }
  | { t: "MEMBER_UPDATE"; d: Member }
  | { t: "MEMBER_REMOVE"; d: { serverId: string; userId: string } }
  | { t: "SERVER_CREATE"; d: Server }
  | { t: "SERVER_UPDATE"; d: Server }
  | { t: "SERVER_DELETE"; d: { id: string } }
  /** The viewer's access in a server changed (purchase, refund, grant, channel made paid/free): refetch it. */
  | { t: "ACCESS_UPDATE"; d: { serverId: string } }
  | { t: "PONG" };

export interface ReactionEvent {
  messageId: string;
  channelId: string;
  serverId: string;
  userId: string;
  emoji: string;
}

export type ClientEvent =
  | { t: "PING" }
  | { t: "TYPING"; d: { channelId: string } };
