/**
 * Security regression tests (see SECURITY_AUDIT.md). Each test reproduces a
 * finding from the audit and asserts the secure behaviour.
 */
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { AuthResponse, Channel, Invite, ServerDetail, ServerEvent, UploadTicket } from "@majlis/shared";
import { buildApp, redactUrl } from "../src/app";
import { config } from "../src/config";
import { createBus } from "../src/bus";
import { createDb } from "../src/db";
import { migrate } from "../src/migrate";
import { localStorage } from "../src/storage";

const DB_URL = process.env.TEST_DATABASE_URL ?? "postgres://majlis:majlis@localhost:5432/majlis_test";
const sql = createDb(DB_URL);
let app: Awaited<ReturnType<typeof buildApp>>;
let base = "";
let dir = "";

async function api<T = any>(method: string, path: string, token?: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...headers,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed as T, headers: res.headers };
}

const uniq = () => Math.random().toString(36).slice(2, 8);
async function register(name: string) {
  const u = uniq();
  const r = await api<AuthResponse>("POST", "/auth/register", undefined, {
    email: `${u}@sec.test`,
    username: `s_${u}`,
    displayName: name,
    password: "password123",
  }, { "x-forwarded-for": `1.1.1.1, 10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
  expect(r.status).toBe(201);
  return r.body;
}

beforeAll(async () => {
  await sql`DROP SCHEMA public CASCADE`;
  await sql`CREATE SCHEMA public`;
  await migrate(sql, () => {});
  dir = await mkdtemp(join(tmpdir(), "majlis-sec-"));
  const storage = localStorage({ dir, secret: "test-secret", baseUrl: "http://placeholder" });
  // Like production on Fly: one trusted proxy that appends the real client IP to X-Forwarded-For.
  config.trustProxyHops = 1;
  app = await buildApp({ sql, bus: createBus(null), storage, logger: false, whop: null, connector: null });
  await app.listen({ port: 0, host: "127.0.0.1" });
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  storage.setBaseUrl(base);
});

afterAll(async () => {
  await app.close();
  await sql.end();
  await rm(dir, { recursive: true, force: true });
});

describe("authentication", () => {
  it("SEC-01: login rate limits can't be bypassed by spoofing X-Forwarded-For or rotating IPs", async () => {
    // Spoofed left-most entries change every request; the proxy-appended real IP stays the same.
    const perIp: number[] = [];
    for (let i = 0; i < 12; i++) {
      const r = await api("POST", "/auth/login", undefined, { email: `nobody${i}@sec.test`, password: "wrong-password" }, {
        "x-forwarded-for": `203.0.113.${i}, 198.51.100.7`,
      });
      perIp.push(r.status);
    }
    expect(perIp).toContain(429);

    // Many real IPs guessing one account's password.
    const victim = await register("ضحية");
    const perAccount: number[] = [];
    for (let i = 0; i < 12; i++) {
      const r = await api("POST", "/auth/login", undefined, { email: victim.user.email, password: `wrong-${i}` }, {
        "x-forwarded-for": `192.0.2.${i}`,
      });
      perAccount.push(r.status);
    }
    expect(perAccount).toContain(429);
  });

  it("SEC-02: a deleted account's token stops working", async () => {
    const u = await register("مؤقت");
    expect((await api("GET", "/servers", u.token)).status).toBe(200);
    expect((await api("DELETE", "/me", u.token)).status).toBe(204);
    expect((await api("GET", "/servers", u.token)).status).toBe(401);
  });

  it("SEC-03: gateway tokens are redacted from request logs", () => {
    expect(redactUrl("/gateway?token=eyJhbGciOi.secret.sig")).toBe("/gateway?token=[redacted]");
    expect(redactUrl("/servers/1?q=x&token=abc&b=2")).toBe("/servers/1?q=x&token=[redacted]&b=2");
    expect(redactUrl("/health")).toBe("/health");
  });
});

describe("headers", () => {
  it("SEC-04: API responses send nosniff and deny framing", async () => {
    const r = await api("GET", "/health");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("x-frame-options")).toBe("DENY");
  });
});

describe("storage", () => {
  let owner: AuthResponse;
  let serverId: string;

  beforeAll(async () => {
    owner = await register("مالك");
    serverId = (await api<ServerDetail>("POST", "/servers", owner.token, { name: "تخزين" })).body.server.id;
  });

  it("SEC-05: an upload can't be stored as a different content type than it was declared (stored XSS)", async () => {
    const t = await api<UploadTicket>("POST", `/servers/${serverId}/uploads`, owner.token, {
      filename: "cat.png",
      contentType: "image/png",
      size: 40,
      purpose: "attachment",
    });
    expect(t.status).toBe(201);
    // The attacker PUTs HTML with a text/html content type instead of the declared PNG.
    const put = await fetch(t.body.put.url, {
      method: "PUT",
      headers: { "content-type": "text/html" },
      body: "<script>alert(document.domain)</script>",
    });
    if (put.status === 200) {
      const done = await api<{ url: string }>("POST", `/uploads/${t.body.upload.id}/complete`, owner.token);
      const get = await fetch(done.body.url);
      expect(get.headers.get("content-type")).toBe("image/png");
      expect(get.headers.get("x-content-type-options")).toBe("nosniff");
    } else {
      expect(put.status).toBe(403);
    }
  });

  it("SEC-06: total storage per majlis is capped by the owner's plan", async () => {
    const gb = 1024 ** 3;
    const first = await api("POST", `/servers/${serverId}/uploads`, owner.token, {
      filename: "a.mp4", contentType: "video/mp4", size: Math.floor(1.5 * gb), purpose: "lesson_video",
    });
    expect(first.status).toBe(201);
    const second = await api("POST", `/servers/${serverId}/uploads`, owner.token, {
      filename: "b.mp4", contentType: "video/mp4", size: Math.floor(1.5 * gb), purpose: "lesson_video",
    });
    expect(second.status).toBe(413);
    expect((second.body as { error: string }).error).toBe("storage_quota_exceeded");
  });
});

describe("abuse limits", () => {
  it("SEC-07: checkout endpoints are rate-limited", async () => {
    const u = await register("مستعجل");
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await api("POST", "/billing/checkout", u.token, { tier: "pro", interval: "monthly" })).status);
    expect(statuses).toContain(429);
  });
});

describe("real-time", () => {
  it("SEC-08: members can't broadcast typing in channels they can't post in", async () => {
    const owner = await register("معلم");
    const member = await register("طالب");
    const d = await api<ServerDetail>("POST", "/servers", owner.token, { name: "إعلانات" });
    const sid = d.body.server.id;
    const ann = await api<Channel>("POST", `/servers/${sid}/channels`, owner.token, { name: "news", postPolicy: "staff" });
    const inv = await api<Invite>("POST", `/servers/${sid}/invites`, owner.token, {});
    await api("POST", `/invites/${inv.body.code}`, member.token);

    const events: ServerEvent[] = [];
    const ownerWs = new WebSocket(`${base.replace("http", "ws")}/gateway?token=${owner.token}`);
    ownerWs.on("message", (raw) => events.push(JSON.parse(raw.toString())));
    const memberWs = new WebSocket(`${base.replace("http", "ws")}/gateway?token=${member.token}`);
    await Promise.all([ownerWs, memberWs].map((w) => new Promise((r) => w.on("open", r))));
    await new Promise((r) => setTimeout(r, 200));
    memberWs.send(JSON.stringify({ t: "TYPING", d: { channelId: ann.body.id } }));
    await new Promise((r) => setTimeout(r, 300));
    expect(events.some((e) => e.t === "TYPING_START")).toBe(false);
    ownerWs.close();
    memberWs.close();
  });
});

describe("tenant isolation and privilege matrix", () => {
  it("SEC-09: outsiders get 401/403/404 on every server-scoped resource; members can't do admin work", async () => {
    const owner = await register("المالك");
    const member = await register("العضو");
    const outsider = await register("الغريب");
    const d = await api<ServerDetail>("POST", "/servers", owner.token, { name: "معزول" });
    const sid = d.body.server.id;
    const chat = d.body.channels[0]!.id;
    const course = await api<Channel>("POST", `/servers/${sid}/channels`, owner.token, { name: "دورة", type: "course" });
    const sec = await api<{ id: string }>("POST", `/courses/${course.body.id}/sections`, owner.token, { title: "s" });
    const lesson = await api<{ id: string }>("POST", `/courses/${course.body.id}/lessons`, owner.token, { sectionId: sec.body.id, title: "l" });
    const msg = await api<{ id: string }>("POST", `/channels/${chat}/messages`, owner.token, { content: "سري" });
    const inv = await api<Invite>("POST", `/servers/${sid}/invites`, owner.token, {});
    await api("POST", `/invites/${inv.body.code}`, member.token);
    const up = await api<UploadTicket>("POST", `/servers/${sid}/uploads`, owner.token, { filename: "a.txt", contentType: "text/plain", size: 3, purpose: "attachment" });

    const denied = (s: number) => [401, 403, 404].includes(s);
    const outsiderCalls: [string, string, unknown?][] = [
      ["GET", `/servers/${sid}`],
      ["PATCH", `/servers/${sid}`, { name: "x" }],
      ["DELETE", `/servers/${sid}`],
      ["GET", `/servers/${sid}/summary`],
      ["GET", `/servers/${sid}/offers`],
      ["GET", `/servers/${sid}/entitlements`],
      ["GET", `/servers/${sid}/search?q=سري`],
      ["POST", `/servers/${sid}/invites`, {}],
      ["POST", `/servers/${sid}/channels`, { name: "x" }],
      ["POST", `/servers/${sid}/uploads`, { filename: "a.txt", contentType: "text/plain", size: 3, purpose: "attachment" }],
      ["GET", `/channels/${chat}/messages`],
      ["POST", `/channels/${chat}/messages`, { content: "x" }],
      ["PATCH", `/channels/${chat}`, { name: "x" }],
      ["PUT", `/channels/${chat}/access`, { access: "paid" }],
      ["DELETE", `/channels/${chat}`],
      ["PATCH", `/messages/${msg.body.id}`, { content: "x" }],
      ["DELETE", `/messages/${msg.body.id}`],
      ["PUT", `/messages/${msg.body.id}/reactions/${encodeURIComponent("👍")}`],
      ["POST", `/messages/${msg.body.id}/report`, { reason: "x" }],
      ["GET", `/courses/${course.body.id}`],
      ["PATCH", `/courses/${course.body.id}`, { name: "x" }],
      ["POST", `/courses/${course.body.id}/sections`, { title: "x" }],
      ["PATCH", `/sections/${sec.body.id}`, { title: "x" }],
      ["DELETE", `/sections/${sec.body.id}`],
      ["GET", `/lessons/${lesson.body.id}`],
      ["PATCH", `/lessons/${lesson.body.id}`, { title: "x" }],
      ["DELETE", `/lessons/${lesson.body.id}`],
      ["PUT", `/lessons/${lesson.body.id}/progress`, { completed: true }],
      ["PUT", `/lessons/${lesson.body.id}/preview`, { freePreview: true }],
      ["POST", `/uploads/${up.body.upload.id}/complete`],
      ["DELETE", `/uploads/${up.body.upload.id}`],
    ];
    for (const [m, path, body] of outsiderCalls) {
      const r = await api(m, path, outsider.token, body);
      expect.soft(denied(r.status), `outsider ${m} ${path} → ${r.status}`).toBe(true);
    }
    // No token at all
    for (const [m, path, body] of outsiderCalls.slice(0, 12)) {
      expect.soft((await api(m, path, undefined, body)).status, `anon ${m} ${path}`).toBe(401);
    }
    // Plain members: no admin operations
    const memberCalls: [string, string, unknown?][] = [
      ["PATCH", `/servers/${sid}`, { name: "x" }],
      ["DELETE", `/servers/${sid}`],
      ["GET", `/servers/${sid}/summary`],
      ["POST", `/servers/${sid}/channels`, { name: "x" }],
      ["PATCH", `/channels/${chat}`, { postPolicy: "staff" }],
      ["PUT", `/channels/${chat}/access`, { access: "paid" }],
      ["DELETE", `/channels/${chat}`],
      ["DELETE", `/messages/${msg.body.id}`],
      ["PATCH", `/messages/${msg.body.id}`, { content: "x" }],
      ["PATCH", `/courses/${course.body.id}`, { name: "x" }],
      ["POST", `/courses/${course.body.id}/lessons`, { sectionId: sec.body.id, title: "x" }],
      ["PATCH", `/lessons/${lesson.body.id}`, { title: "x" }],
      ["PUT", `/lessons/${lesson.body.id}/preview`, { freePreview: true }],
      ["POST", `/servers/${sid}/uploads`, { filename: "v.mp4", contentType: "video/mp4", size: 10, purpose: "lesson_video" }],
      ["PATCH", `/servers/${sid}/members/${owner.user.id}`, { role: "admin" }],
      ["PATCH", `/servers/${sid}/members/${member.user.id}`, { role: "admin" }],
      ["DELETE", `/servers/${sid}/members/${owner.user.id}`],
      ["PUT", `/servers/${sid}/bans/${owner.user.id}`],
      ["POST", `/servers/${sid}/entitlements`, { userId: member.user.id, offerId: "x" }],
      ["POST", `/servers/${sid}/offers`, { name: "x", priceMinor: 100, billing: "monthly", grants: [{ targetType: "server", targetId: sid }] }],
      ["POST", `/uploads/${up.body.upload.id}/complete`],
    ];
    for (const [m, path, body] of memberCalls) {
      const r = await api(m, path, member.token, body);
      expect.soft(denied(r.status), `member ${m} ${path} → ${r.status}`).toBe(true);
    }
    // And the owner's data is intact.
    expect((await api<ServerDetail>("GET", `/servers/${sid}`, owner.token)).body.server.name).toBe("معزول");
  });
});
