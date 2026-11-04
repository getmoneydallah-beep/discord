import {
  newId,
  TIERS,
  TRIAL_DAYS,
  type BillingInterval,
  type EntitlementStatus,
  type LedgerType,
  type PaidTier,
  type SubscriptionStatus,
} from "@majlis/shared";
import type { Scope } from "./bus";
import type { Sql } from "./db";
import { HttpError } from "./errors";
import type { ServerEvent } from "@majlis/shared";
import {
  toMinor,
  type WhopApi,
  type WhopDispute,
  type WhopMembership,
  type WhopPayment,
  type WhopRefund,
} from "./whop";

type Tx = Sql | import("postgres").TransactionSql<{}>;
type Row = Record<string, any>;

export interface BillingDeps {
  sql: Sql;
  whop: WhopApi | null;
  webUrl: string;
  holdDays: number;
  emit: (scope: Scope, event: ServerEvent) => Promise<void>;
  log?: { info: (obj: unknown, msg?: string) => void; warn: (obj: unknown, msg?: string) => void };
}

/** Webhook events Majlis subscribes to. */
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

type Resolved =
  | { kind: "teacher_subscription"; userId: string; tier: PaidTier; interval: BillingInterval | null }
  | { kind: "offer"; userId: string; offerId: string };

const str = (v: unknown) => (typeof v === "string" && v ? v : null);

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
  const { sql, webUrl, emit } = deps;

  function requireWhop(): WhopApi {
    if (!deps.whop) throw new HttpError(503, "billing_unavailable");
    return deps.whop;
  }

  /* ------------------------------ catalog ------------------------------ */

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

  /** Publishes an offer to Whop on first checkout (and after a price change). */
  async function offerPlanId(offerId: string): Promise<string> {
    const whop = requireWhop();
    return sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${"offer_plan:" + offerId}))`;
      const [offer] = await tx`
        SELECT o.*, s.name AS server_name, s.owner_id FROM offers o JOIN servers s ON s.id = o.server_id
        WHERE o.id = ${offerId}`;
      if (!offer) throw new HttpError(404, "offer_not_found");
      if (offer.whopPlanId) return offer.whopPlanId as string;
      const meta = { kind: "offer", offer_id: offer.id, server_id: offer.serverId, teacher_id: offer.ownerId };
      let productId = offer.whopProductId as string | null;
      if (!productId) {
        productId = (
          await whop.createProduct({ title: `${offer.serverName} — ${offer.name}`, description: offer.description, metadata: meta })
        ).id;
      }
      const plan = await whop.createPlan({
        productId,
        title: offer.name,
        price: Number(offer.priceMinor) / 100,
        currency: offer.currency,
        billing: offer.billing,
        trialDays: offer.trialDays,
        metadata: meta,
      });
      await tx`UPDATE offers SET whop_product_id = ${productId}, whop_plan_id = ${plan.id}, updated_at = now() WHERE id = ${offerId}`;
      await tx`INSERT INTO offer_plans (whop_plan_id, offer_id) VALUES (${plan.id}, ${offerId}) ON CONFLICT DO NOTHING`;
      return plan.id;
    });
  }

  /** After a price/billing change: new buyers get a new plan; the old one is archived (renewals continue). */
  async function retireOfferPlan(planId: string | null) {
    if (!planId || !deps.whop) return;
    await deps.whop.archivePlan(planId).catch((err: unknown) => deps.log?.warn({ err, planId }, "archiving Whop plan failed"));
  }

  /* ------------------------------ checkout ------------------------------ */

  async function startCheckout(input: {
    kind: "teacher_subscription" | "offer";
    userId: string;
    planId: string;
    metadata: Record<string, string>;
    redirectUrl: string;
    offerId?: string;
    tier?: string;
    interval?: string;
  }) {
    const whop = requireWhop();
    const checkout = await whop
      .createCheckout({
        planId: input.planId,
        metadata: { ...input.metadata, kind: input.kind, user_id: input.userId },
        redirectUrl: input.redirectUrl,
      })
      .catch((err: unknown) => {
        deps.log?.warn({ err }, "whop checkout failed");
        throw new HttpError(502, "checkout_failed");
      });
    if (!checkout.purchase_url) throw new HttpError(502, "checkout_failed");
    await sql`
      INSERT INTO checkout_sessions (id, kind, user_id, offer_id, tier, interval, whop_plan_id)
      VALUES (${checkout.id}, ${input.kind}, ${input.userId}, ${input.offerId ?? null}, ${input.tier ?? null},
              ${input.interval ?? null}, ${input.planId})`;
    return { url: checkout.purchase_url };
  }

  async function teacherCheckout(userId: string, tier: PaidTier, interval: BillingInterval) {
    const [current] = await sql`
      SELECT * FROM teacher_subscriptions WHERE user_id = ${userId} AND status IN ('trialing', 'active', 'past_due')`;
    if (current) throw new HttpError(409, "already_subscribed");
    const planId = await teacherPlanId(tier, interval);
    return startCheckout({
      kind: "teacher_subscription",
      userId,
      planId,
      tier,
      interval,
      metadata: { tier, interval },
      redirectUrl: `${webUrl}/billing?checkout=done`,
    });
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
      const [{ taken }] = (await sql`
        SELECT count(*)::int AS taken FROM entitlements
        WHERE offer_id = ${offerId} AND status IN ('active', 'trialing', 'past_due')`) as unknown as [{ taken: number }];
      if (taken >= offer.seatLimit) throw new HttpError(409, "offer_sold_out");
    }
    const [sub] = await sql`
      SELECT tier FROM teacher_subscriptions WHERE user_id = ${offer.ownerId} AND status IN ('trialing', 'active', 'past_due')`;
    if (!sub || !TIERS[sub.tier as PaidTier].canSell) throw new HttpError(403, "selling_paused");
    const planId = await offerPlanId(offerId);
    return startCheckout({
      kind: "offer",
      userId,
      planId,
      offerId,
      metadata: { offer_id: offerId, server_id: offer.serverId, teacher_id: offer.ownerId },
      redirectUrl: `${webUrl}/s/${offer.serverId}?purchase=${offerId}`,
    });
  }

  /* --------------------------- webhook handling --------------------------- */

  async function userExists(id: string | null) {
    if (!id) return false;
    const [row] = await sql`SELECT 1 FROM users WHERE id = ${id}`;
    return Boolean(row);
  }

  /** Ties a Whop payment/membership back to a Majlis user and what they bought. */
  async function resolve(opts: {
    metadata: Record<string, unknown> | null | undefined;
    checkoutId?: string | null;
    planId?: string | null;
    membershipId?: string | null;
  }): Promise<Resolved | null> {
    const meta = opts.metadata ?? {};
    const metaUser = str(meta.user_id);
    if (meta.kind === "offer" && str(meta.offer_id) && (await userExists(metaUser))) {
      return { kind: "offer", userId: metaUser!, offerId: str(meta.offer_id)! };
    }
    if (meta.kind === "teacher_subscription" && (await userExists(metaUser))) {
      const fromPlan = await teacherPlanByWhopId(opts.planId);
      const tier = (str(meta.tier) as PaidTier | null) ?? fromPlan?.tier;
      if (tier && tier in TIERS) {
        return { kind: "teacher_subscription", userId: metaUser!, tier, interval: (str(meta.interval) as BillingInterval) ?? fromPlan?.interval ?? null };
      }
    }
    if (opts.checkoutId) {
      const [cs] = await sql`SELECT * FROM checkout_sessions WHERE id = ${opts.checkoutId}`;
      if (cs?.kind === "offer") return { kind: "offer", userId: cs.userId, offerId: cs.offerId };
      if (cs?.kind === "teacher_subscription") {
        return { kind: "teacher_subscription", userId: cs.userId, tier: cs.tier, interval: cs.interval };
      }
    }
    if (opts.membershipId) {
      const [ts] = await sql`SELECT * FROM teacher_subscriptions WHERE whop_membership_id = ${opts.membershipId}`;
      if (ts) {
        const fromPlan = await teacherPlanByWhopId(opts.planId);
        return { kind: "teacher_subscription", userId: ts.userId, tier: fromPlan?.tier ?? ts.tier, interval: fromPlan?.interval ?? ts.interval };
      }
      const [ent] = await sql`SELECT * FROM entitlements WHERE whop_membership_id = ${opts.membershipId}`;
      if (ent) return { kind: "offer", userId: ent.userId, offerId: ent.offerId };
    }
    return null;
  }

  async function book(
    tx: Tx,
    e: {
      teacherId: string;
      serverId: string | null;
      type: LedgerType;
      amountMinor: number;
      currency: string;
      ref: string;
      paymentId?: string | null;
      payoutId?: string | null;
      availableAt?: Date;
      note?: string | null;
    },
  ) {
    if (e.amountMinor === 0) return;
    await tx`
      INSERT INTO ledger_entries (id, teacher_user_id, server_id, type, amount_minor, currency, payment_id, payout_id, ref, note, available_at)
      VALUES (${newId()}, ${e.teacherId}, ${e.serverId}, ${e.type}, ${e.amountMinor}, ${e.currency.toLowerCase()},
              ${e.paymentId ?? null}, ${e.payoutId ?? null}, ${e.ref}, ${e.note ?? null}, ${e.availableAt ?? new Date()})
      ON CONFLICT (ref) DO NOTHING`;
  }

  async function accessChanged(userId: string, serverId: string) {
    await emit({ userIds: [userId] }, { t: "ACCESS_UPDATE", d: { serverId } });
  }

  async function upsertTeacherSubscription(
    r: Extract<Resolved, { kind: "teacher_subscription" }>,
    fields: {
      status: SubscriptionStatus;
      membershipId?: string | null;
      planId?: string | null;
      periodEnd?: string | null;
      cancelAtPeriodEnd?: boolean;
      manageUrl?: string | null;
    },
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

  async function handlePaymentSucceeded(p: WhopPayment) {
    const planId = p.variant_id ?? p.plan_id ?? null;
    const r = await resolve({ metadata: p.metadata, checkoutId: p.checkout_configuration_id, planId, membershipId: p.membership_id });
    if (!r) {
      deps.log?.warn({ paymentId: p.id }, "whop payment not tied to a Majlis user; ignored");
      return;
    }
    if (p.checkout_configuration_id) {
      await sql`UPDATE checkout_sessions SET completed_at = COALESCE(completed_at, now()) WHERE id = ${p.checkout_configuration_id}`;
    }
    const currency = (p.currency ?? (typeof p.total === "object" && p.total ? p.total.currency : "usd")).toLowerCase();
    const total = toMinor(p.total);
    const afterFees = p.amount_after_fees == null ? total : toMinor(p.amount_after_fees);
    const whopFee = Math.max(0, total - afterFees);

    if (r.kind === "teacher_subscription") {
      await sql`
        INSERT INTO payments (id, kind, user_id, whop_membership_id, currency, total_minor, whop_fee_minor, status, raw)
        VALUES (${p.id}, 'teacher_subscription', ${r.userId}, ${p.membership_id}, ${currency}, ${total}, ${whopFee}, ${p.status}, ${sql.json(p as never)})
        ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, raw = EXCLUDED.raw, updated_at = now()`;
      // A $0 payment is the start of a free trial, not a paid period.
      await upsertTeacherSubscription(r, { status: total > 0 ? "active" : "trialing", membershipId: p.membership_id, planId });
      return;
    }

    const [offer] = await sql`
      SELECT o.*, s.owner_id FROM offers o JOIN servers s ON s.id = o.server_id WHERE o.id = ${r.offerId}`;
    if (!offer) {
      deps.log?.warn({ paymentId: p.id, offerId: r.offerId }, "payment for a deleted offer");
      return;
    }
    const teacherId = offer.ownerId as string;
    const ownerTier = (await sql`
      SELECT tier FROM teacher_subscriptions WHERE user_id = ${teacherId} AND status IN ('trialing', 'active', 'past_due')`)[0]
      ?.tier as PaidTier | undefined;
    // A lapsed teacher's renewals still pay the Starter fee.
    const feeBps = TIERS[ownerTier ?? "starter"].platformFeeBps;
    const platformFee = Math.round((total * feeBps) / 10_000);
    const availableAt = new Date(Date.now() + deps.holdDays * 86_400_000);

    await sql.begin(async (tx) => {
      await tx`
        INSERT INTO payments (id, kind, user_id, offer_id, server_id, teacher_user_id, whop_membership_id, currency,
                              total_minor, whop_fee_minor, platform_fee_minor, status, raw)
        VALUES (${p.id}, 'offer', ${r.userId}, ${offer.id}, ${offer.serverId}, ${teacherId}, ${p.membership_id}, ${currency},
                ${total}, ${whopFee}, ${platformFee}, ${p.status}, ${tx.json(p as never)})
        ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, raw = EXCLUDED.raw, updated_at = now()`;
      const base = { teacherId, serverId: offer.serverId as string, currency, paymentId: p.id, availableAt };
      await book(tx, { ...base, type: "sale", amountMinor: total, ref: `sale:${p.id}`, note: offer.name });
      await book(tx, { ...base, type: "whop_fee", amountMinor: -whopFee, ref: `whop_fee:${p.id}` });
      await book(tx, { ...base, type: "platform_fee", amountMinor: -platformFee, ref: `platform_fee:${p.id}`, note: `${feeBps / 100}%` });
      await tx`
        INSERT INTO entitlements (id, user_id, offer_id, server_id, source, status, whop_membership_id)
        VALUES (${newId()}, ${r.userId}, ${offer.id}, ${offer.serverId}, 'whop', ${total > 0 ? "active" : "trialing"}, ${p.membership_id})
        ON CONFLICT (user_id, offer_id) DO UPDATE SET
          source = 'whop', status = EXCLUDED.status, ends_at = NULL,
          whop_membership_id = COALESCE(EXCLUDED.whop_membership_id, entitlements.whop_membership_id),
          updated_at = now()`;
    });
    await accessChanged(r.userId, offer.serverId);
  }

  async function handleMembership(m: WhopMembership) {
    const planId = m.variant_id ?? m.plan_id ?? null;
    const r = await resolve({ metadata: m.metadata, planId, membershipId: m.id });
    if (!r) return;

    if (r.kind === "teacher_subscription") {
      const status = subscriptionStatus(m.status);
      if (!status) return;
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

    const [offer] = await sql`SELECT id, server_id, billing FROM offers WHERE id = ${r.offerId}`;
    if (!offer) return;
    const status = entitlementStatus(m.status);
    if (!status) return;
    // Lifetime (one-time) purchases end only through a refund or chargeback, never a membership state.
    if (offer.billing === "one_time" && (status === "expired" || status === "past_due")) return;
    const ended = status === "expired";
    await sql`
      INSERT INTO entitlements (id, user_id, offer_id, server_id, source, status, whop_membership_id, ends_at)
      VALUES (${newId()}, ${r.userId}, ${offer.id}, ${offer.serverId}, 'whop', ${status}, ${m.id}, ${ended ? new Date() : null})
      ON CONFLICT (user_id, offer_id) DO UPDATE SET
        status = CASE WHEN entitlements.status = 'revoked' THEN 'revoked' ELSE EXCLUDED.status END,
        source = 'whop',
        whop_membership_id = EXCLUDED.whop_membership_id,
        ends_at = EXCLUDED.ends_at,
        updated_at = now()`;
    await accessChanged(r.userId, offer.serverId);
  }

  /** Ends the access a payment bought (refund in full, or chargeback). */
  async function revokeForPayment(payment: Row) {
    if (payment.kind !== "offer" || !payment.offerId || !payment.userId) return;
    await sql`
      UPDATE entitlements SET status = 'revoked', ends_at = now(), updated_at = now()
      WHERE user_id = ${payment.userId} AND offer_id = ${payment.offerId}`;
    await accessChanged(payment.userId, payment.serverId);
  }

  async function handleRefund(rf: WhopRefund) {
    if (rf.status !== "succeeded") return;
    const [payment] = await sql`SELECT * FROM payments WHERE id = ${rf.payment_id}`;
    if (!payment) return;
    const amount = toMinor(rf.amount);
    const done = await sql.begin(async (tx) => {
      const [fresh] = await tx`SELECT 1 FROM ledger_entries WHERE ref = ${"refund:" + rf.id}`;
      const [seen] = await tx`SELECT 1 FROM payments WHERE id = ${payment.id} AND raw ? ${"refund:" + rf.id}`;
      if (fresh || seen) return null;
      const [updated] = await tx`
        UPDATE payments SET refunded_minor = refunded_minor + ${amount}, updated_at = now(),
          raw = raw || ${tx.json({ ["refund:" + rf.id]: true } as never)}
        WHERE id = ${payment.id} RETURNING refunded_minor, total_minor`;
      if (payment.kind === "offer" && payment.teacherUserId) {
        const base = { teacherId: payment.teacherUserId, serverId: payment.serverId, currency: payment.currency, paymentId: payment.id };
        await book(tx, { ...base, type: "refund", amountMinor: -amount, ref: `refund:${rf.id}` });
        // Majlis returns its fee on the refunded part; Whop's processing fee is not returned.
        const feeBack = Number(payment.totalMinor) > 0 ? Math.round((Number(payment.platformFeeMinor) * amount) / Number(payment.totalMinor)) : 0;
        await book(tx, { ...base, type: "platform_fee", amountMinor: feeBack, ref: `refund_fee:${rf.id}` });
      }
      return updated;
    });
    if (done && Number(done.refundedMinor) >= Number(done.totalMinor)) await revokeForPayment(payment);
  }

  async function handleDispute(d: WhopDispute, type: string) {
    const paymentId = d.payment?.id;
    if (!paymentId) return;
    const [payment] = await sql`SELECT * FROM payments WHERE id = ${paymentId}`;
    if (!payment || payment.kind !== "offer" || !payment.teacherUserId) return;
    const amount = typeof d.amount === "number" ? toMinor(d.amount) : toMinor(d.amount);
    const base = { teacherId: payment.teacherUserId, serverId: payment.serverId, currency: payment.currency, paymentId };
    if (type === "dispute.created" || (type === "dispute.updated" && d.status === "lost")) {
      await book(sql, { ...base, type: "chargeback", amountMinor: -amount, ref: `chargeback:${d.id}` });
      if (d.fee) await book(sql, { ...base, type: "chargeback", amountMinor: -toMinor(d.fee), ref: `chargeback_fee:${d.id}` });
      await revokeForPayment(payment);
    }
    if (type === "dispute.updated" && d.status === "won") {
      const [booked] = await sql`SELECT 1 FROM ledger_entries WHERE ref = ${"chargeback:" + d.id}`;
      if (booked) await book(sql, { ...base, type: "adjustment", amountMinor: amount, ref: `chargeback_won:${d.id}` });
    }
  }

  /** Processes one verified webhook event. Throwing makes Whop retry. */
  async function handleEvent(event: { type: string; data: any }) {
    switch (event.type) {
      case "payment.succeeded":
        return handlePaymentSucceeded(event.data as WhopPayment);
      case "membership.activated":
      case "membership.deactivated":
      case "membership.updated":
      case "membership.cancel_at_period_end_changed":
        return handleMembership(event.data as WhopMembership);
      case "refund.created":
      case "refund.updated":
        return handleRefund(event.data as WhopRefund);
      case "dispute.created":
      case "dispute.updated":
        return handleDispute(event.data as WhopDispute, event.type);
      default:
        return; // payment.failed etc.: membership events carry the state change
    }
  }

  return {
    teacherCheckout,
    offerCheckout,
    teacherPlanId,
    offerPlanId,
    retireOfferPlan,
    handleEvent,
    book,
  };
}

export type Billing = ReturnType<typeof createBilling>;
