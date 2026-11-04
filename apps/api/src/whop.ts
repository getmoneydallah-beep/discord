import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Minimal Whop REST client (https://docs.whop.com, API v1).
 *
 * Majlis's own Whop account is the only seller: teacher subscriptions and
 * student purchases of teacher offers are all products/plans on that account.
 * Responses follow the API version pinned below; webhooks are created with the
 * same pin so payloads have the same shape as these reads.
 */
export const WHOP_API_VERSION_DATE = "2026-10-28";

export const WHOP_BASE_URL = {
  sandbox: "https://sandbox-api.whop.com/api/v1",
  production: "https://api.whop.com/api/v1",
} as const;

/** Whop's money shape on this API version: major units as an exact decimal string. */
export interface WhopMoney {
  amount: string;
  currency: string;
  decimals: number;
}

export interface WhopProduct {
  id: string;
  title: string;
}

export interface WhopPlan {
  id: string;
  purchase_url?: string | null;
}

export interface WhopCheckout {
  id: string;
  purchase_url: string | null;
}

export interface WhopPayment {
  id: string;
  status: string;
  currency: string;
  total: WhopMoney | number | null;
  amount_after_fees: WhopMoney | number | null;
  membership_id: string | null;
  variant_id?: string | null;
  plan_id?: string | null; // older API versions
  product_id: string | null;
  checkout_configuration_id: string | null;
  metadata: Record<string, unknown> | null;
  billing_reason?: string | null;
  user?: { id: string; email?: string | null } | null;
}

export interface WhopMembership {
  id: string;
  status: string;
  variant_id?: string | null;
  plan_id?: string | null;
  product_id?: string | null;
  metadata: Record<string, unknown> | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  manage_url?: string | null;
}

export interface WhopRefund {
  id: string;
  status: string;
  payment_id: string;
  amount: WhopMoney | number | null;
}

export interface WhopDispute {
  id: string;
  status: string;
  amount: number | WhopMoney;
  currency: string;
  fee?: WhopMoney | null;
  payment: { id: string } | null;
}

export interface CreatePlanInput {
  productId: string;
  title: string;
  /** Major units, e.g. 29 for $29. */
  price: number;
  currency: string;
  billing: "one_time" | "monthly" | "yearly";
  trialDays?: number | null;
  stock?: number | null;
  metadata?: Record<string, string>;
}

export interface WhopApi {
  readonly env: "sandbox" | "production";
  createProduct(input: { title: string; description?: string; metadata?: Record<string, string> }): Promise<WhopProduct>;
  createPlan(input: CreatePlanInput): Promise<WhopPlan>;
  /** Hides a plan from new buyers; existing memberships keep renewing. */
  archivePlan(planId: string): Promise<void>;
  createCheckout(input: { planId: string; metadata: Record<string, string>; redirectUrl: string }): Promise<WhopCheckout>;
  getMembership(id: string): Promise<WhopMembership>;
}

export class WhopError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`Whop API ${status}: ${JSON.stringify(body).slice(0, 300)}`);
  }
}

export function createWhop(opts: { env: "sandbox" | "production"; apiKey: string; accountId: string }): WhopApi {
  const base = WHOP_BASE_URL[opts.env];

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(base + path, {
      method,
      headers: {
        authorization: `Bearer ${opts.apiKey}`,
        "content-type": "application/json",
        "Api-Version-Date": WHOP_API_VERSION_DATE,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json().catch(() => null)) as T;
    if (!res.ok) throw new WhopError(res.status, data);
    return data;
  }

  const billingFields = (b: CreatePlanInput["billing"], price: number) =>
    b === "one_time"
      ? { billing_type: "one_time", initial_price: price }
      : { billing_type: "renewal", billing_period: b === "monthly" ? 30 : 365, renewal_price: price, initial_price: 0 };

  return {
    env: opts.env,
    createProduct: (input) =>
      call<WhopProduct>("POST", "/products", {
        account_id: opts.accountId,
        title: input.title.slice(0, 80),
        description: input.description?.slice(0, 500) || null,
        visibility: "hidden", // sold only through Majlis checkouts, never listed on Whop's marketplace
        global_affiliate_status: "disabled",
        metadata: input.metadata ?? {},
      }),
    createPlan: (input) =>
      call<WhopPlan>("POST", "/plans", {
        account_id: opts.accountId,
        product_id: input.productId,
        title: input.title.slice(0, 80),
        currency: input.currency.toLowerCase(),
        visibility: "hidden",
        // Keep the buyer's price in the plan currency so the ledger matches the offer (no FX conversion).
        adaptive_pricing_enabled: false,
        ...billingFields(input.billing, input.price),
        trial_period_days: input.billing === "one_time" ? null : (input.trialDays ?? null),
        ...(input.stock ? { stock: input.stock, unlimited_stock: false } : { unlimited_stock: true }),
        metadata: input.metadata ?? {},
      }),
    archivePlan: async (planId) => {
      await call("PATCH", `/plans/${encodeURIComponent(planId)}`, { visibility: "archived" });
    },
    createCheckout: (input) =>
      call<WhopCheckout>("POST", "/checkout_configurations", {
        account_id: opts.accountId,
        variant_id: input.planId,
        metadata: input.metadata,
        redirect_url: input.redirectUrl,
      }),
    getMembership: (id) => call<WhopMembership>("GET", `/memberships/${encodeURIComponent(id)}`),
  };
}

/** Whop money (string major units or a legacy number) → integer minor units. */
export function toMinor(m: WhopMoney | number | string | null | undefined): number {
  if (m == null) return 0;
  if (typeof m === "number") return Math.round(m * 100);
  const amount = typeof m === "string" ? m : m.amount;
  const decimals = typeof m === "string" ? 2 : (m.decimals ?? 2);
  const neg = amount.trim().startsWith("-");
  const [whole = "0", frac = ""] = amount.replace(/^[-+]/, "").trim().split(".");
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  const minor = Number(whole) * 10 ** decimals + Number(fracPadded || "0");
  // Ledger amounts are in hundredths; normalise currencies with other precisions.
  const scaled = decimals === 2 ? minor : Math.round((minor * 100) / 10 ** decimals);
  return neg ? -scaled : scaled;
}

/* ------------------------------- webhooks -------------------------------- */

export class WebhookSignatureError extends Error {}

/**
 * Verifies a Whop webhook (Standard Webhooks). Whop HMAC-SHA256-signs
 * `${webhook-id}.${webhook-timestamp}.${raw body}` with the literal bytes of
 * the `ws_...` secret, base64-encoded, in `webhook-signature: v1,<sig> ...`.
 */
export function verifyWhopWebhook(
  rawBody: string,
  headers: Record<string, string | string[] | undefined>,
  secret: string,
  now = Date.now(),
): { id: string; timestamp: number } {
  const h = (name: string) => {
    const v = headers[name];
    return Array.isArray(v) ? v[0] : v;
  };
  const id = h("webhook-id");
  const ts = h("webhook-timestamp");
  const sigHeader = h("webhook-signature");
  if (!id || !ts || !sigHeader) throw new WebhookSignatureError("missing_headers");
  const timestamp = Number(ts);
  if (!Number.isFinite(timestamp) || Math.abs(now / 1000 - timestamp) > 5 * 60) {
    throw new WebhookSignatureError("timestamp_out_of_range");
  }
  const expected = createHmac("sha256", Buffer.from(secret, "utf8")).update(`${id}.${ts}.${rawBody}`).digest();
  for (const part of sigHeader.split(" ")) {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) continue;
    const given = Buffer.from(sig, "base64");
    if (given.length === expected.length && timingSafeEqual(given, expected)) return { id, timestamp };
  }
  throw new WebhookSignatureError("bad_signature");
}

/** Signs a payload the way Whop does (for tests and local tooling). */
export function signWhopWebhook(rawBody: string, secret: string, id: string, timestamp = Math.floor(Date.now() / 1000)) {
  const sig = createHmac("sha256", Buffer.from(secret, "utf8")).update(`${id}.${timestamp}.${rawBody}`).digest("base64");
  return { "webhook-id": id, "webhook-timestamp": String(timestamp), "webhook-signature": `v1,${sig}` };
}
