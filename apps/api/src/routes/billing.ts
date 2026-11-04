import type { FastifyInstance } from "fastify";
import {
  channelAccessSchema,
  formatMinor,
  manualGrantSchema,
  markPaidSchema,
  newId,
  offerSchema,
  payoutAccountSchema,
  teacherCheckoutSchema,
  TIERS,
  updateOfferSchema,
  type AdminPayoutRow,
  type Balance,
  type BillingInfo,
  type Earnings,
  type Entitlement,
  type LedgerEntry,
  type Offer,
  type Payout,
  type TeacherTier,
} from "@majlis/shared";
import { requireAuth } from "../auth";
import type { Billing } from "../billing";
import { config } from "../config";
import type { Ctx } from "../context";
import { badRequest, forbidden, HttpError, notFound } from "../errors";
import { toChannel } from "../repo";
import { verifyWhopWebhook, WebhookSignatureError } from "../whop";

type Row = Record<string, any>;
const iso = (d: Date | string | null) => (d == null ? null : new Date(d).toISOString());
const num = (v: unknown) => Number(v ?? 0);

export function billingRoutes(app: FastifyInstance, ctx: Ctx & { billing: Billing }) {
  const { sql, repo, billing, emit } = ctx;

  async function isPlatformAdmin(userId: string) {
    const [row] = await sql<{ email: string }[]>`SELECT email FROM users WHERE id = ${userId}`;
    return Boolean(row && config.platformAdminEmails.includes(row.email.toLowerCase()));
  }
  async function requirePlatformAdmin(userId: string) {
    if (!(await isPlatformAdmin(userId))) throw notFound();
  }

  /* --------------------------- teacher billing --------------------------- */

  app.get("/billing", { preHandler: requireAuth }, async (req): Promise<BillingInfo> => {
    const [sub] = await sql`SELECT * FROM teacher_subscriptions WHERE user_id = ${req.userId}`;
    const tier: TeacherTier = await repo.tierOf(req.userId);
    const [{ owned } = { owned: 0 }] = await sql<{ owned: number }[]>`
      SELECT count(*)::int AS owned FROM servers WHERE owner_id = ${req.userId}`;
    return {
      tier,
      subscription: sub
        ? {
            tier: sub.tier,
            interval: sub.interval ?? null,
            status: sub.status,
            trialEndsAt: iso(sub.trialEndsAt),
            currentPeriodEnd: iso(sub.currentPeriodEnd),
            cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
            manageUrl: sub.manageUrl ?? null,
          }
        : null,
      limits: TIERS[tier],
      usage: { ownedServers: owned },
      tiers: TIERS,
    };
  });

  app.post("/billing/checkout", { preHandler: requireAuth }, async (req) => {
    const { tier, interval } = teacherCheckoutSchema.parse(req.body);
    return billing.teacherCheckout(req.userId, tier, interval);
  });

  /* -------------------------------- offers -------------------------------- */

  async function offersFor(serverId: string, viewerId: string, includeInactive: boolean): Promise<Offer[]> {
    const rows = await sql`
      SELECT o.*,
        COALESCE((SELECT json_agg(json_build_object('targetType', g.target_type, 'targetId', g.target_id))
                  FROM offer_grants g WHERE g.offer_id = o.id), '[]'::json) AS grants,
        (SELECT count(*)::int FROM entitlements e
          WHERE e.offer_id = o.id AND e.status IN ('active', 'trialing', 'past_due')) AS seats_taken,
        EXISTS (SELECT 1 FROM entitlements e WHERE e.offer_id = o.id AND e.user_id = ${viewerId}
          AND e.status IN ('active', 'trialing', 'past_due') AND (e.ends_at IS NULL OR e.ends_at > now())) AS owned
      FROM offers o
      WHERE o.server_id = ${serverId} ${includeInactive ? sql`` : sql`AND o.active`}
      ORDER BY o.position, o.created_at`;
    return rows.map(toOffer);
  }

  const toOffer = (r: Row): Offer => ({
    id: r.id,
    serverId: r.serverId,
    name: r.name,
    description: r.description,
    priceMinor: num(r.priceMinor),
    currency: r.currency,
    billing: r.billing,
    trialDays: r.trialDays ?? null,
    seatLimit: r.seatLimit ?? null,
    seatsTaken: r.seatsTaken ?? 0,
    active: r.active,
    position: r.position,
    grants: r.grants ?? [],
    owned: Boolean(r.owned),
  });

  async function loadOffer(offerId: string) {
    const [row] = await sql`SELECT * FROM offers WHERE id = ${offerId}`;
    if (!row) throw notFound("offer_not_found");
    return row;
  }

  /** Only the server owner manages offers: the money is theirs. */
  async function requireOwner(serverId: string, userId: string) {
    const role = await repo.requireMember(serverId, userId);
    if (role !== "owner") throw forbidden();
  }

  async function validateGrants(serverId: string, grants: { targetType: string; targetId: string }[]) {
    for (const g of grants) {
      if (g.targetType === "server") {
        if (g.targetId !== serverId) throw badRequest("invalid_grant");
      } else {
        const ch = await repo.getChannel(g.targetId).catch(() => null);
        if (!ch || ch.serverId !== serverId || ch.type === "category") throw badRequest("invalid_grant");
      }
    }
  }

  app.get<{ Params: { id: string } }>("/servers/:id/offers", { preHandler: requireAuth }, async (req) => {
    const role = await repo.requireMember(req.params.id, req.userId);
    return offersFor(req.params.id, req.userId, role !== "member");
  });

  app.post<{ Params: { id: string } }>("/servers/:id/offers", { preHandler: requireAuth }, async (req, reply) => {
    const serverId = req.params.id;
    await requireOwner(serverId, req.userId);
    const input = offerSchema.parse(req.body);
    const { limits } = await repo.serverOwnerTier(serverId);
    if (!limits.canSell) throw new HttpError(403, "tier_cannot_sell");
    const [{ n } = { n: 0 }] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM offers WHERE server_id = ${serverId} AND active`;
    if (limits.maxOffersPerServer !== null && n >= limits.maxOffersPerServer) throw new HttpError(403, "tier_limit_offers");
    await validateGrants(serverId, input.grants);
    const id = newId();
    await sql.begin(async (tx) => {
      await tx`
        INSERT INTO offers (id, server_id, name, description, price_minor, currency, billing, trial_days, seat_limit, position)
        VALUES (${id}, ${serverId}, ${input.name}, ${input.description}, ${input.priceMinor}, ${input.currency}, ${input.billing},
                ${input.billing === "one_time" ? null : (input.trialDays ?? null)}, ${input.seatLimit ?? null}, ${n})`;
      for (const g of input.grants) {
        await tx`INSERT INTO offer_grants (offer_id, target_type, target_id) VALUES (${id}, ${g.targetType}, ${g.targetId}) ON CONFLICT DO NOTHING`;
      }
    });
    reply.code(201);
    return (await offersFor(serverId, req.userId, true)).find((o) => o.id === id)!;
  });

  app.patch<{ Params: { id: string } }>("/offers/:id", { preHandler: requireAuth }, async (req) => {
    const offer = await loadOffer(req.params.id);
    await requireOwner(offer.serverId, req.userId);
    const input = updateOfferSchema.parse(req.body);
    if (input.active === true && !offer.active) {
      const { limits } = await repo.serverOwnerTier(offer.serverId);
      if (!limits.canSell) throw new HttpError(403, "tier_cannot_sell");
      const [{ n } = { n: 0 }] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM offers WHERE server_id = ${offer.serverId} AND active`;
      if (limits.maxOffersPerServer !== null && n >= limits.maxOffersPerServer) throw new HttpError(403, "tier_limit_offers");
    }
    if (input.grants) await validateGrants(offer.serverId, input.grants);
    const billingType = input.billing ?? offer.billing;
    const priceChanged =
      (input.priceMinor !== undefined && input.priceMinor !== num(offer.priceMinor)) ||
      (input.currency !== undefined && input.currency !== offer.currency) ||
      (input.billing !== undefined && input.billing !== offer.billing) ||
      (input.trialDays !== undefined && (input.trialDays ?? null) !== (offer.trialDays ?? null));
    await sql.begin(async (tx) => {
      await tx`
        UPDATE offers SET
          name = ${input.name ?? offer.name},
          description = ${input.description ?? offer.description},
          price_minor = ${input.priceMinor ?? offer.priceMinor},
          currency = ${input.currency ?? offer.currency},
          billing = ${billingType},
          trial_days = ${billingType === "one_time" ? null : input.trialDays !== undefined ? input.trialDays : offer.trialDays},
          seat_limit = ${input.seatLimit !== undefined ? input.seatLimit : offer.seatLimit},
          active = ${input.active ?? offer.active},
          -- A new price means a new Whop plan for new buyers; current subscribers keep theirs.
          whop_plan_id = ${priceChanged ? null : offer.whopPlanId},
          updated_at = now()
        WHERE id = ${offer.id}`;
      if (input.grants) {
        await tx`DELETE FROM offer_grants WHERE offer_id = ${offer.id}`;
        for (const g of input.grants) {
          await tx`INSERT INTO offer_grants (offer_id, target_type, target_id) VALUES (${offer.id}, ${g.targetType}, ${g.targetId}) ON CONFLICT DO NOTHING`;
        }
      }
    });
    if (priceChanged) await billing.retireOfferPlan(offer.whopPlanId);
    if (input.grants) await emit({ serverIds: [offer.serverId] }, { t: "ACCESS_UPDATE", d: { serverId: offer.serverId } });
    return (await offersFor(offer.serverId, req.userId, true)).find((o) => o.id === offer.id)!;
  });

  /** Deletes an offer nobody holds; otherwise it's deactivated (buyers keep access). */
  app.delete<{ Params: { id: string } }>("/offers/:id", { preHandler: requireAuth }, async (req, reply) => {
    const offer = await loadOffer(req.params.id);
    await requireOwner(offer.serverId, req.userId);
    const [held] = await sql`SELECT 1 FROM entitlements WHERE offer_id = ${offer.id} LIMIT 1`;
    const [paid] = await sql`SELECT 1 FROM payments WHERE offer_id = ${offer.id} LIMIT 1`;
    if (held || paid) await sql`UPDATE offers SET active = false, updated_at = now() WHERE id = ${offer.id}`;
    else await sql`DELETE FROM offers WHERE id = ${offer.id}`;
    await billing.retireOfferPlan(offer.whopPlanId);
    reply.code(204);
  });

  app.post<{ Params: { id: string } }>("/offers/:id/checkout", { preHandler: requireAuth }, async (req) =>
    billing.offerCheckout(req.userId, req.params.id),
  );

  /* --------------------------- free / paid content --------------------------- */

  app.put<{ Params: { id: string } }>("/channels/:id/access", { preHandler: requireAuth }, async (req) => {
    const { channel, role } = await repo.channelAccess(req.params.id, req.userId);
    if (role === "member") throw forbidden();
    const { access } = channelAccessSchema.parse(req.body);
    if (channel.type === "category") throw badRequest("invalid_channel");
    if (access === "paid") {
      const { limits } = await repo.serverOwnerTier(channel.serverId);
      if (!limits.canSell) throw new HttpError(403, "tier_cannot_sell");
    }
    const [row] = await sql`UPDATE channels SET access = ${access} WHERE id = ${channel.id} RETURNING *`;
    const updated = toChannel(row!);
    await emit({ serverIds: [channel.serverId] }, { t: "ACCESS_UPDATE", d: { serverId: channel.serverId } });
    return updated;
  });

  /* ----------------------------- entitlements ----------------------------- */

  const toEntitlement = (r: Row): Entitlement => ({
    id: r.id,
    offerId: r.offerId,
    offerName: r.offerName,
    serverId: r.serverId,
    user: { id: r.userId, username: r.username, displayName: r.displayName, avatarUrl: r.avatarUrl ?? null },
    source: r.source,
    status: r.status,
    startsAt: iso(r.startsAt)!,
    endsAt: iso(r.endsAt),
  });

  async function entitlementRows(where: ReturnType<typeof sql>) {
    const rows = await sql`
      SELECT e.*, o.name AS offer_name, u.username, u.display_name, u.avatar_url
      FROM entitlements e JOIN offers o ON o.id = e.offer_id JOIN users u ON u.id = e.user_id
      WHERE ${where}
      ORDER BY e.created_at DESC LIMIT 500`;
    return rows.map(toEntitlement);
  }

  app.get<{ Params: { id: string } }>("/servers/:id/entitlements", { preHandler: requireAuth }, async (req) => {
    const role = await repo.requireMember(req.params.id, req.userId);
    if (role === "member") return entitlementRows(sql`e.server_id = ${req.params.id} AND e.user_id = ${req.userId}`);
    return entitlementRows(sql`e.server_id = ${req.params.id}`);
  });

  /** Manual access: scholarships, gifts, students who paid by bank transfer. */
  app.post<{ Params: { id: string } }>("/servers/:id/entitlements", { preHandler: requireAuth }, async (req, reply) => {
    const serverId = req.params.id;
    const role = await repo.requireMember(serverId, req.userId);
    if (role === "member") throw forbidden();
    const { userId, offerId } = manualGrantSchema.parse(req.body);
    const offer = await loadOffer(offerId);
    if (offer.serverId !== serverId) throw notFound("offer_not_found");
    if (!(await repo.membership(serverId, userId))) throw notFound("member_not_found");
    await sql`
      INSERT INTO entitlements (id, user_id, offer_id, server_id, source, status, granted_by)
      VALUES (${newId()}, ${userId}, ${offerId}, ${serverId}, 'manual', 'active', ${req.userId})
      ON CONFLICT (user_id, offer_id) DO UPDATE SET
        status = 'active', ends_at = NULL, granted_by = EXCLUDED.granted_by,
        source = CASE WHEN entitlements.status IN ('active', 'trialing', 'past_due') THEN entitlements.source ELSE 'manual' END,
        updated_at = now()`;
    await emit({ userIds: [userId] }, { t: "ACCESS_UPDATE", d: { serverId } });
    reply.code(201);
    const [ent] = await entitlementRows(sql`e.user_id = ${userId} AND e.offer_id = ${offerId}`);
    return ent;
  });

  app.delete<{ Params: { id: string } }>("/entitlements/:id", { preHandler: requireAuth }, async (req, reply) => {
    const [ent] = await sql`SELECT * FROM entitlements WHERE id = ${req.params.id}`;
    if (!ent) throw notFound("entitlement_not_found");
    const role = await repo.requireMember(ent.serverId, req.userId);
    if (role === "member") throw forbidden();
    // Revoking a paid entitlement doesn't refund it; refunds happen in Whop and arrive by webhook.
    await sql`UPDATE entitlements SET status = 'revoked', ends_at = now(), updated_at = now() WHERE id = ${ent.id}`;
    await emit({ userIds: [ent.userId] }, { t: "ACCESS_UPDATE", d: { serverId: ent.serverId } });
    reply.code(204);
  });

  /* ------------------------------- earnings ------------------------------- */

  async function balances(teacherId: string | null): Promise<(Balance & { teacherId: string })[]> {
    const rows = await sql`
      SELECT teacher_user_id, currency,
        COALESCE(SUM(amount_minor) FILTER (WHERE available_at > now()), 0) AS pending,
        COALESCE(SUM(amount_minor) FILTER (WHERE available_at <= now()), 0) AS available,
        COALESCE(-SUM(amount_minor) FILTER (WHERE type = 'payout'), 0) AS paid,
        COALESCE(SUM(amount_minor) FILTER (WHERE type = 'sale'), 0) AS gross
      FROM ledger_entries
      WHERE teacher_user_id IS NOT NULL ${teacherId ? sql`AND teacher_user_id = ${teacherId}` : sql``}
      GROUP BY teacher_user_id, currency
      ORDER BY currency`;
    return rows.map((r) => ({
      teacherId: r.teacherUserId,
      currency: r.currency,
      pendingMinor: num(r.pending),
      availableMinor: num(r.available),
      paidMinor: num(r.paid),
      grossSalesMinor: num(r.gross),
    }));
  }

  const toPayout = (r: Row): Payout => ({
    id: r.id,
    teacherId: r.teacherUserId,
    amountMinor: num(r.amountMinor),
    currency: r.currency,
    status: r.status,
    whopReference: r.whopReference ?? null,
    note: r.note ?? null,
    sentAt: iso(r.sentAt)!,
  });

  async function payoutAccount(teacherId: string) {
    const [row] = await sql`SELECT * FROM payout_accounts WHERE teacher_user_id = ${teacherId}`;
    return { whopUsername: row?.whopUsername ?? null, updatedAt: iso(row?.updatedAt ?? null) };
  }

  app.get("/earnings", { preHandler: requireAuth }, async (req): Promise<Earnings> => {
    const entries = await sql`
      SELECT l.*, s.name AS server_name FROM ledger_entries l LEFT JOIN servers s ON s.id = l.server_id
      WHERE l.teacher_user_id = ${req.userId}
      ORDER BY l.created_at DESC, l.id DESC LIMIT 200`;
    const payouts = await sql`SELECT * FROM payouts WHERE teacher_user_id = ${req.userId} ORDER BY sent_at DESC LIMIT 100`;
    return {
      balances: (await balances(req.userId)).map(({ teacherId: _, ...b }) => b),
      entries: entries.map(
        (r): LedgerEntry => ({
          id: r.id,
          type: r.type,
          amountMinor: num(r.amountMinor),
          currency: r.currency,
          serverId: r.serverId ?? null,
          serverName: r.serverName ?? null,
          paymentId: r.paymentId ?? null,
          payoutId: r.payoutId ?? null,
          note: r.note ?? null,
          availableAt: iso(r.availableAt)!,
          createdAt: iso(r.createdAt)!,
        }),
      ),
      payouts: payouts.map(toPayout),
      payoutAccount: await payoutAccount(req.userId),
      holdDays: config.payoutHoldDays,
      minPayoutMinor: config.payoutMinMinor,
    };
  });

  app.put("/earnings/payout-account", { preHandler: requireAuth }, async (req) => {
    const { whopUsername } = payoutAccountSchema.parse(req.body);
    await sql`
      INSERT INTO payout_accounts (teacher_user_id, whop_username) VALUES (${req.userId}, ${whopUsername})
      ON CONFLICT (teacher_user_id) DO UPDATE SET whop_username = EXCLUDED.whop_username, updated_at = now()`;
    return payoutAccount(req.userId);
  });

  /* --------------------------- owner: payouts --------------------------- */

  async function adminRows(): Promise<AdminPayoutRow[]> {
    const all = await balances(null);
    if (all.length === 0) return [];
    const ids = [...new Set(all.map((b) => b.teacherId))];
    const users = await sql`
      SELECT u.id, u.username, u.display_name, u.email, p.whop_username, p.updated_at AS account_updated_at
      FROM users u LEFT JOIN payout_accounts p ON p.teacher_user_id = u.id WHERE u.id = ANY(${ids})`;
    const byId = new Map(users.map((u) => [u.id as string, u]));
    return all
      .filter((b) => byId.has(b.teacherId))
      .map(({ teacherId, ...balance }) => {
        const u = byId.get(teacherId)!;
        return {
          teacher: { id: u.id, username: u.username, displayName: u.displayName, email: u.email },
          payoutAccount: { whopUsername: u.whopUsername ?? null, updatedAt: iso(u.accountUpdatedAt ?? null) },
          balance,
          eligible: balance.availableMinor >= config.payoutMinMinor && Boolean(u.whopUsername),
        };
      })
      .sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.balance.availableMinor - a.balance.availableMinor);
  }

  app.get("/admin/payouts", { preHandler: requireAuth }, async (req) => {
    await requirePlatformAdmin(req.userId);
    const history = await sql`SELECT * FROM payouts ORDER BY sent_at DESC LIMIT 200`;
    return { rows: await adminRows(), history: history.map(toPayout), minPayoutMinor: config.payoutMinMinor, holdDays: config.payoutHoldDays };
  });

  app.get("/admin/payouts.csv", { preHandler: requireAuth }, async (req, reply) => {
    await requirePlatformAdmin(req.userId);
    const rows = await adminRows();
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const lines = [
      ["teacher_id", "username", "email", "whop_username", "currency", "available", "pending", "paid", "eligible"].join(","),
      ...rows.map((r) =>
        [
          r.teacher.id,
          r.teacher.username,
          r.teacher.email,
          r.payoutAccount.whopUsername ?? "",
          r.balance.currency.toUpperCase(),
          formatMinor(r.balance.availableMinor, r.balance.currency).split(" ")[0]!,
          formatMinor(r.balance.pendingMinor, r.balance.currency).split(" ")[0]!,
          formatMinor(r.balance.paidMinor, r.balance.currency).split(" ")[0]!,
          r.eligible ? "yes" : "no",
        ]
          .map((v) => esc(String(v)))
          .join(","),
      ),
    ];
    reply.header("content-type", "text/csv; charset=utf-8");
    reply.header("content-disposition", `attachment; filename="majlis-payouts-${new Date().toISOString().slice(0, 10)}.csv"`);
    return "﻿" + lines.join("\n") + "\n";
  });

  /** The owner sent money in Whop; record it. Never more than the available balance. */
  app.post("/admin/payouts", { preHandler: requireAuth }, async (req, reply) => {
    await requirePlatformAdmin(req.userId);
    const input = markPaidSchema.parse(req.body);
    const currency = input.currency.toLowerCase();
    const payout = await sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${"payout:" + input.teacherId}))`;
      const [bal] = await tx<{ available: string }[]>`
        SELECT COALESCE(SUM(amount_minor), 0) AS available FROM ledger_entries
        WHERE teacher_user_id = ${input.teacherId} AND currency = ${currency} AND available_at <= now()`;
      if (input.amountMinor > num(bal?.available)) throw new HttpError(409, "exceeds_available_balance");
      const id = newId();
      const [row] = await tx`
        INSERT INTO payouts (id, teacher_user_id, amount_minor, currency, whop_reference, note, sent_by)
        VALUES (${id}, ${input.teacherId}, ${input.amountMinor}, ${currency}, ${input.whopReference}, ${input.note ?? null}, ${req.userId})
        RETURNING *`;
      await billing.book(tx, {
        teacherId: input.teacherId,
        serverId: null,
        type: "payout",
        amountMinor: -input.amountMinor,
        currency,
        payoutId: id,
        ref: `payout:${id}`,
        note: input.whopReference,
      });
      return row!;
    });
    reply.code(201);
    return toPayout(payout);
  });
}

/**
 * Whop webhooks. Registered in its own scope so the raw body is available for
 * signature verification.
 */
export function whopWebhookRoutes(app: FastifyInstance, ctx: Ctx & { billing: Billing }) {
  const { sql, billing } = ctx;
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => done(null, body));

  app.post("/webhooks/whop", async (req, reply) => {
    const secret = config.whop.webhookSecret;
    if (!secret) return reply.code(503).send({ error: "webhooks_not_configured" });
    const raw = typeof req.body === "string" ? req.body : "";
    let id: string;
    try {
      id = verifyWhopWebhook(raw, req.headers, secret).id;
    } catch (err) {
      if (err instanceof WebhookSignatureError) return reply.code(401).send({ error: "invalid_signature" });
      throw err;
    }
    const event = JSON.parse(raw) as { type: string; data: unknown };
    const inserted = await sql`
      INSERT INTO webhook_events (id, type) VALUES (${id}, ${event.type})
      ON CONFLICT (id) DO UPDATE SET error = webhook_events.error
      RETURNING processed_at`;
    if (inserted[0]?.processedAt) return { ok: true, duplicate: true };
    try {
      await billing.handleEvent(event);
      await sql`UPDATE webhook_events SET processed_at = now(), error = NULL WHERE id = ${id}`;
    } catch (err) {
      req.log.error({ err, webhookId: id, type: event.type }, "whop webhook failed");
      await sql`UPDATE webhook_events SET error = ${String((err as Error).message).slice(0, 500)} WHERE id = ${id}`;
      return reply.code(500).send({ error: "processing_failed" }); // Whop retries
    }
    return { ok: true };
  });
}
