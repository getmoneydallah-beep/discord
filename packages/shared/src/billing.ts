import { z } from "zod";

/* ------------------------------ teacher plans ------------------------------ */

export const TEACHER_TIERS = ["free", "starter", "pro", "academy"] as const;
export type TeacherTier = (typeof TEACHER_TIERS)[number];
export const PAID_TIERS = ["starter", "pro", "academy"] as const;
export type PaidTier = (typeof PAID_TIERS)[number];
export const BILLING_INTERVALS = ["monthly", "yearly"] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

export interface TierLimits {
  /** Plan price in US dollars (major units). Yearly = 10 months (two months free). */
  priceUsd: Record<BillingInterval, number>;
  maxOwnedServers: number;
  canSell: boolean;
  /** null = unlimited */
  maxOffersPerServer: number | null;
  storageGb: number;
}

export const TIERS: Record<TeacherTier, TierLimits> = {
  free: { priceUsd: { monthly: 0, yearly: 0 }, maxOwnedServers: 1, canSell: false, maxOffersPerServer: 0, storageGb: 2 },
  starter: { priceUsd: { monthly: 29, yearly: 290 }, maxOwnedServers: 1, canSell: true, maxOffersPerServer: 3, storageGb: 50 },
  pro: { priceUsd: { monthly: 79, yearly: 790 }, maxOwnedServers: 3, canSell: true, maxOffersPerServer: null, storageGb: 300 },
  academy: { priceUsd: { monthly: 199, yearly: 1990 }, maxOwnedServers: 10, canSell: true, maxOffersPerServer: null, storageGb: 1024 },
};

export const TRIAL_DAYS = 14;

export type SubscriptionStatus = "none" | "trialing" | "active" | "past_due" | "canceled" | "expired";

export interface BillingInfo {
  /** The tier whose limits apply right now (free unless a subscription is trialing/active/past_due). */
  tier: TeacherTier;
  subscription: {
    tier: PaidTier;
    interval: BillingInterval | null;
    status: SubscriptionStatus;
    trialEndsAt: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    manageUrl: string | null;
  } | null;
  limits: TierLimits;
  usage: { ownedServers: number };
  tiers: Record<TeacherTier, TierLimits>;
}

export const teacherCheckoutSchema = z.object({
  tier: z.enum(PAID_TIERS),
  interval: z.enum(BILLING_INTERVALS).default("monthly"),
});

/* --------------------------------- offers --------------------------------- */

export const OFFER_BILLING = ["one_time", "monthly", "yearly"] as const;
export type OfferBilling = (typeof OFFER_BILLING)[number];
export const OFFER_CURRENCIES = ["sar", "usd"] as const;
export type OfferCurrency = (typeof OFFER_CURRENCIES)[number];
export type ChannelAccess = "free" | "paid";

export interface OfferGrant {
  targetType: "server" | "channel";
  /** server id for "server", channel (or course) id for "channel" */
  targetId: string;
}

export interface Offer {
  id: string;
  serverId: string;
  name: string;
  description: string;
  priceMinor: number;
  currency: OfferCurrency;
  billing: OfferBilling;
  trialDays: number | null;
  seatLimit: number | null;
  seatsTaken: number;
  active: boolean;
  position: number;
  grants: OfferGrant[];
  /** The viewer already holds this offer. */
  owned: boolean;
}

const grantSchema = z.object({ targetType: z.enum(["server", "channel"]), targetId: z.string().min(1) });

export const offerSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(2000).default(""),
  // At least 1.00 in the offer currency, at most 100,000.00.
  priceMinor: z.number().int().min(100).max(10_000_000),
  currency: z.enum(OFFER_CURRENCIES).default("sar"),
  billing: z.enum(OFFER_BILLING),
  trialDays: z.number().int().min(1).max(90).nullable().optional(),
  seatLimit: z.number().int().min(1).max(1_000_000).nullable().optional(),
  grants: z.array(grantSchema).min(1, "offer_needs_grant").max(100),
});
export type OfferInput = z.infer<typeof offerSchema>;

export const updateOfferSchema = offerSchema.partial().extend({ active: z.boolean().optional() });

export const channelAccessSchema = z.object({ access: z.enum(["free", "paid"]) });
export const lessonPreviewSchema = z.object({ freePreview: z.boolean() });

export const manualGrantSchema = z.object({ userId: z.string().min(1), offerId: z.string().min(1) });

export type EntitlementStatus = "active" | "trialing" | "past_due" | "canceled" | "expired" | "revoked";

export interface Entitlement {
  id: string;
  offerId: string;
  offerName: string;
  serverId: string;
  user: { id: string; username: string; displayName: string; avatarUrl: string | null };
  source: "whop" | "manual";
  status: EntitlementStatus;
  startsAt: string;
  endsAt: string | null;
}

export interface CheckoutResponse {
  url: string;
}

/* ------------------------- teacher's own Whop account ------------------------- */

export type WhopConnectionStatus = "active" | "broken" | "disconnected";

export interface WhopConnection {
  status: WhopConnectionStatus;
  accountId: string;
  accountTitle: string;
  /** Last 4 characters of the pasted key; the key itself is never sent back. */
  keyLast4: string | null;
  /** False in local dev when no public https URL exists for Whop to call. */
  webhookActive: boolean;
  lastError: string | null;
  missingPermissions: string[];
  connectedAt: string;
}

export interface WhopConnectionInfo {
  connection: WhopConnection | null;
  /** Permissions to tick when creating the key in Whop. */
  requiredPermissions: string[];
  env: "sandbox" | "production";
}

export const connectWhopSchema = z.object({
  apiKey: z.string().trim().min(10).max(500).regex(/^apik_[A-Za-z0-9_-]+$/, "invalid_whop_key"),
});

/** One student payment to the teacher's Whop account (read-only; money matters live in Whop). */
export interface Sale {
  id: string;
  offerName: string | null;
  serverName: string | null;
  student: { id: string; displayName: string; username: string } | null;
  currency: string;
  totalMinor: number;
  refundedMinor: number;
  status: string;
  createdAt: string;
}
