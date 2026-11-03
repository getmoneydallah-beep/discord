import { z } from "zod";

export const LOCALES = ["ar", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export const ROLES = ["owner", "admin", "member"] as const;
export type Role = (typeof ROLES)[number];

export const CHANNEL_TYPES = ["text", "category"] as const;
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
});

export const sendMessageSchema = z.object({
  content: z.string().trim().min(1).max(4000),
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
