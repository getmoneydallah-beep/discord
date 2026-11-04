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
  Invite,
  Lesson,
  Offer,
  Sale,
  ServerDetail,
  ServerEvent,
  WhopConnectionInfo,
} from "@majlis/shared";
import { buildApp } from "../src/app";
import { createBus } from "../src/bus";
import { config } from "../src/config";
import { createSecretBox } from "../src/crypto";
import { createDb } from "../src/db";
import { migrate } from "../src/migrate";
import { localStorage } from "../src/storage";
import {
  missingPermissions,
  signWhopWebhook,
  toMinor,
  verifyWhopWebhook,
  WhopError,
  type CreatePlanInput,
  type WhopApi,
  type WhopConnector,
} from "../src/whop";

const DB_URL = process.env.TEST_DATABASE_URL ?? "postgres://majlis:majlis@localhost:5432/majlis_test";
const PLATFORM_SECRET = "ws_platform_test_secret";
const TEACHER_KEY = "apik_teacher_good_key_1234";
const OTHER_KEY = "apik_other_teacher_key_5678";
const NO_PERMS_KEY = "apik_missing_perms_key_0000";
const sql = createDb(DB_URL);
let app: Awaited<ReturnType<typeof buildApp>>;
let base = "";
let dir = "";

/** In-memory stand-in for one Whop account that records what Majlis asked for. */
function fakeAccount(id: string) {
  let n = 0;
  const state = {
    id,
    products: [] as { id: string; title: string }[],
    plans: [] as (CreatePlanInput & { id: string })[],
    checkouts: [] as { id: string; planId: string; metadata: Record<string, string>; redirectUrl: string }[],
    archived: [] as string[],
    webhooks: new Map<string, { url: string; secret: string }>(),
    missingWrite: [] as string[],
  };
  const deny = (perm: string) => {
    if (state.missingWrite.includes(perm)) {
      throw new WhopError(400, { error: { message: `Unauthorized: Actor is missing all required permissions: ${perm}` } });
    }
  };
  const api: WhopApi = {
    env: "sandbox",
    async createProduct(input) {
      deny("access_pass:create");
      const p = { id: `prod_${id}_${++n}`, title: input.title };
      state.products.push(p);
      return p;
    },
    async createPlan(input) {
      deny("plan:create");
      const p = { id: `plan_${id}_${++n}`, ...input };
      state.plans.push(p);
      return { id: p.id };
    },
    async archivePlan(planId) {
      state.archived.push(planId);
    },
    async createCheckout(input) {
      deny("checkout_configuration:create");
      const c = { id: `ch_${id}_${++n}`, ...input };
      state.checkouts.push(c);
      return { id: c.id, purchase_url: `https://sandbox.whop.com/checkout/${c.id}/` };
    },
    async getMembership(mid) {
      return { id: mid, status: "active", metadata: {}, current_period_end: null, cancel_at_period_end: false };
    },
    async createWebhook(input) {
      const hook = { id: `hook_${id}_${++n}`, secret: `ws_${id}_${n}_secret` };
      state.webhooks.set(hook.id, { url: input.url, secret: hook.secret });
      return hook;
    },
    async deleteWebhook(hid) {
      state.webhooks.delete(hid);
    },
    async checkReadPermissions() {
      return state.missingWrite.filter((p) => p.endsWith(":read"));
    },
  };
  return { api, state };
}

const platform = fakeAccount("biz_majlis");
const accounts = {
  [TEACHER_KEY]: fakeAccount("biz_teacher"),
  [OTHER_KEY]: fakeAccount("biz_other"),
  [NO_PERMS_KEY]: fakeAccount("biz_noperms"),
} as Record<string, ReturnType<typeof fakeAccount>>;
accounts[NO_PERMS_KEY]!.state.missingWrite.push("plan:basic:read", "payment:basic:read");
const connector: WhopConnector = {
  env: "sandbox",
  async account(apiKey) {
    const acct = accounts[apiKey];
    if (!acct) throw new WhopError(401, { error: { message: "Authentication failed" } });
    return { id: acct.state.id, title: `Account ${acct.state.id}` };
  },
  client: (apiKey) => accounts[apiKey]!.api,
};
const teacherAcct = accounts[TEACHER_KEY]!.state;

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
  return { status: res.status, body: (text ? JSON.parse(text) : undefined) as T, text };
}

let hookN = 0;
/** Delivers a signed webhook. `to` = "platform" (Majlis's account) or a teacher's webhook (its url + secret). */
async function webhook(
  to: "platform" | { url: string; secret: string },
  type: string,
  data: unknown,
  opts: { id?: string; secret?: string; accountId?: string } = {},
) {
  const path = to === "platform" ? "/webhooks/whop" : new URL(to.url).pathname;
  const secret = opts.secret ?? (to === "platform" ? PLATFORM_SECRET : to.secret);
  const body = JSON.stringify({ id: `msg_${hookN}`, type, api_version: "v1", account_id: opts.accountId, data });
  const headers = signWhopWebhook(body, secret, opts.id ?? `msg_${++hookN}`);
  const res = await fetch(base + path, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body });
  return { status: res.status, body: (await res.json()) as any };
}
const teacherHook = () => [...teacherAcct.webhooks.values()][0]!;

const money = (amount: string, currency = "sar") => ({ amount, currency, decimals: 2, display_decimals: 2 });

const uniq = () => Math.random().toString(36).slice(2, 8);
async function register(name: string) {
  const u = uniq();
  const r = await api<AuthResponse>("POST", "/auth/register", undefined, {
    email: `${u}@ex.com`,
    username: `u_${u}`,
    displayName: name,
    password: "password123",
  });
  expect(r.status).toBe(201);
  return r.body;
}

function connectWs(token: string) {
  const ws = new WebSocket(`${base.replace("http", "ws")}/gateway?token=${token}`);
  const events: ServerEvent[] = [];
  ws.on("message", (raw) => events.push(JSON.parse(raw.toString())));
  const ready = new Promise<void>((resolve) => ws.on("message", (raw) => JSON.parse(raw.toString()).t === "READY" && resolve()));
  return { ws, events, ready };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Puts a teacher on a paid plan via Majlis's own webhook. */
async function subscribe(userId: string, tier = "pro") {
  const r = await webhook("platform", "membership.activated", {
    id: `mem_${userId}`,
    status: "active",
    metadata: { kind: "teacher_subscription", user_id: userId, tier, interval: "monthly" },
    current_period_end: null,
    cancel_at_period_end: false,
  });
  expect(r.status).toBe(200);
}

let teacher: AuthResponse;
let student: AuthResponse;
let serverId: string;
let freeChannel: string;
let vipChannel: string;
let courseId: string;
let offer: Offer;

beforeAll(async () => {
  config.whop.webhookSecret = PLATFORM_SECRET;
  config.whop.accountId = "biz_majlis";
  config.webhookBaseUrl = "https://api.majlis.test";
  await sql`DROP SCHEMA public CASCADE`;
  await sql`CREATE SCHEMA public`;
  await migrate(sql, () => {});
  dir = await mkdtemp(join(tmpdir(), "majlis-billing-"));
  const storage = localStorage({ dir, secret: "test-secret", baseUrl: "http://placeholder" });
  app = await buildApp({ sql, bus: createBus(null), storage, logger: false, whop: platform.api, connector });
  await app.listen({ port: 0, host: "127.0.0.1" });
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  storage.setBaseUrl(base);

  teacher = await register("المعلمة");
  student = await register("الطالب");
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

describe("helpers", () => {
  it("converts money, verifies signatures like Whop, parses permission errors, encrypts keys", () => {
    expect(toMinor(money("99.00"))).toBe(9900);
    expect(toMinor(money("0.5"))).toBe(50);
    expect(toMinor({ amount: "1000", currency: "jpy", decimals: 0 })).toBe(100000);
    expect(toMinor(12.34)).toBe(1234);
    expect(toMinor(null)).toBe(0);
    const body = '{"a":1}';
    const h = signWhopWebhook(body, PLATFORM_SECRET, "msg_x");
    expect(verifyWhopWebhook(body, h, PLATFORM_SECRET).id).toBe("msg_x");
    expect(() => verifyWhopWebhook(body + " ", h, PLATFORM_SECRET)).toThrow();
    expect(() => verifyWhopWebhook(body, h, "ws_other")).toThrow();
    const old = signWhopWebhook(body, PLATFORM_SECRET, "msg_y", Math.floor(Date.now() / 1000) - 3600);
    expect(() => verifyWhopWebhook(body, old, PLATFORM_SECRET)).toThrow();

    // Real Whop error text.
    const err = new WhopError(400, { error: { type: "bad_request", message: "Unauthorized: Actor is missing all required permissions: company:basic:read" } });
    expect(missingPermissions(err)).toEqual(["company:basic:read"]);

    const box = createSecretBox("a".repeat(64));
    const sealed = box.seal(TEACHER_KEY);
    expect(sealed).not.toContain("teacher");
    expect(box.open(sealed)).toBe(TEACHER_KEY);
    const tampered = sealed.slice(0, -2) + (sealed.endsWith("A") ? "BB" : "AA");
    expect(() => box.open(tampered)).toThrow();
    expect(() => createSecretBox("b".repeat(64)).open(sealed)).toThrow();
  });
});

describe("teacher plans (Majlis's own Whop account)", () => {
  it("starts on the free tier, which can't sell or connect Whop", async () => {
    const b = await api<BillingInfo>("GET", "/billing", teacher.token);
    expect(b.body.tier).toBe("free");
    expect((await api("POST", "/servers", teacher.token, { name: "ثاني" })).status).toBe(403);
    const o = await api("POST", `/servers/${serverId}/offers`, teacher.token, {
      name: "x", priceMinor: 9900, billing: "one_time", grants: [{ targetType: "server", targetId: serverId }],
    });
    expect(o.body.error).toBe("tier_cannot_sell");
    const c = await api("PUT", "/whop/connection", teacher.token, { apiKey: TEACHER_KEY });
    expect(c.status).toBe(403);
    expect(c.body.error).toBe("tier_cannot_sell");
  });

  it("checks out on Majlis's account and activates from Majlis's webhook", async () => {
    const c = await api<{ url: string }>("POST", "/billing/checkout", teacher.token, { tier: "pro", interval: "monthly" });
    expect(c.status).toBe(200);
    expect(platform.state.plans[0]).toMatchObject({ price: 79, currency: "usd", billing: "monthly", trialDays: 14 });
    expect(platform.state.checkouts[0]!.metadata).toMatchObject({ kind: "teacher_subscription", user_id: teacher.user.id });
    const plan = platform.state.plans[0]!;
    const trialEnd = new Date(Date.now() + 14 * 86_400_000).toISOString();
    await webhook("platform", "membership.activated", {
      id: "mem_teacher", status: "trialing", variant_id: plan.id, current_period_end: trialEnd, cancel_at_period_end: false,
      metadata: { kind: "teacher_subscription", user_id: teacher.user.id, tier: "pro", interval: "monthly" },
    });
    // The $0 payment that starts a trial keeps it trialing.
    await webhook("platform", "payment.succeeded", {
      id: "pay_trial_0", status: "paid", currency: "usd", total: money("0.00", "usd"), amount_after_fees: money("0.00", "usd"),
      membership_id: "mem_teacher", variant_id: plan.id, product_id: null, checkout_configuration_id: platform.state.checkouts[0]!.id, metadata: {},
    });
    const b = await api<BillingInfo>("GET", "/billing", teacher.token);
    expect(b.body.tier).toBe("pro");
    expect(b.body.subscription).toMatchObject({ status: "trialing", trialEndsAt: trialEnd });
    expect((await api("POST", "/billing/checkout", teacher.token, { tier: "academy" })).status).toBe(409);
  });

  it("rejects bad signatures, the wrong account and duplicates", async () => {
    expect((await webhook("platform", "membership.updated", { id: "x" }, { secret: "ws_wrong" })).status).toBe(401);
    expect((await webhook("platform", "membership.updated", { id: "x" }, { accountId: "biz_someone_else" })).status).toBe(400);
    const data = { id: "pay_t1", status: "paid", currency: "usd", total: money("79.00", "usd"), amount_after_fees: money("75.00", "usd"),
      membership_id: "mem_teacher", variant_id: platform.state.plans[0]!.id, product_id: null, checkout_configuration_id: null, metadata: {} };
    expect((await webhook("platform", "payment.succeeded", data, { id: "msg_dup" })).status).toBe(200);
    expect((await webhook("platform", "payment.succeeded", data, { id: "msg_dup" })).body.duplicate).toBe(true);
    expect((await api<BillingInfo>("GET", "/billing", teacher.token)).body.subscription!.status).toBe("active");
  });
});

describe("connecting the teacher's own Whop account", () => {
  it("rejects bad keys and keys without the required permissions", async () => {
    const bad = await api("PUT", "/whop/connection", teacher.token, { apiKey: "apik_does_not_exist" });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("whop_key_rejected");
    expect((await api("PUT", "/whop/connection", teacher.token, { apiKey: "not-a-whop-api-key" })).body.error).toBe("invalid_whop_key");
    const noPerms = await api("PUT", "/whop/connection", teacher.token, { apiKey: NO_PERMS_KEY });
    expect(noPerms.status).toBe(400);
    expect(noPerms.body.error).toBe("whop_missing_permissions:plan:basic:read,payment:basic:read");
    expect((await api<WhopConnectionInfo>("GET", "/whop/connection", teacher.token)).body.connection).toBeNull();
  });

  it("connects: stores the key encrypted, creates a webhook on the teacher's account, never returns the key", async () => {
    const r = await api<WhopConnectionInfo>("PUT", "/whop/connection", teacher.token, { apiKey: TEACHER_KEY });
    expect(r.status).toBe(200);
    expect(r.body.connection).toMatchObject({ status: "active", accountId: "biz_teacher", keyLast4: "1234", webhookActive: true });
    expect(r.text).not.toContain(TEACHER_KEY);
    expect(r.body.requiredPermissions).toContain("checkout_configuration:create");
    const [row] = await sql`SELECT * FROM whop_connections`;
    expect(row!.apiKeyEnc).not.toContain(TEACHER_KEY);
    expect(row!.webhookSecretEnc).not.toContain("secret");
    const hook = teacherHook();
    expect(hook.url).toBe(`https://api.majlis.test/webhooks/whop/${row!.id}`);
  });

  it("won't let a second teacher connect the same Whop account", async () => {
    const other = await register("معلم آخر");
    await subscribe(other.user.id);
    const r = await api("PUT", "/whop/connection", other.token, { apiKey: TEACHER_KEY });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("whop_account_in_use");
  });
});

describe("offers sold on the teacher's account", () => {
  it("lets the owner create offers and make channels paid", async () => {
    const r = await api<Offer>("POST", `/servers/${serverId}/offers`, teacher.token, {
      name: "الاشتراك الكامل",
      priceMinor: 9900,
      currency: "sar",
      billing: "one_time",
      grants: [{ targetType: "channel", targetId: vipChannel }, { targetType: "channel", targetId: courseId }],
    });
    expect(r.status).toBe(201);
    offer = r.body;
    expect((await api("POST", `/servers/${serverId}/offers`, student.token, {
      name: "x", priceMinor: 100, billing: "monthly", grants: [{ targetType: "server", targetId: serverId }],
    })).status).toBe(403);
    expect((await api("PUT", `/channels/${vipChannel}/access`, teacher.token, { access: "paid" })).status).toBe(200);
    expect((await api("PUT", `/channels/${courseId}/access`, teacher.token, { access: "paid" })).status).toBe(200);
  });

  it("locks paid content (messages, search, lessons, pushes)", async () => {
    const d = await api<ServerDetail>("GET", `/servers/${serverId}`, student.token);
    expect(d.body.channels.find((c) => c.id === vipChannel)).toMatchObject({ access: "paid", locked: true });
    expect((await api("GET", `/channels/${vipChannel}/messages`, student.token)).status).toBe(403);
    expect((await api("POST", `/channels/${vipChannel}/messages`, student.token, { content: "مرحبا" })).body.error).toBe("locked");
    expect((await api("POST", `/channels/${vipChannel}/messages`, teacher.token, { content: "سر VIP" })).status).toBe(201);
    expect((await api("GET", `/servers/${serverId}/search?q=سر`, student.token)).body).toHaveLength(0);

    const sec = await api<{ id: string }>("POST", `/courses/${courseId}/sections`, teacher.token, { title: "البداية" });
    const l1 = await api<Lesson>("POST", `/courses/${courseId}/lessons`, teacher.token, { sectionId: sec.body.id, title: "مقدمة" });
    const l2 = await api<Lesson>("POST", `/courses/${courseId}/lessons`, teacher.token, { sectionId: sec.body.id, title: "الدرس الأول" });
    await api("PUT", `/lessons/${l1.body.id}/preview`, teacher.token, { freePreview: true });
    const c = await api<Course>("GET", `/courses/${courseId}`, student.token);
    expect(c.body.sections[0]!.lessons.map((l) => [l.freePreview, l.locked])).toEqual([[true, false], [false, true]]);
    expect((await api("GET", `/lessons/${l1.body.id}`, student.token)).status).toBe(200);
    expect((await api("GET", `/lessons/${l2.body.id}`, student.token)).status).toBe(403);

    const ws = connectWs(student.token);
    await ws.ready;
    await api("POST", `/channels/${vipChannel}/messages`, teacher.token, { content: "push vip" });
    await api("POST", `/channels/${freeChannel}/messages`, teacher.token, { content: "push free" });
    await sleep(150);
    expect(ws.events.filter((e) => e.t === "MESSAGE_CREATE").map((e) => (e as any).d.content)).toEqual(["push free"]);
    ws.ws.close();
  });

  it("buys an offer: checkout on the teacher's account → their webhook → access", async () => {
    const c = await api<{ url: string }>("POST", `/offers/${offer.id}/checkout`, student.token);
    expect(c.status).toBe(200);
    // Everything was created on the TEACHER's Whop account, nothing on Majlis's.
    expect(teacherAcct.plans.at(-1)).toMatchObject({ title: "الاشتراك الكامل", price: 99, currency: "sar", billing: "one_time" });
    expect(teacherAcct.products.at(-1)!.title).toBe("أكاديمية التصميم — الاشتراك الكامل");
    expect(platform.state.products.some((p) => p.title.includes("الاشتراك"))).toBe(false);
    const ch = teacherAcct.checkouts.at(-1)!;
    expect(ch.metadata).toMatchObject({ kind: "offer", offer_id: offer.id, user_id: student.user.id });

    const payment = {
      id: "pay_1", status: "paid", currency: "sar", total: money("99.00"), amount_after_fees: money("91.67"),
      membership_id: "mem_s1", variant_id: teacherAcct.plans.at(-1)!.id, product_id: null, checkout_configuration_id: ch.id, metadata: null,
    };
    // The same event on Majlis's own webhook does nothing: offers only count on the teacher's webhook.
    await webhook("platform", "payment.succeeded", payment);
    expect((await api("GET", `/channels/${vipChannel}/messages`, student.token)).status).toBe(403);

    const ws = connectWs(student.token);
    await ws.ready;
    expect((await webhook(teacherHook(), "payment.succeeded", payment, { accountId: "biz_teacher" })).status).toBe(200);
    await sleep(100);
    expect(ws.events.some((e) => e.t === "ACCESS_UPDATE" && e.d.serverId === serverId)).toBe(true);
    ws.ws.close();
    expect((await api("GET", `/channels/${vipChannel}/messages`, student.token)).status).toBe(200);
    expect((await api<Offer[]>("GET", `/servers/${serverId}/offers`, student.token)).body[0]).toMatchObject({ owned: true, seatsTaken: 1 });

    const sales = await api<Sale[]>("GET", "/sales", teacher.token);
    expect(sales.body).toHaveLength(1);
    expect(sales.body[0]).toMatchObject({ offerName: "الاشتراك الكامل", totalMinor: 9900, refundedMinor: 0, currency: "sar", student: { id: student.user.id } });
    expect((await api<Sale[]>("GET", "/sales", student.token)).body).toHaveLength(0);
  });

  it("rejects webhooks signed for another connection or from another account", async () => {
    const hook = teacherHook();
    const r1 = await webhook(hook, "payment.succeeded", { id: "pay_x" }, { secret: "ws_biz_other_1_secret" });
    expect(r1.status).toBe(401);
    const r2 = await webhook(hook, "payment.succeeded", { id: "pay_x" }, { accountId: "biz_other" });
    expect(r2.status).toBe(400);
    expect((await webhook({ url: "https://x/webhooks/whop/nope", secret: "s" }, "payment.succeeded", {})).status).toBe(404);
  });

  it("a refund in the teacher's Whop removes access (no money moves through Majlis)", async () => {
    const rf = { id: "rf_1", status: "succeeded", payment_id: "pay_1", amount: money("99.00") };
    expect((await webhook(teacherHook(), "refund.created", rf)).status).toBe(200);
    expect((await webhook(teacherHook(), "refund.updated", rf)).status).toBe(200);
    expect((await api("GET", `/channels/${vipChannel}/messages`, student.token)).status).toBe(403);
    expect((await api<Sale[]>("GET", "/sales", teacher.token)).body[0]!.refundedMinor).toBe(9900);
  });

  it("chargebacks revoke access; manual grants restore it", async () => {
    await webhook(teacherHook(), "payment.succeeded", {
      id: "pay_2", status: "paid", currency: "sar", total: money("99.00"), amount_after_fees: money("91.67"),
      membership_id: "mem_s2", checkout_configuration_id: null, product_id: null,
      metadata: { kind: "offer", offer_id: offer.id, user_id: student.user.id },
    });
    expect((await api("GET", `/channels/${vipChannel}/messages`, student.token)).status).toBe(200);
    await webhook(teacherHook(), "dispute.created", { id: "dp_1", status: "needs_response", amount: 99, currency: "sar", payment: { id: "pay_2" } });
    expect((await api("GET", `/channels/${vipChannel}/messages`, student.token)).status).toBe(403);
    const g = await api("POST", `/servers/${serverId}/entitlements`, teacher.token, { userId: student.user.id, offerId: offer.id });
    expect(g.body).toMatchObject({ source: "manual", status: "active" });
    expect((await api("GET", `/channels/${vipChannel}/messages`, student.token)).status).toBe(200);
    expect((await api("DELETE", `/entitlements/${g.body.id}`, teacher.token)).status).toBe(204);
    expect((await api("GET", `/channels/${vipChannel}/messages`, student.token)).status).toBe(403);
  });

  it("subscription offers follow the membership; a price change makes a new plan", async () => {
    const monthly = await api<Offer>("POST", `/servers/${serverId}/offers`, teacher.token, {
      name: "شهري", priceMinor: 4900, billing: "monthly", trialDays: 7, grants: [{ targetType: "server", targetId: serverId }],
    });
    await api("POST", `/offers/${monthly.body.id}/checkout`, student.token);
    const plan = teacherAcct.plans.at(-1)!;
    expect(plan).toMatchObject({ billing: "monthly", trialDays: 7, price: 49 });
    const meta = { kind: "offer", offer_id: monthly.body.id, user_id: student.user.id };
    await webhook(teacherHook(), "membership.activated", { id: "mem_m", status: "trialing", variant_id: plan.id, metadata: meta, current_period_end: null, cancel_at_period_end: false });
    expect((await api("GET", `/channels/${vipChannel}/messages`, student.token)).status).toBe(200);
    await webhook(teacherHook(), "membership.deactivated", { id: "mem_m", status: "expired", variant_id: plan.id, metadata: {}, current_period_end: null, cancel_at_period_end: false });
    expect((await api("GET", `/channels/${vipChannel}/messages`, student.token)).status).toBe(403);

    await api("PATCH", `/offers/${monthly.body.id}`, teacher.token, { priceMinor: 5900 });
    expect(teacherAcct.archived).toContain(plan.id);
    await api("POST", `/offers/${monthly.body.id}/checkout`, student.token);
    expect(teacherAcct.plans.at(-1)).toMatchObject({ price: 59 });
  });

  it("a revoked key marks the connection broken and pauses selling; buyers keep access", async () => {
    await api("POST", `/servers/${serverId}/entitlements`, teacher.token, { userId: student.user.id, offerId: offer.id });
    const buyer = await register("مشتري جديد");
    const inv = await api<Invite>("POST", `/servers/${serverId}/invites`, teacher.token, {});
    await api("POST", `/invites/${inv.body.code}`, buyer.token);

    teacherAcct.missingWrite.push("checkout_configuration:create");
    const r = await api("POST", `/offers/${offer.id}/checkout`, buyer.token);
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("selling_paused");
    const info = await api<WhopConnectionInfo>("GET", "/whop/connection", teacher.token);
    expect(info.body.connection).toMatchObject({ status: "broken", missingPermissions: ["checkout_configuration:create"] });
    expect((await api("GET", `/channels/${vipChannel}/messages`, student.token)).status).toBe(200);

    // Fix the key in Whop, reconnect: selling resumes and the webhook is replaced.
    teacherAcct.missingWrite.length = 0;
    const oldHook = teacherHook();
    expect((await api("PUT", "/whop/connection", teacher.token, { apiKey: TEACHER_KEY })).body.connection.status).toBe("active");
    expect(teacherAcct.webhooks.size).toBe(1);
    expect(teacherHook().secret).not.toBe(oldHook.secret);
    expect((await api("POST", `/offers/${offer.id}/checkout`, buyer.token)).status).toBe(200);
  });

  it("disconnecting deletes the webhook, wipes the key and pauses selling", async () => {
    expect((await api("DELETE", "/whop/connection", teacher.token)).status).toBe(204);
    expect(teacherAcct.webhooks.size).toBe(0);
    const [row] = await sql`SELECT * FROM whop_connections WHERE teacher_user_id = ${teacher.user.id}`;
    expect(row).toMatchObject({ status: "disconnected", apiKeyEnc: null, webhookSecretEnc: null });
    expect((await api<WhopConnectionInfo>("GET", "/whop/connection", teacher.token)).body.connection).toBeNull();
    const buyer = await register("زائر");
    const inv = await api<Invite>("POST", `/servers/${serverId}/invites`, teacher.token, {});
    await api("POST", `/invites/${inv.body.code}`, buyer.token);
    expect((await api("POST", `/offers/${offer.id}/checkout`, buyer.token)).body.error).toBe("selling_paused");
    expect((await api("GET", `/channels/${vipChannel}/messages`, student.token)).status).toBe(200); // existing buyer keeps access
  });
});
