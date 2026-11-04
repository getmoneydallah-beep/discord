import type { FileKind, UploadPurpose } from "./media";
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
  /** "paid" channels/courses are only open to holders of an offer that unlocks them. */
  access: "free" | "paid";
  /** True when the viewer cannot open this channel's content (it is paid and they hold no offer for it). */
  locked: boolean;
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
  attachments: Attachment[];
  nonce?: string;
}

/** A stored file. `url` is a short-lived signed URL; refetch to renew. */
export interface Attachment {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  kind: FileKind;
  url: string;
}

export interface Upload extends Attachment {
  purpose: UploadPurpose;
  status: "pending" | "ready";
}

export interface UploadTicket {
  upload: Upload;
  /** PUT the raw file bytes here, with the given headers. */
  put: { url: string; headers: Record<string, string> };
}

/* -------------------------------- courses -------------------------------- */

export interface LessonSummary {
  id: string;
  sectionId: string;
  title: string;
  position: number;
  durationSeconds: number | null;
  hasVideo: boolean;
  attachmentCount: number;
  completed: boolean;
  /** Visitors without access can watch this lesson. */
  freePreview: boolean;
  /** The viewer can't open this lesson. */
  locked: boolean;
}

export interface CourseSection {
  id: string;
  title: string;
  position: number;
  lessons: LessonSummary[];
}

export interface CourseProgress {
  completed: number;
  total: number;
  /** First lesson the viewer hasn't finished (or the first lesson). */
  nextLessonId: string | null;
  /** Most recently watched lesson, for "continue where you left off". */
  lastLessonId: string | null;
}

export interface Course {
  id: string; // same as the channel id
  serverId: string;
  name: string;
  description: string;
  cover: Attachment | null;
  totalDurationSeconds: number;
  sections: CourseSection[];
  progress: CourseProgress;
  access: "free" | "paid";
  locked: boolean;
}

export interface Lesson {
  id: string;
  courseId: string;
  serverId: string;
  sectionId: string;
  title: string;
  body: string;
  video: Attachment | null;
  videoUrl: string | null;
  durationSeconds: number | null;
  attachments: Attachment[];
  completed: boolean;
  positionSeconds: number;
  prevLessonId: string | null;
  nextLessonId: string | null;
  freePreview: boolean;
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
