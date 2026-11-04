import { z } from "zod";
import { MAX_ATTACHMENTS, UPLOAD_LIMITS, type UploadPurpose } from "./media";

export const LOCALES = ["ar", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export const ROLES = ["owner", "admin", "member"] as const;
export type Role = (typeof ROLES)[number];

export const CHANNEL_TYPES = ["text", "category", "course"] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];

// Usernames: Latin letters, digits, underscore and dot (handles must be typeable
// on any keyboard). Display names may be any script, including Arabic.
export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_.]{3,32}$/, "invalid_username");

export const registerSchema = z.object({
  email: z.email().trim().toLowerCase(),
  username: usernameSchema,
  displayName: z.string().trim().min(1).max(64),
  password: z.string().min(8).max(128),
  locale: z.enum(LOCALES).default("ar"),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.email().trim().toLowerCase(),
  password: z.string().min(1).max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const updateMeSchema = z.object({
  displayName: z.string().trim().min(1).max(64).optional(),
  locale: z.enum(LOCALES).optional(),
  avatarUrl: z.url().nullable().optional(),
});

export const createServerSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

export const createChannelSchema = z.object({
  name: z.string().trim().min(1).max(100),
  type: z.enum(CHANNEL_TYPES).default("text"),
  parentId: z.string().nullable().optional(),
  topic: z.string().trim().max(1024).optional(),
  /** Course channels only. */
  description: z.string().trim().max(5000).optional(),
  /** "staff" = announcements: only the owner and admins can post. */
  postPolicy: z.enum(["everyone", "staff"]).default("everyone"),
});

export const updateChannelSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  topic: z.string().trim().max(1024).nullable().optional(),
  postPolicy: z.enum(["everyone", "staff"]).optional(),
});

export const sendMessageSchema = z.object({
  // May be empty when the message only carries attachments.
  content: z.string().trim().max(4000).default(""),
  attachmentIds: z.array(z.string()).max(MAX_ATTACHMENTS).default([]),
  replyToId: z.string().nullable().optional(),
  // Client-generated id so optimistic messages can be matched to the server echo.
  nonce: z.string().max(64).optional(),
});

export const editMessageSchema = z.object({
  content: z.string().trim().min(1).max(4000),
});

export const createInviteSchema = z.object({
  maxUses: z.number().int().min(1).max(1000).nullable().optional(),
  expiresInHours: z.number().int().min(1).max(24 * 30).nullable().optional(),
});

export const reportSchema = z.object({
  reason: z.string().trim().min(1).max(1000),
});

export const setRoleSchema = z.object({
  role: z.enum(["admin", "member"]),
});

/** Emoji reactions: a single grapheme up to a modest byte length. */
export const emojiSchema = z.string().min(1).max(32);

/* -------------------------------- uploads -------------------------------- */

export const UPLOAD_PURPOSES = Object.keys(UPLOAD_LIMITS) as UploadPurpose[];

export const createUploadSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  contentType: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/, "invalid_content_type")
    .default("application/octet-stream"),
  size: z.number().int().positive(),
  purpose: z.enum(UPLOAD_PURPOSES as [UploadPurpose, ...UploadPurpose[]]),
});

/* -------------------------------- courses -------------------------------- */

export const createCourseSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(5000).optional(),
});

export const updateCourseSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(5000).optional(),
  coverUploadId: z.string().nullable().optional(),
});

export const sectionSchema = z.object({
  title: z.string().trim().min(1).max(200),
});

export const lessonSchema = z.object({
  sectionId: z.string(),
  title: z.string().trim().min(1).max(200),
  body: z.string().max(20000).default(""),
  /** Uploaded video (R2) … */
  videoUploadId: z.string().nullable().optional(),
  /** … or an embedded YouTube / Vimeo link. */
  videoUrl: z.string().url().max(500).nullable().optional(),
  durationSeconds: z.number().int().min(0).max(24 * 3600).nullable().optional(),
  attachmentIds: z.array(z.string()).max(20).default([]),
});

export const updateLessonSchema = lessonSchema.partial().extend({
  attachmentIds: z.array(z.string()).max(20).optional(),
});

export const courseOrderSchema = z.object({
  sections: z
    .array(z.object({ id: z.string(), lessonIds: z.array(z.string()).max(1000) }))
    .max(200),
});

export const progressSchema = z.object({
  completed: z.boolean().optional(),
  positionSeconds: z.number().min(0).max(24 * 3600).optional(),
  durationSeconds: z.number().min(0).max(24 * 3600).optional(),
});
