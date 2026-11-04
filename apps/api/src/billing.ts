import {
  newId,
  TIERS,
  TRIAL_DAYS,
  type BillingInterval,
  type EntitlementStatus,
  type PaidTier,
  type ServerEvent,
  type SubscriptionStatus,
  type WhopConnection,
} from "@majlis/shared";
import type { Scope } from "./bus";
import type { SecretBox } from "./crypto";
import type { Sql } from "./db";
import { HttpError } from "./errors";
import {
  isAuthError,
  missingPermissions,
  toMinor,
  WhopError,
  type WhopApi,
  type WhopConnector,
  type WhopDispute,
  type WhopMembership,
  type WhopPayment,
  type WhopRefund,
} from "./whop";

type Row = Record<string, any>;

export interface BillingDeps {
  sql: Sql;
  /** Majlis's own Whop account: sells teacher plans. */
  whop: WhopApi | null;
  /** Teachers' own Whop accounts: students pay these. */
  connector: WhopConnector | null;
  box: SecretBox;
  webUrl: string;
  /** Public https base for teachers' webhooks. */
  webhookBaseUrl: string;
  emit: (scope: Scope, event: ServerEvent) => Promise<void>;
  log?: { info: (obj: unknown, msg?: string) => void; warn: (obj: unknown, msg?: string) => void };
}

/** Webhook events Majlis subscribes to, on its own account and on each teacher's. */
export const WHOP_WEBHOOK_EVENTS = [
  "payment.succeeded",
  "payment.failed",
  "membership.activated",
  "membership.deactivated",
  "membership.updated",
  "membership.cancel_at_period_end_changed",
  "refund.created",
  "refund.updated",
  "dispute.created",
  "dispute.updated",
] as const;

/** Where a webhook came from: Majlis's account (teacher plans) or one teacher's account (offers). */
export type WebhookSource = { kind: "platform" } | { kind: "connection"; connectionId: string; teacherId: string };

const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const iso = (d: Date | string | null) => (d == null ? null : new Date(d).toISOString());

function subscriptionStatus(whopStatus: string): SubscriptionStatus | null {
  switch (whopStatus) {
    case "trialing":
      return "trialing";
    case "active":
    case "canceling": // still paid up until the period ends
      return "active";
    case "past_due":
    case "unresolved":
      return "past_due";
    case "canceled":
      return "canceled";
    case "expired":
    case "completed":
      return "expired";
    default:
      return null; // drafted etc.: ignore
  }
}

function entitlementStatus(whopStatus: string): EntitlementStatus | null {
  const s = subscriptionStatus(whopStatus);
  if (s === "canceled") return "expired";
  return s === "none" ? null : (s as EntitlementStatus | null);
}

export function createBilling(deps: BillingDeps) {
  const { sql, webUrl, emit, box } = deps;

  function requireWhop(): WhopApi {
    if (!deps.whop) throw new HttpError(503, "billing_unavailable");
    return deps.whop;
  }
  function requireConnector(): WhopConnector {
    if (!deps.connector) throw new HttpError(503, "billing_unavailable");
    return deps.connector;
  }

  /* ----------------------- teachers' Whop connections ----------------------- */

  const toConnection = (r: Row): WhopConnection => ({
    status: r.status,
    accountId: r.whopAccountId,
    accountTitle: r.accountTitle,
    keyLast4: r.apiKeyLast4 ?? null,
    webhookActive: Boolean(r.webhookId),
    lastError: r.lastError ?? null,
    missingPermissions: r.lastError?.startsWith("missing_permissions:") ? r.lastError.slice(20).split(",") : [],
    connectedAt: iso(r.createdAt)!,
  });

  async function connectionRow(teacherId: string) {
    const [row] = await sql`SELECT * FROM whop_connections WHERE teacher_user_id = ${teacherId}`;
    return row ?? null;
  }

  async function getConnection(teacherId: string): Promise<WhopConnection | null> {
    const row = await connectionRow(teacherId);
    return row && row.status !== "disconnected" ? toConnection(row) : null;
  }

  /** The client for a teacher's own account, or a clear error if selling isn't possible. */
  async function teacherClient(teacherId: string) {
    const row = await connectionRow(teacherId);
    if (!row || row.status !== "active" || !row.apiKeyEnc) throw new HttpError(409, "selling_paused");
    return { row, api: requireConnector().client(box.open(row.apiKeyEnc), row.whopAccountId) };
  }

  /** A Whop call on a teacher's key failed because the key was revoked or lost permissions. */
  async function markBroken(connectionId: string, err: unknown) {
    const missing = missingPermissions(err);
    const reason = missing.length ? `missing_permissions:${missing.join(",")}` : "key_rejected";
    await sql`UPDATE whop_connections SET status = 'broken', last_error = ${reason}, updated_at = now() WHERE id = ${connectionId}`;
    deps.log?.warn({ connectionId, reason }, "teacher whop connection broken");
  }

  /** Runs a call on a teacher's account; auth failures mark the connection broken and pause selling. */
  async function onTeacher<T>(teacherId: string, fn: (api: WhopApi, row: Row) => Promise<T>): Promise<T> {
    const { row, api } = await teacherClient(teacherId);
    try {
      return await fn(api, row);
    } catch (err) {
      if (isAuthError(err)) {
        await markBroken(row.id, err);
        throw new HttpError(409, "selling_paused");
      }
      throw err;
    }
  }

  async function removeWebhook(row: Row) {
    if (!row.webhookId || !row.apiKeyEnc || !deps.connector) return;
    await deps.connector
      .client(box.open(row.apiKeyEnc), row.whopAccountId)
      .deleteWebhook(row.webhookId)
      .catch((err: unknown) => deps.log?.warn({ err, connectionId: row.id }, "deleting teacher webhook failed"));
  }

  /**
   * Connects (or reconnects) a teacher's Whop account from a pasted API key:
   * finds the account, checks permissions, creates a webhook on it and stores
   * the key and webhook secret encrypted.
   */
  async function connect(teacherId: string, apiKey: string): Promise<WhopConnection> {
    const connector = requireConnector();
    if (!TIERS[await tierOf(teacherId)].canSell) throw new HttpError(403, "tier_cannot_sell");

    let account: { id: string; title: string };
    try {
      account = await connector.account(apiKey);
    } catch (err) {
      if (err instanceof WhopError && err.status < 500) throw new HttpError(400, "whop_key_rejected");
      throw err;
    }
    const [taken] = await sql`
      SELECT 1 FROM whop_connections
      WHERE whop_account_id = ${account.id} AND status <> 'disconnected' AND teacher_user_id <> ${teacherId}`;
    if (taken) throw new HttpError(409, "whop_account_in_use");

    const api = connector.client(apiKey, account.id);
    const missing = await api.checkReadPermissions();
    if (missing.length) throw new HttpError(400, `whop_missing_permissions:${missing.join(",")}`);

    const previous = await connectionRow(teacherId);
    const id: string = previous?.id ?? newId();
    // Whop only calls public https URLs; local dev connects without a webhook.
    let webhook: { id: string; secret: string } | null = null;
    if (deps.webhookBaseUrl.startsWith("https://")) {
      try {
        webhook = await api.createWebhook({
          url: `${deps.webhookBaseUrl.replace(/\/$/, "")}/webhooks/whop/${id}`,
          events: WHOP_WEBHOOK_EVENTS,
          title: "Majlis",
        });
      } catch (err) {
        if (isAuthError(err)) {
          const m = missingPermissions(err);
          throw new HttpError(400, `whop_missing_permissions:${(m.length ? m : ["developer:manage_webhook"]).join(",")}`);
        }
        throw err;
      }
    }
    if (previous) await removeWebhook(previous);

    const values = {
      whopAccountId: account.id,
      accountTitle: account.title,
      apiKeyEnc: box.seal(apiKey),
      apiKeyLast4: apiKey.slice(-4),
      webhookId: webhook?.id ?? null,
      webhookSecretEnc: webhook ? box.seal(webhook.secret) : null,
    };
    await sql`
      INSERT INTO whop_connections (id, teacher_user_id, whop_account_id, account_title, api_key_enc, api_key_last4,
                                    webhook_id, webhook_secret_enc, status, last_checked_at)
      VALUES (${id}, ${teacherId}, ${values.whopAccountId}, ${values.accountTitle}, ${values.apiKeyEnc}, ${values.apiKeyLast4},
              ${values.webhookId}, ${values.webhookSecretEnc}, 'active', now())
      ON CONFLICT (teacher_user_id) DO UPDATE SET
        whop_account_id = EXCLUDED.whop_account_id, account_title = EXCLUDED.account_title,
        api_key_enc = EXCLUDED.api_key_enc, api_key_last4 = EXCLUDED.api_key_last4,
        webhook_id = EXCLUDED.webhook_id, webhook_secret_enc = EXCLUDED.webhook_secret_enc,
        status = 'active', last_error = NULL, last_checked_at = now(), updated_at = now()`;
    return (await getConnection(teacherId))!;
  }

  /** Stops selling: deletes Majlis's webhook on the teacher's account and wipes the key. Buyers keep access. */
  async function disconnect(teacherId: string) {
    const row = await connectionRow(teacherId);
    if (!row || row.status === "disconnected") return;
    await removeWebhook(row);
    await sql`
      UPDATE whop_connections SET status = 'disconnected', api_key_enc = NULL, webhook_id = NULL,
        webhook_secret_enc = NULL, updated_at = now()
      WHERE id = ${row.id}`;
  }

  /** Decrypted webhook secret for a connection's webhook URL. */
  async function connectionForWebhook(connectionId: string) {
    const [row] = await sql`SELECT * FROM whop_connections WHERE id = ${connectionId}`;
    if (!row?.webhookSecretEnc) return null;
    return { id: row.id as string, teacherId: row.teacherUserId as string, accountId: row.whopAccountId as string, secret: box.open(row.webhookSecretEnc) };
  }

  /** Daily: re-checks active connections with a cheap read so broken keys show up before a student tries to pay. */
  async function checkConnections() {
    if (!deps.connector) return;
    const rows = await sql`SELECT * FROM whop_connections WHERE status = 'active' AND api_key_enc IS NOT NULL`;
    for (const row of rows) {
      try {
        const missing = await deps.connector.client(box.open(row.apiKeyEnc), row.whopAccountId).checkReadPermissions();
        if (missing.length) await markBroken(row.id, new WhopError(403, { error: { message: `missing required permissions: ${missing.join(", ")}` } }));
        else await sql`UPDATE whop_connections SET last_checked_at = now() WHERE id = ${row.id}`;
      } catch (err) {
        if (isAuthError(err)) await markBroken(row.id, err);
        else deps.log?.warn({ err, connectionId: row.id }, "whop connection check failed");
      }
    }
  }

  /* -------------------------- teacher plans (Majlis) -------------------------- */

  async function tierOf(userId: string) {
    const [row] = await sql<{ tier: PaidTier }[]>`
      SELECT tier FROM teacher_subscriptions WHERE user_id = ${userId} AND status IN ('trialing', 'active', 'past_due')`;
    return row?.tier ?? "free";
  }

  /** Gets a catalog id, creating the Whop object once (serialised with an advisory lock). */
  async function catalog(key: string, create: () => Promise<string>): Promise<string> {
    const [hit] = await sql<{ whopId: string }[]>`SELECT whop_id FROM whop_catalog WHERE key = ${key}`;
    if (hit) return hit.whopId;
    return sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${"whop_catalog:" + key}))`;
      const [again] = await tx<{ whopId: string }[]>`SELECT whop_id FROM whop_catalog WHERE key = ${key}`;
      if (again) return again.whopId;
      const id = await create();
      await tx`INSERT INTO whop_catalog (key, whop_id) VALUES (${key}, ${id})`;
      return id;
    });
  }

  async function teacherPlanId(tier: PaidTier, interval: BillingInterval): Promise<string> {
    const whop = requireWhop();
    const productId = await catalog("teacher:product", async () => {
      const p = await whop.createProduct({
        title: "Majlis for Teachers · مجلس للمعلمين",
        description: "Majlis teacher plans: sell courses and paid communities.",
        metadata: { kind: "teacher_subscription" },
      });
      return p.id;
    });
    return catalog(`teacher:${tier}:${interval}`, async () => {
      const name = { starter: "Starter", pro: "Pro", academy: "Academy" }[tier];
      const plan = await whop.createPlan({
        productId,
        title: `${name} · ${interval === "monthly" ? "Monthly" : "Yearly"}`,
        price: TIERS[tier].priceUsd[interval],
        currency: "usd",
        billing: interval,
        trialDays: TRIAL_DAYS,
        metadata: { kind: "teacher_subscription", tier, interval },
      });
      return plan.id;
    });
  }

  async function teacherPlanByWhopId(planId: string | null | undefined) {
    if (!planId) return null;
    const [row] = await sql<{ key: string }[]>`SELECT key FROM whop_catalog WHERE whop_id = ${planId}`;
    const m = row?.key.match(/^teacher:(starter|pro|academy):(monthly|yearly)$/);
    return m ? { tier: m[1] as PaidTier, interval: m[2] as BillingInterval } : null;
  }

  async function recordCheckout(input: {
    id: string;
    kind: "teacher_subscription" | "offer";
    userId: string;
    planId: string;
    offerId?: string;
    tier?: string;
    interval?: string;
    connectionId?: string;
  }) {
    await sql`
      INSERT INTO checkout_sessions (id, kind, user_id, offer_id, tier, interval, whop_plan_id, connection_id)
      VALUES (${input.id}, ${input.kind}, ${input.userId}, ${input.offerId ?? null}, ${input.tier ?? null},
              ${input.interval ?? null}, ${input.planId}, ${input.connectionId ?? null})`;
  }

  async function teacherCheckout(userId: string, tier: PaidTier, interval: BillingInterval) {
    const [current] = await sql`
      SELECT * FROM teacher_subscriptions WHERE user_id = ${userId} AND status IN ('trialing', 'active', 'past_due')`;
    if (current) throw new HttpError(409, "already_subscribed");
    const planId = await teacherPlanId(tier, interval);
    const checkout = await requireWhop()
      .createCheckout({
        planId,
        metadata: { kind: "teacher_subscription", user_id: userId, tier, interval },
        redirectUrl: `${webUrl}/billing?checkout=done`,
      })
      .catch((err: unknown) => {
        deps.log?.warn({ err }, "whop checkout failed");
        throw new HttpError(502, "checkout_failed");
      });
    if (!checkout.purchase_url) throw new HttpError(502, "checkout_failed");
    await recordCheckout({ id: checkout.id, kind: "teacher_subscription", userId, planId, tier, interval });
    return { url: checkout.purchase_url };
  }

  /* --------------------- offers (on the teacher's account) --------------------- */

  /**
   * The Whop plan new buyers get for an offer, created on the teacher's own
   * account on first checkout (again after a price change or a different
   * Whop account is connected).
   */
  async function offerPlanId(offerId: string, teacherId: string): Promise<string> {
    return onTeacher(teacherId, (api, conn) =>
      sql.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(hashtext(${"offer_plan:" + offerId}))`;
        const [offer] = await tx`
          SELECT o.*, s.name AS server_name FROM offers o JOIN servers s ON s.id = o.server_id WHERE o.id = ${offerId}`;
        if (!offer) throw new HttpError(404, "offer_not_found");
        const sameAccount = offer.connectionId === conn.id;
        if (offer.whopPlanId && sameAccount) return offer.whopPlanId as string;
        const meta = { kind: "offer", offer_id: offer.id, server_id: offer.serverId };
        let productId = sameAccount ? (offer.whopProductId as string | null) : null;
        if (!productId) {
          productId = (await api.createProduct({ title: `${offer.serverName} — ${offer.name}`, description: offer.description, metadata: meta })).id;
        }
        const plan = await api.createPlan({
          productId,
          title: offer.name,
          price: Number(offer.priceMinor) / 100,
          currency: offer.currency,
          billing: offer.billing,
          trialDays: offer.trialDays,
          metadata: meta,
        });
        await tx`
          UPDATE offers SET whop_product_id = ${productId}, whop_plan_id = ${plan.id}, connection_id = ${conn.id}, updated_at = now()
          WHERE id = ${offerId}`;
        await tx`
          INSERT INTO offer_plans (whop_plan_id, offer_id, connection_id) VALUES (${plan.id}, ${offerId}, ${conn.id})
          ON CONFLICT DO NOTHING`;
        return plan.id;
      }),
    );
  }

  /** After a price change or deactivation: new buyers can't use the old plan; renewals continue. */
  async function retireOfferPlan(teacherId: string, planId: string | null, connectionId: string | null) {
    if (!planId) return;
    const conn = await connectionRow(teacherId);
    if (!conn || conn.id !== connectionId || conn.status !== "active") return; // plan lives on an account we no longer reach
    await onTeacher(teacherId, (api) => api.archivePlan(planId)).catch((err: unknown) =>
      deps.log?.warn({ err, planId }, "archiving Whop plan failed"),
    );
  }

  async function offerCheckout(userId: string, offerId: string) {
    const [offer] = await sql`
      SELECT o.*, s.owner_id FROM offers o JOIN servers s ON s.id = o.server_id WHERE o.id = ${offerId}`;
    if (!offer || !offer.active) throw new HttpError(404, "offer_not_found");
    const [member] = await sql`SELECT role FROM server_members WHERE server_id = ${offer.serverId} AND user_id = ${userId}`;
    if (!member) throw new HttpError(404, "offer_not_found");
    const [owned] = await sql`
      SELECT 1 FROM entitlements WHERE user_id = ${userId} AND offer_id = ${offerId}
        AND status IN ('active', 'trialing', 'past_due') AND (ends_at IS NULL OR ends_at > now())`;
    if (owned) throw new HttpError(409, "already_owned");
    if (offer.seatLimit) {
      const [row] = await sql<{ taken: number }[]>`
        SELECT count(*)::int AS taken FROM entitlements
        WHERE offer_id = ${offerId} AND status IN ('active', 'trialing', 'past_due')`;
      if ((row?.taken ?? 0) >= offer.seatLimit) throw new HttpError(409, "offer_sold_out");
    }
    const teacherId = offer.ownerId as string;
    if (!TIERS[await tierOf(teacherId)].canSell) throw new HttpError(409, "selling_paused");
    const planId = await offerPlanId(offerId, teacherId);
    const { checkout, connectionId } = await onTeacher(teacherId, async (api, conn) => ({
      connectionId: conn.id as string,
      checkout: await api.createCheckout({
        planId,
        metadata: { kind: "offer", user_id: userId, offer_id: offerId, server_id: offer.serverId },
        redirectUrl: `${webUrl}/s/${offer.serverId}?purchase=${offerId}`,
      }),
    }));
    if (!checkout.purchase_url) throw new HttpError(502, "checkout_failed");
    await recordCheckout({ id: checkout.id, kind: "offer", userId, planId, offerId, connectionId });
    return { url: checkout.purchase_url };
  }

  /* --------------------------- webhook handling --------------------------- */

  async function userExists(id: string | null) {
    if (!id) return false;
    const [row] = await sql`SELECT 1 FROM users WHERE id = ${id}`;
    return Boolean(row);
  }

  type TeacherSub = { userId: string; tier: PaidTier; interval: BillingInterval | null };
  type OfferBuy = { userId: string; offerId: string; serverId: string };

  /** Teacher plan events only arrive on Majlis's own webhook. */
  async function resolveTeacherSub(opts: {
    metadata: Record<string, unknown> | null | undefined;
    checkoutId?: string | null;
    planId?: string | null;
    membershipId?: string | null;
  }): Promise<TeacherSub | null> {
    const meta = opts.metadata ?? {};
    const fromPlan = await teacherPlanByWhopId(opts.planId);
    if (meta.kind === "teacher_subscription" && (await userExists(str(meta.user_id)))) {
      const tier = (str(meta.tier) as PaidTier | null) ?? fromPlan?.tier;
      if (tier && tier in TIERS) return { userId: str(meta.user_id)!, tier, interval: (str(meta.interval) as BillingInterval) ?? fromPlan?.interval ?? null };
    }
    if (opts.checkoutId) {
      const [cs] = await sql`SELECT * FROM checkout_sessions WHERE id = ${opts.checkoutId} AND kind = 'teacher_subscription'`;
      if (cs) return { userId: cs.userId, tier: cs.tier, interval: cs.interval };
    }
    if (opts.membershipId) {
      const [ts] = await sql`SELECT * FROM teacher_subscriptions WHERE whop_membership_id = ${opts.membershipId}`;
      if (ts) return { userId: ts.userId, tier: fromPlan?.tier ?? ts.tier, interval: fromPlan?.interval ?? ts.interval };
    }
    return null;
  }

  /**
   * Offer events only count when they arrive on the webhook of the teacher who
   * owns the offer's server, so one teacher's account can't unlock another's content.
   */
  async function resolveOfferBuy(
    teacherId: string,
    opts: { metadata: Record<string, unknown> | null | undefined; checkoutId?: string | null; planId?: string | null; membershipId?: string | null },
  ): Promise<OfferBuy | null> {
    const meta = opts.metadata ?? {};
    let userId: string | null = null;
    let offerId: string | null = null;
    if (meta.kind === "offer" && str(meta.offer_id) && (await userExists(str(meta.user_id)))) {
      userId = str(meta.user_id);
      offerId = str(meta.offer_id);
    }
    if (!offerId && opts.checkoutId) {
      const [cs] = await sql`SELECT * FROM checkout_sessions WHERE id = ${opts.checkoutId} AND kind = 'offer'`;
      if (cs) ({ userId, offerId } = cs);
    }
    if (!offerId && opts.membershipId) {
      const [ent] = await sql`SELECT * FROM entitlements WHERE whop_membership_id = ${opts.membershipId}`;
      if (ent) ({ userId, offerId } = ent);
    }
    if (!offerId || !userId) return null;
    const [offer] = await sql`SELECT o.id, o.server_id, s.owner_id FROM offers o JOIN servers s ON s.id = o.server_id WHERE o.id = ${offerId}`;
    if (!offer || offer.ownerId !== teacherId) return null;
    return { userId, offerId, serverId: offer.serverId };
  }

  async function accessChanged(userId: string, serverId: string) {
    await emit({ userIds: [userId] }, { t: "ACCESS_UPDATE", d: { serverId } });
  }

  async function upsertTeacherSubscription(
    r: TeacherSub,
    fields: { status: SubscriptionStatus; membershipId?: string | null; planId?: string | null; periodEnd?: string | null; cancelAtPeriodEnd?: boolean; manageUrl?: string | null },
  ) {
    const trialEnds = fields.status === "trialing" ? (fields.periodEnd ?? null) : null;
    await sql`
      INSERT INTO teacher_subscriptions
        (user_id, tier, interval, status, whop_membership_id, whop_plan_id, manage_url, trial_ends_at, current_period_end, cancel_at_period_end)
      VALUES (${r.userId}, ${r.tier}, ${r.interval}, ${fields.status}, ${fields.membershipId ?? null}, ${fields.planId ?? null},
              ${fields.manageUrl ?? null}, ${trialEnds}, ${fields.periodEnd ?? null}, ${fields.cancelAtPeriodEnd ?? false})
      ON CONFLICT (user_id) DO UPDATE SET
        tier = EXCLUDED.tier,
        interval = COALESCE(EXCLUDED.interval, teacher_subscriptions.interval),
        status = EXCLUDED.status,
        whop_membership_id = COALESCE(EXCLUDED.whop_membership_id, teacher_subscriptions.whop_membership_id),
        whop_plan_id = COALESCE(EXCLUDED.whop_plan_id, teacher_subscriptions.whop_plan_id),
        manage_url = COALESCE(EXCLUDED.manage_url, teacher_subscriptions.manage_url),
        trial_ends_at = COALESCE(EXCLUDED.trial_ends_at, teacher_subscriptions.trial_ends_at),
        current_period_end = COALESCE(EXCLUDED.current_period_end, teacher_subscriptions.current_period_end),
        cancel_at_period_end = EXCLUDED.cancel_at_period_end,
        updated_at = now()`;
  }

  async function handlePaymentSucceeded(p: WhopPayment, source: WebhookSource) {
    const planId = p.variant_id ?? p.plan_id ?? null;
    const lookup = { metadata: p.metadata, checkoutId: p.checkout_configuration_id, planId, membershipId: p.membership_id };
    const currency = (p.currency ?? (typeof p.total === "object" && p.total ? p.total.currency : "usd")).toLowerCase();
    const total = toMinor(p.total);
    const afterFees = p.amount_after_fees == null ? total : toMinor(p.amount_after_fees);
    const whopFee = Math.max(0, total - afterFees);
    if (p.checkout_configuration_id) {
      await sql`UPDATE checkout_sessions SET completed_at = COALESCE(completed_at, now()) WHERE id = ${p.checkout_configuration_id}`;
    }

    if (source.kind === "platform") {
      const r = await resolveTeacherSub(lookup);
      if (!r) return deps.log?.warn({ paymentId: p.id }, "platform payment not tied to a teacher plan; ignored");
      await sql`
        INSERT INTO payments (id, kind, user_id, whop_membership_id, currency, total_minor, whop_fee_minor, status, raw)
        VALUES (${p.id}, 'teacher_subscription', ${r.userId}, ${p.membership_id}, ${currency}, ${total}, ${whopFee}, ${p.status}, ${sql.json(p as never)})
        ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, raw = EXCLUDED.raw, updated_at = now()`;
      // A $0 payment is the start of a free trial, not a paid period.
      await upsertTeacherSubscription(r, { status: total > 0 ? "active" : "trialing", membershipId: p.membership_id, planId });
      return;
    }

    const r = await resolveOfferBuy(source.teacherId, lookup);
    if (!r) return deps.log?.warn({ paymentId: p.id, connectionId: source.connectionId }, "teacher payment not tied to an offer; ignored");
    await sql.begin(async (tx) => {
      await tx`
        INSERT INTO payments (id, kind, user_id, offer_id, server_id, teacher_user_id, whop_membership_id, currency,
                              total_minor, whop_fee_minor, status, raw, connection_id)
        VALUES (${p.id}, 'offer', ${r.userId}, ${r.offerId}, ${r.serverId}, ${source.teacherId}, ${p.membership_id}, ${currency},
                ${total}, ${whopFee}, ${p.status}, ${tx.json(p as never)}, ${source.connectionId})
        ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, raw = EXCLUDED.raw, updated_at = now()`;
      await tx`
        INSERT INTO entitlements (id, user_id, offer_id, server_id, source, status, whop_membership_id)
        VALUES (${newId()}, ${r.userId}, ${r.offerId}, ${r.serverId}, 'whop', ${total > 0 ? "active" : "trialing"}, ${p.membership_id})
        ON CONFLICT (user_id, offer_id) DO UPDATE SET
          source = 'whop', status = EXCLUDED.status, ends_at = NULL,
          whop_membership_id = COALESCE(EXCLUDED.whop_membership_id, entitlements.whop_membership_id),
          updated_at = now()`;
    });
    await accessChanged(r.userId, r.serverId);
  }

  async function handleMembership(m: WhopMembership, source: WebhookSource) {
    const planId = m.variant_id ?? m.plan_id ?? null;
    const lookup = { metadata: m.metadata, planId, membershipId: m.id };

    if (source.kind === "platform") {
      const r = await resolveTeacherSub(lookup);
      const status = subscriptionStatus(m.status);
      if (!r || !status) return;
      await upsertTeacherSubscription(r, {
        status,
        membershipId: m.id,
        planId,
        periodEnd: m.current_period_end,
        cancelAtPeriodEnd: m.cancel_at_period_end || m.status === "canceling",
        manageUrl: m.manage_url ?? null,
      });
      return;
    }

    const r = await resolveOfferBuy(source.teacherId, lookup);
    if (!r) return;
    const [offer] = await sql`SELECT billing FROM offers WHERE id = ${r.offerId}`;
    const status = entitlementStatus(m.status);
    if (!offer || !status) return;
    // Lifetime (one-time) purchases end only through a refund or chargeback, never a membership state.
    if (offer.billing === "one_time" && (status === "expired" || status === "past_due")) return;
    await sql`
      INSERT INTO entitlements (id, user_id, offer_id, server_id, source, status, whop_membership_id, ends_at)
      VALUES (${newId()}, ${r.userId}, ${r.offerId}, ${r.serverId}, 'whop', ${status}, ${m.id}, ${status === "expired" ? new Date() : null})
      ON CONFLICT (user_id, offer_id) DO UPDATE SET
        status = CASE WHEN entitlements.status = 'revoked' THEN 'revoked' ELSE EXCLUDED.status END,
        source = 'whop',
        whop_membership_id = EXCLUDED.whop_membership_id,
        ends_at = EXCLUDED.ends_at,
        updated_at = now()`;
    await accessChanged(r.userId, r.serverId);
  }

  /** The payment must belong to this webhook's source (Majlis's account or that teacher's). */
  async function paymentFor(paymentId: string, source: WebhookSource) {
    const [payment] = await sql`SELECT * FROM payments WHERE id = ${paymentId}`;
    if (!payment) return null;
    if (source.kind === "platform") return payment.kind === "teacher_subscription" ? payment : null;
    return payment.kind === "offer" && payment.teacherUserId === source.teacherId ? payment : null;
  }

  /** Ends the access a payment bought (full refund, or chargeback). */
  async function revokeForPayment(payment: Row) {
    if (payment.kind !== "offer" || !payment.offerId || !payment.userId) return;
    await sql`
      UPDATE entitlements SET status = 'revoked', ends_at = now(), updated_at = now()
      WHERE user_id = ${payment.userId} AND offer_id = ${payment.offerId}`;
    await accessChanged(payment.userId, payment.serverId);
  }

  async function handleRefund(rf: WhopRefund, source: WebhookSource) {
    if (rf.status !== "succeeded") return;
    const payment = await paymentFor(rf.payment_id, source);
    if (!payment) return;
    const marker = `refund:${rf.id}`;
    const [updated] = await sql`
      UPDATE payments SET refunded_minor = refunded_minor + ${toMinor(rf.amount)}, updated_at = now(),
        raw = raw || ${sql.json({ [marker]: true } as never)}
      WHERE id = ${payment.id} AND NOT (raw ? ${marker})
      RETURNING refunded_minor, total_minor`;
    if (updated && Number(updated.refundedMinor) >= Number(updated.totalMinor)) await revokeForPayment(payment);
  }

  async function handleDispute(d: WhopDispute, type: string, source: WebhookSource) {
    if (!d.payment?.id) return;
    const payment = await paymentFor(d.payment.id, source);
    if (!payment) return;
    if (type === "dispute.created" || d.status === "lost") await revokeForPayment(payment);
  }

  /** Processes one verified webhook event. Throwing makes Whop retry. */
  async function handleEvent(event: { type: string; data: any }, source: WebhookSource) {
    switch (event.type) {
      case "payment.succeeded":
        return handlePaymentSucceeded(event.data as WhopPayment, source);
      case "membership.activated":
      case "membership.deactivated":
      case "membership.updated":
      case "membership.cancel_at_period_end_changed":
        return handleMembership(event.data as WhopMembership, source);
      case "refund.created":
      case "refund.updated":
        return handleRefund(event.data as WhopRefund, source);
      case "dispute.created":
      case "dispute.updated":
        return handleDispute(event.data as WhopDispute, event.type, source);
      default:
        return; // payment.failed etc.: membership events carry the state change
    }
  }

  return {
    teacherCheckout,
    offerCheckout,
    teacherPlanId,
    retireOfferPlan,
    connect,
    disconnect,
    getConnection,
    connectionForWebhook,
    checkConnections,
    handleEvent,
  };
}

export type Billing = ReturnType<typeof createBilling>;
