import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  channelAccessSchema,
  connectWhopSchema,
  manualGrantSchema,
  newId,
  offerSchema,
  teacherCheckoutSchema,
  TIERS,
  updateOfferSchema,
  type BillingInfo,
  type Entitlement,
  type Offer,
  type Sale,
  type TeacherTier,
  type WhopConnectionInfo,
} from "@majlis/shared";
import { requireAuth } from "../auth";
import type { Billing, WebhookSource } from "../billing";
import { config } from "../config";
import type { Ctx } from "../context";
import { badRequest, forbidden, HttpError, notFound } from "../errors";
import { createLimiter } from "../ratelimit";
import { toChannel } from "../repo";
import { TEACHER_KEY_PERMISSIONS, verifyWhopWebhook, WebhookSignatureError } from "../whop";

type Row = Record<string, any>;
const iso = (d: Date | string | null) => (d == null ? null : new Date(d).toISOString());
const num = (v: unknown) => Number(v ?? 0);

export function billingRoutes(app: FastifyInstance, ctx: Ctx & { billing: Billing }) {
  const { sql, repo, billing, emit } = ctx;

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
    if (priceChanged) await billing.retireOfferPlan(req.userId, offer.whopPlanId, offer.connectionId);
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
    await billing.retireOfferPlan(req.userId, offer.whopPlanId, offer.connectionId);
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

  /* ----------------------- teacher's own Whop account ----------------------- */

  app.get("/whop/connection", { preHandler: requireAuth }, async (req): Promise<WhopConnectionInfo> => ({
    connection: await billing.getConnection(req.userId),
    requiredPermissions: [...TEACHER_KEY_PERMISSIONS],
    env: config.whop.env,
  }));

  const connectLimit = createLimiter(10, 60_000);
  app.put("/whop/connection", { preHandler: requireAuth }, async (req) => {
    connectLimit(req.userId);
    const { apiKey } = connectWhopSchema.parse(req.body);
    await billing.connect(req.userId, apiKey);
    return {
      connection: await billing.getConnection(req.userId),
      requiredPermissions: [...TEACHER_KEY_PERMISSIONS],
      env: config.whop.env,
    } satisfies WhopConnectionInfo;
  });

  app.delete("/whop/connection", { preHandler: requireAuth }, async (req, reply) => {
    await billing.disconnect(req.userId);
    reply.code(204);
  });

  /** Student payments to the teacher's Whop account (read-only; refunds and payouts happen in Whop). */
  app.get("/sales", { preHandler: requireAuth }, async (req): Promise<Sale[]> => {
    const rows = await sql`
      SELECT p.*, o.name AS offer_name, s.name AS server_name, u.display_name, u.username
      FROM payments p
      LEFT JOIN offers o ON o.id = p.offer_id
      LEFT JOIN servers s ON s.id = p.server_id
      LEFT JOIN users u ON u.id = p.user_id
      WHERE p.kind = 'offer' AND p.teacher_user_id = ${req.userId}
      ORDER BY p.created_at DESC LIMIT 500`;
    return rows.map((r) => ({
      id: r.id,
      offerName: r.offerName ?? null,
      serverName: r.serverName ?? null,
      student: r.userId ? { id: r.userId, displayName: r.displayName, username: r.username } : null,
      currency: r.currency,
      totalMinor: num(r.totalMinor),
      refundedMinor: num(r.refundedMinor),
      status: r.status,
      createdAt: iso(r.createdAt)!,
    }));
  });
}

/**
 * Whop webhooks. Registered in its own scope so the raw body is available for
 * signature verification.
 */
export function whopWebhookRoutes(app: FastifyInstance, ctx: Ctx & { billing: Billing }) {
  const { sql, billing } = ctx;
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => done(null, body));

  async function receive(req: FastifyRequest, reply: FastifyReply, secret: string, source: WebhookSource, accountId?: string) {
    const raw = typeof req.body === "string" ? req.body : "";
    let id: string;
    try {
      id = verifyWhopWebhook(raw, req.headers, secret).id;
    } catch (err) {
      if (err instanceof WebhookSignatureError) return reply.code(401).send({ error: "invalid_signature" });
      throw err;
    }
    const event = JSON.parse(raw) as { type: string; data: unknown; account_id?: string; company_id?: string };
    const from = event.account_id ?? event.company_id;
    if (accountId && from && from !== accountId) return reply.code(400).send({ error: "wrong_account" });
    // Webhook ids are unique per endpoint; namespace them so two endpoints can't collide.
    const key = source.kind === "platform" ? id : `${source.connectionId}:${id}`;
    const inserted = await sql`
      INSERT INTO webhook_events (id, type) VALUES (${key}, ${event.type})
      ON CONFLICT (id) DO UPDATE SET error = webhook_events.error
      RETURNING processed_at`;
    if (inserted[0]?.processedAt) return { ok: true, duplicate: true };
    try {
      await billing.handleEvent(event, source);
      await sql`UPDATE webhook_events SET processed_at = now(), error = NULL WHERE id = ${key}`;
    } catch (err) {
      req.log.error({ err, webhookId: key, type: event.type }, "whop webhook failed");
      await sql`UPDATE webhook_events SET error = ${String((err as Error).message).slice(0, 500)} WHERE id = ${key}`;
      return reply.code(500).send({ error: "processing_failed" }); // Whop retries
    }
    return { ok: true };
  }

  /** Majlis's own account: teacher plans. */
  app.post("/webhooks/whop", async (req, reply) => {
    const secret = config.whop.webhookSecret;
    if (!secret) return reply.code(503).send({ error: "webhooks_not_configured" });
    return receive(req, reply, secret, { kind: "platform" }, config.whop.accountId ?? undefined);
  });

  /** A teacher's own account: purchases of that teacher's offers. */
  app.post<{ Params: { connectionId: string } }>("/webhooks/whop/:connectionId", async (req, reply) => {
    const conn = await billing.connectionForWebhook(req.params.connectionId);
    if (!conn) return reply.code(404).send({ error: "unknown_connection" });
    return receive(req, reply, conn.secret, { kind: "connection", connectionId: conn.id, teacherId: conn.teacherId }, conn.accountId);
  });
}
