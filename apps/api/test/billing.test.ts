import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type {
  AuthResponse,
  BillingInfo,
  Channel,
  Course,
  Earnings,
  Invite,
  Lesson,
  Offer,
  ServerDetail,
  ServerEvent,
} from "@majlis/shared";
import { buildApp } from "../src/app";
import { createBus } from "../src/bus";
import { config } from "../src/config";
import { createDb } from "../src/db";
import { migrate } from "../src/migrate";
import { localStorage } from "../src/storage";
import { signWhopWebhook, toMinor, verifyWhopWebhook, type CreatePlanInput, type WhopApi } from "../src/whop";

const DB_URL = process.env.TEST_DATABASE_URL ?? "postgres://majlis:majlis@localhost:5432/majlis_test";
const SECRET = "ws_test_0123456789abcdef";
const sql = createDb(DB_URL);
let app: Awaited<ReturnType<typeof buildApp>>;
let base = "";
let dir = "";

/** In-memory stand-in for Whop that records what Majlis asked for. */
function fakeWhop() {
  let n = 0;
  const products: { id: string; title: string; metadata?: Record<string, string> }[] = [];
  const plans: (CreatePlanInput & { id: string })[] = [];
  const checkouts: { id: string; planId: string; metadata: Record<string, string>; redirectUrl: string }[] = [];
  const archived: string[] = [];
  const api: WhopApi = {
    env: "sandbox",
    async createProduct(input) {
      const p = { id: `prod_${++n}`, ...input };
      products.push(p);
      return p;
    },
    async createPlan(input) {
      const p = { id: `plan_${++n}`, ...input };
      plans.push(p);
      return { id: p.id };
    },
    async archivePlan(id) {
      archived.push(id);
    },
    async createCheckout(input) {
      const c = { id: `ch_${++n}`, ...input };
      checkouts.push(c);
      return { id: c.id, purchase_url: `https://sandbox.whop.com/checkout/${c.id}/` };
    },
    async getMembership(id) {
      return { id, status: "active", metadata: {}, current_period_end: null, cancel_at_period_end: false };
    },
  };
  return { api, products, plans, checkouts, archived };
}
const whop = fakeWhop();

async function api<T = any>(method: string, path: string, token?: string, body?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    /* csv */
  }
  return { status: res.status, body: parsed as T, text };
}

let hookN = 0;
async function webhook(type: string, data: unknown, opts: { id?: string; secret?: string } = {}) {
  const body = JSON.stringify({ id: `msg_${hookN}`, type, api_version: "v1", timestamp: new Date().toISOString(), data });
  const headers = signWhopWebhook(body, opts.secret ?? SECRET, opts.id ?? `msg_${++hookN}`);
  const res = await fetch(`${base}/webhooks/whop`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body });
  return { status: res.status, body: (await res.json()) as any };
}

const money = (amount: string, currency = "sar") => ({ amount, currency, decimals: 2, display_decimals: 2 });

const uniq = () => Math.random().toString(36).slice(2, 8);
async function register(name: string, email?: string) {
  const u = uniq();
  const r = await api<AuthResponse>("POST", "/auth/register", undefined, {
    email: email ?? `${u}@ex.com`,
    username: `u_${u}`,
    displayName: name,
    password: "password123",
  });
  expect(r.status).toBe(201);
  return r.body;
}

function connect(token: string) {
  const ws = new WebSocket(`${base.replace("http", "ws")}/gateway?token=${token}`);
  const events: ServerEvent[] = [];
  ws.on("message", (raw) => events.push(JSON.parse(raw.toString())));
  const ready = new Promise<void>((resolve) => ws.on("message", (raw) => JSON.parse(raw.toString()).t === "READY" && resolve()));
  return { ws, events, ready };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let teacher: AuthResponse;
let student: AuthResponse;
let admin: AuthResponse;
let serverId: string;
let freeChannel: string;
let vipChannel: string;
let courseId: string;
let offer: Offer;

beforeAll(async () => {
  config.whop.webhookSecret = SECRET;
  config.platformAdminEmails.push("owner@majlis.test");
  await sql`DROP SCHEMA public CASCADE`;
  await sql`CREATE SCHEMA public`;
  await migrate(sql, () => {});
  dir = await mkdtemp(join(tmpdir(), "majlis-billing-"));
  const storage = localStorage({ dir, secret: "test-secret", baseUrl: "http://placeholder" });
  app = await buildApp({ sql, bus: createBus(null), storage, logger: false, whop: whop.api });
  await app.listen({ port: 0, host: "127.0.0.1" });
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  storage.setBaseUrl(base);

  teacher = await register("المعلمة");
  student = await register("الطالب");
  admin = await register("المالك", "owner@majlis.test");
  const s = await api<ServerDetail>("POST", "/servers", teacher.token, { name: "أكاديمية التصميم" });
  serverId = s.body.server.id;
  freeChannel = s.body.channels[0]!.id;
  vipChannel = (await api<Channel>("POST", `/servers/${serverId}/channels`, teacher.token, { name: "vip" })).body.id;
  courseId = (await api<Channel>("POST", `/servers/${serverId}/channels`, teacher.token, { name: "دورة", type: "course" })).body.id;
  const inv = await api<Invite>("POST", `/servers/${serverId}/invites`, teacher.token, {});
  await api("POST", `/invites/${inv.body.code}`, student.token);
});

afterAll(async () => {
  await app.close();
  await sql.end();
  await rm(dir, { recursive: true, force: true });
});

describe("whop helpers", () => {
  it("converts money and verifies signatures like Whop", () => {
    expect(toMinor(money("99.00"))).toBe(9900);
    expect(toMinor(money("0.5"))).toBe(50);
    expect(toMinor({ amount: "1000", currency: "jpy", decimals: 0 })).toBe(100000);
    expect(toMinor(12.34)).toBe(1234);
    expect(toMinor(null)).toBe(0);
    const body = '{"a":1}';
    const h = signWhopWebhook(body, SECRET, "msg_x");
    expect(verifyWhopWebhook(body, h, SECRET).id).toBe("msg_x");
    expect(() => verifyWhopWebhook(body + " ", h, SECRET)).toThrow();
    expect(() => verifyWhopWebhook(body, h, "ws_other")).toThrow();
    const old = signWhopWebhook(body, SECRET, "msg_y", Math.floor(Date.now() / 1000) - 3600);
    expect(() => verifyWhopWebhook(body, old, SECRET)).toThrow();
  });
});

describe("teacher subscription (phase 3)", () => {
  it("starts on the free tier with its limits", async () => {
    const b = await api<BillingInfo>("GET", "/billing", teacher.token);
    expect(b.status).toBe(200);
    expect(b.body.tier).toBe("free");
    expect(b.body.subscription).toBeNull();
    expect(b.body.usage.ownedServers).toBe(1);
    // Free: one server, no selling.
    expect((await api("POST", "/servers", teacher.token, { name: "ثاني" })).status).toBe(403);
    const o = await api("POST", `/servers/${serverId}/offers`, teacher.token, {
      name: "x", priceMinor: 9900, billing: "one_time", grants: [{ targetType: "server", targetId: serverId }],
    });
    expect(o.status).toBe(403);
    expect(o.body.error).toBe("tier_cannot_sell");
  });

  it("creates a Whop checkout for a teacher plan and reuses the catalog", async () => {
    const c = await api<{ url: string }>("POST", "/billing/checkout", teacher.token, { tier: "pro", interval: "monthly" });
    expect(c.status).toBe(200);
    expect(c.body.url).toMatch(/^https:\/\/sandbox\.whop\.com\/checkout\//);
    expect(whop.products.length).toBe(1);
    expect(whop.plans[0]).toMatchObject({ price: 79, currency: "usd", billing: "monthly", trialDays: 14 });
    const ch = whop.checkouts.at(-1)!;
    expect(ch.metadata).toMatchObject({ kind: "teacher_subscription", user_id: teacher.user.id, tier: "pro" });
    expect(ch.redirectUrl).toContain("/billing?checkout=done");
    await api("POST", "/billing/checkout", teacher.token, { tier: "pro", interval: "monthly" });
    expect(whop.plans.length).toBe(1); // same plan reused
  });

  it("activates the trial from the membership webhook and lifts the limits", async () => {
    const plan = whop.plans[0]!;
    const trialEnd = new Date(Date.now() + 14 * 86_400_000).toISOString();
    // Whop drops our metadata here on purpose: the plan id + checkout map it back.
    const r = await webhook("membership.activated", {
      id: "mem_teacher",
      status: "trialing",
      variant_id: plan.id,
      metadata: { kind: "teacher_subscription", user_id: teacher.user.id, tier: "pro", interval: "monthly" },
      current_period_end: trialEnd,
      cancel_at_period_end: false,
      manage_url: "https://sandbox.whop.com/orders/mem_teacher/manage",
    });
    expect(r.status).toBe(200);
    const b = await api<BillingInfo>("GET", "/billing", teacher.token);
    expect(b.body.tier).toBe("pro");
    expect(b.body.subscription).toMatchObject({ tier: "pro", status: "trialing", interval: "monthly" });
    expect(b.body.subscription!.trialEndsAt).toBe(trialEnd);
    expect(b.body.limits.platformFeeBps).toBe(200);
    // Already subscribed: no second checkout.
    expect((await api("POST", "/billing/checkout", teacher.token, { tier: "academy" })).status).toBe(409);
  });

  it("rejects bad signatures and ignores duplicate deliveries", async () => {
    expect((await webhook("membership.updated", { id: "mem_teacher" }, { secret: "ws_wrong" })).status).toBe(401);
    const data = { id: "pay_teacher_1", status: "paid", currency: "usd", total: money("79.00", "usd"), amount_after_fees: money("75.00", "usd"),
      membership_id: "mem_teacher", variant_id: whop.plans[0]!.id, product_id: "prod_1", checkout_configuration_id: null, metadata: {} };
    expect((await webhook("payment.succeeded", data, { id: "msg_dup" })).status).toBe(200);
    const again = await webhook("payment.succeeded", data, { id: "msg_dup" });
    expect(again.body.duplicate).toBe(true);
    const b = await api<BillingInfo>("GET", "/billing", teacher.token);
    expect(b.body.subscription!.status).toBe("active");
    // Teacher subscription payments never touch the earnings ledger.
    const [{ n }] = (await sql`SELECT count(*)::int AS n FROM ledger_entries`) as unknown as [{ n: number }];
    expect(n).toBe(0);
  });
});

describe("offers and paid access (phase 4)", () => {
  it("lets the owner create offers and make channels paid", async () => {
    const r = await api<Offer>("POST", `/servers/${serverId}/offers`, teacher.token, {
      name: "الاشتراك الكامل",
      description: "كل الدورات وقناة VIP",
      priceMinor: 9900,
      currency: "sar",
      billing: "one_time",
      grants: [{ targetType: "channel", targetId: vipChannel }, { targetType: "channel", targetId: courseId }],
    });
    expect(r.status).toBe(201);
    offer = r.body;
    expect(offer.grants).toHaveLength(2);
    expect(offer.owned).toBe(false);
    // Grants must point inside the server.
    expect((await api("POST", `/servers/${serverId}/offers`, teacher.token, {
      name: "bad", priceMinor: 100, billing: "monthly", grants: [{ targetType: "server", targetId: "nope" }],
    })).status).toBe(400);
    // Members can't create offers.
    expect((await api("POST", `/servers/${serverId}/offers`, student.token, {
      name: "x", priceMinor: 100, billing: "monthly", grants: [{ targetType: "server", targetId: serverId }],
    })).status).toBe(403);

    expect((await api("PUT", `/channels/${vipChannel}/access`, student.token, { access: "paid" })).status).toBe(403);
    expect((await api("PUT", `/channels/${vipChannel}/access`, teacher.token, { access: "paid" })).status).toBe(200);
    expect((await api("PUT", `/channels/${courseId}/access`, teacher.token, { access: "paid" })).status).toBe(200);
  });

  it("locks paid content for members without an offer", async () => {
    const d = await api<ServerDetail>("GET", `/servers/${serverId}`, student.token);
    const vip = d.body.channels.find((c) => c.id === vipChannel)!;
    expect(vip).toMatchObject({ access: "paid", locked: true });
    expect(d.body.channels.find((c) => c.id === freeChannel)!.locked).toBe(false);
    expect((await api<ServerDetail>("GET", `/servers/${serverId}`, teacher.token)).body.channels.find((c) => c.id === vipChannel)!.locked).toBe(false);

    expect((await api("GET", `/channels/${vipChannel}/messages`, student.token)).status).toBe(403);
    const send = await api("POST", `/channels/${vipChannel}/messages`, student.token, { content: "مرحبا" });
    expect(send.status).toBe(403);
    expect(send.body.error).toBe("locked");
    expect((await api("POST", `/channels/${vipChannel}/messages`, teacher.token, { content: "سر VIP" })).status).toBe(201);
    expect((await api("GET", `/servers/${serverId}/search?q=سر`, student.token)).body).toHaveLength(0);
    expect((await api("GET", `/servers/${serverId}/search?q=سر`, teacher.token)).body).toHaveLength(1);

    // Course: outline visible, lessons locked except free previews.
    const sec = await api<{ id: string }>("POST", `/courses/${courseId}/sections`, teacher.token, { title: "البداية" });
    const l1 = await api<Lesson>("POST", `/courses/${courseId}/lessons`, teacher.token, { sectionId: sec.body.id, title: "مقدمة" });
    const l2 = await api<Lesson>("POST", `/courses/${courseId}/lessons`, teacher.token, { sectionId: sec.body.id, title: "الدرس الأول" });
    expect((await api("PUT", `/lessons/${l1.body.id}/preview`, teacher.token, { freePreview: true })).status).toBe(200);
    const c = await api<Course>("GET", `/courses/${courseId}`, student.token);
    expect(c.status).toBe(200);
    expect(c.body.locked).toBe(true);
    const lessons = c.body.sections[0]!.lessons;
    expect(lessons.map((l) => [l.freePreview, l.locked])).toEqual([[true, false], [false, true]]);
    expect((await api("GET", `/lessons/${l1.body.id}`, student.token)).status).toBe(200);
    expect((await api("GET", `/lessons/${l2.body.id}`, student.token)).status).toBe(403);
    expect((await api("PUT", `/lessons/${l2.body.id}/progress`, student.token, { completed: true })).status).toBe(403);
  });

  it("doesn't push locked channels' messages over the gateway", async () => {
    const s = connect(student.token);
    await s.ready;
    await api("POST", `/channels/${vipChannel}/messages`, teacher.token, { content: "push vip" });
    await api("POST", `/channels/${freeChannel}/messages`, teacher.token, { content: "push free" });
    await sleep(150);
    const contents = s.events.filter((e) => e.t === "MESSAGE_CREATE").map((e) => (e as any).d.content);
    expect(contents).toEqual(["push free"]);
    s.ws.close();
  });

  it("buys an offer: checkout → webhook → access + ledger entries", async () => {
    const s = connect(student.token);
    await s.ready;
    const c = await api<{ url: string }>("POST", `/offers/${offer.id}/checkout`, student.token);
    expect(c.status).toBe(200);
    // Published to Whop on first checkout, on Majlis's account.
    const plan = whop.plans.at(-1)!;
    expect(plan).toMatchObject({ title: "الاشتراك الكامل", price: 99, currency: "sar", billing: "one_time" });
    expect(whop.products.at(-1)!.title).toBe("أكاديمية التصميم — الاشتراك الكامل");
    const ch = whop.checkouts.at(-1)!;
    expect(ch.metadata).toMatchObject({ kind: "offer", offer_id: offer.id, user_id: student.user.id, teacher_id: teacher.user.id });

    // Whop strips metadata in this payload: the checkout configuration id ties it back.
    const r = await webhook("payment.succeeded", {
      id: "pay_1", status: "paid", currency: "sar", total: money("99.00"), amount_after_fees: money("94.05"),
      membership_id: "mem_s1", variant_id: plan.id, product_id: "prod_x", checkout_configuration_id: ch.id, metadata: null,
    });
    expect(r.status).toBe(200);
    await sleep(100);
    expect(s.events.some((e) => e.t === "ACCESS_UPDATE" && e.d.serverId === serverId)).toBe(true);
    s.ws.close();

    expect((await api("GET", `/channels/${vipChannel}/messages`, student.token)).status).toBe(200);
    const d = await api<ServerDetail>("GET", `/servers/${serverId}`, student.token);
    expect(d.body.channels.find((c) => c.id === vipChannel)!.locked).toBe(false);
    const offers = await api<Offer[]>("GET", `/servers/${serverId}/offers`, student.token);
    expect(offers.body[0]).toMatchObject({ owned: true, seatsTaken: 1 });
    expect((await api("POST", `/offers/${offer.id}/checkout`, student.token)).status).toBe(409);

    const e = await api<Earnings>("GET", "/earnings", teacher.token);
    expect(e.body.balances).toEqual([
      // 99.00 − Whop 4.95 − Majlis 2% (Pro) 1.98 = 92.07, all on hold
      { currency: "sar", pendingMinor: 9207, availableMinor: 0, paidMinor: 0, grossSalesMinor: 9900 },
    ]);
    expect(e.body.entries.map((x) => [x.type, x.amountMinor]).sort()).toEqual([
      ["platform_fee", -198],
      ["sale", 9900],
      ["whop_fee", -495],
    ]);
    expect(e.body.holdDays).toBe(14);
  });

  it("refunds: books a negative entry, returns Majlis's fee share and revokes access", async () => {
    const rf = { id: "rfnd_1", status: "succeeded", payment_id: "pay_1", amount: money("99.00") };
    expect((await webhook("refund.created", rf)).status).toBe(200);
    expect((await webhook("refund.updated", rf)).status).toBe(200); // second delivery with a new id
    const e = await api<Earnings>("GET", "/earnings", teacher.token);
    const sum = e.body.entries.reduce((a, x) => a + x.amountMinor, 0);
    expect(sum).toBe(9900 - 495 - 198 - 9900 + 198); // = −495: Whop's fee isn't returned
    expect(e.body.entries.filter((x) => x.type === "refund")).toHaveLength(1);
    expect((await api("GET", `/channels/${vipChannel}/messages`, student.token)).status).toBe(403);
  });

  it("chargebacks revoke access; manual grants restore it", async () => {
    // Re-buy, then dispute.
    await webhook("payment.succeeded", {
      id: "pay_2", status: "paid", currency: "sar", total: money("99.00"), amount_after_fees: money("94.05"),
      membership_id: "mem_s2", checkout_configuration_id: null, product_id: null,
      metadata: { kind: "offer", offer_id: offer.id, user_id: student.user.id },
    });
    expect((await api("GET", `/channels/${vipChannel}/messages`, student.token)).status).toBe(200);
    await webhook("dispute.created", { id: "dp_1", status: "needs_response", amount: 99, currency: "sar", fee: money("15.00"), payment: { id: "pay_2" } });
    expect((await api("GET", `/channels/${vipChannel}/messages`, student.token)).status).toBe(403);
    const types = (await api<Earnings>("GET", "/earnings", teacher.token)).body.entries.filter((x) => x.type === "chargeback");
    expect(types.map((x) => x.amountMinor).sort((a, b) => a - b)).toEqual([-9900, -1500]);

    const g = await api("POST", `/servers/${serverId}/entitlements`, teacher.token, { userId: student.user.id, offerId: offer.id });
    expect(g.status).toBe(201);
    expect(g.body).toMatchObject({ source: "manual", status: "active" });
    expect((await api("GET", `/channels/${vipChannel}/messages`, student.token)).status).toBe(200);
    expect((await api("DELETE", `/entitlements/${g.body.id}`, teacher.token)).status).toBe(204);
    expect((await api("GET", `/channels/${vipChannel}/messages`, student.token)).status).toBe(403);
  });

  it("subscription offers follow the membership state", async () => {
    const monthly = await api<Offer>("POST", `/servers/${serverId}/offers`, teacher.token, {
      name: "شهري", priceMinor: 4900, billing: "monthly", trialDays: 7, grants: [{ targetType: "server", targetId: serverId }],
    });
    expect(monthly.status).toBe(201);
    await api("POST", `/offers/${monthly.body.id}/checkout`, student.token);
    const plan = whop.plans.at(-1)!;
    expect(plan).toMatchObject({ billing: "monthly", trialDays: 7, price: 49 });
    const meta = { kind: "offer", offer_id: monthly.body.id, user_id: student.user.id };
    await webhook("membership.activated", { id: "mem_m", status: "trialing", variant_id: plan.id, metadata: meta, current_period_end: null, cancel_at_period_end: false });
    expect((await api("GET", `/channels/${vipChannel}/messages`, student.token)).status).toBe(200); // server-wide grant
    await webhook("membership.deactivated", { id: "mem_m", status: "expired", variant_id: plan.id, metadata: {}, current_period_end: null, cancel_at_period_end: false });
    expect((await api("GET", `/channels/${vipChannel}/messages`, student.token)).status).toBe(403);

    // A price change creates a new plan on next checkout and archives the old one.
    await api("PATCH", `/offers/${monthly.body.id}`, teacher.token, { priceMinor: 5900 });
    expect(whop.archived).toContain(plan.id);
    await api("POST", `/offers/${monthly.body.id}/checkout`, student.token);
    expect(whop.plans.at(-1)).toMatchObject({ price: 59 });
  });
});

describe("earnings and owner payouts", () => {
  it("only the platform owner sees the Payouts page", async () => {
    expect((await api("GET", "/admin/payouts", teacher.token)).status).toBe(404);
    const me = await api("GET", "/me", admin.token);
    expect(me.body.isPlatformAdmin).toBe(true);
    expect((await api("GET", "/me", teacher.token)).body.isPlatformAdmin).toBe(false);
  });

  it("pays out only the available (post-hold) balance and records it in the ledger", async () => {
    // A clean sale whose hold has passed.
    await webhook("payment.succeeded", {
      id: "pay_3", status: "paid", currency: "sar", total: money("500.00"), amount_after_fees: money("475.00"),
      membership_id: null, checkout_configuration_id: null, product_id: null,
      metadata: { kind: "offer", offer_id: offer.id, user_id: student.user.id },
    });
    await sql`UPDATE ledger_entries SET available_at = now() - interval '1 day' WHERE payment_id = 'pay_3'`;

    const before = await api<Earnings>("GET", "/earnings", teacher.token);
    const sar = before.body.balances.find((b) => b.currency === "sar")!;
    // Sales wait out the hold, but refunds and chargebacks count immediately (Majlis carries the risk):
    // pay_3 465.00 − refund 99.00 + fee back 1.98 − chargeback 99.00 − dispute fee 15.00 = 253.98
    expect(sar.availableMinor).toBe(25398);

    // Not eligible until the teacher adds where to send money.
    let rows = (await api("GET", "/admin/payouts", admin.token)).body.rows;
    expect(rows[0]).toMatchObject({ eligible: false, teacher: { id: teacher.user.id } });
    expect((await api("PUT", "/earnings/payout-account", teacher.token, { whopUsername: "design_academy" })).status).toBe(200);
    rows = (await api("GET", "/admin/payouts", admin.token)).body.rows;
    expect(rows[0]).toMatchObject({ eligible: true, payoutAccount: { whopUsername: "design_academy" } });

    const csv = await api("GET", "/admin/payouts.csv", admin.token);
    expect(csv.status).toBe(200);
    expect(csv.text).toContain("design_academy,SAR,253.98");

    const tooMuch = await api("POST", "/admin/payouts", admin.token, { teacherId: teacher.user.id, currency: "SAR", amountMinor: 25399, whopReference: "x" });
    expect(tooMuch.status).toBe(409);
    expect((await api("POST", "/admin/payouts", teacher.token, { teacherId: teacher.user.id, currency: "SAR", amountMinor: 100, whopReference: "x" })).status).toBe(404);
    const paid = await api("POST", "/admin/payouts", admin.token, {
      teacherId: teacher.user.id, currency: "SAR", amountMinor: 25398, whopReference: "whop_tr_123", note: "أسبوع ١",
    });
    expect(paid.status).toBe(201);

    const after = await api<Earnings>("GET", "/earnings", teacher.token);
    const bal = after.body.balances.find((b) => b.currency === "sar")!;
    expect(bal.availableMinor).toBe(0);
    expect(bal.paidMinor).toBe(25398);
    expect(after.body.payouts[0]).toMatchObject({ amountMinor: 25398, whopReference: "whop_tr_123" });
    expect((await api("POST", "/admin/payouts", admin.token, { teacherId: teacher.user.id, currency: "SAR", amountMinor: 1, whopReference: "y" })).status).toBe(409);
  });
});
