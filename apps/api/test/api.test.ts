import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { AuthResponse, Invite, Message, ServerDetail, ServerEvent } from "@majlis/shared";
import { buildApp } from "../src/app";
import { createBus } from "../src/bus";
import { createDb } from "../src/db";
import { migrate } from "../src/migrate";

const DB_URL = process.env.TEST_DATABASE_URL ?? "postgres://majlis:majlis@localhost:5432/majlis_test";

const sql = createDb(DB_URL);
let app: Awaited<ReturnType<typeof buildApp>>;
let base = "";

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
  return { status: res.status, body: (text ? JSON.parse(text) : undefined) as T };
}

const uniq = () => Math.random().toString(36).slice(2, 8);
async function register(displayName: string) {
  const u = uniq();
  const { status, body } = await api<AuthResponse>("POST", "/auth/register", undefined, {
    email: `${u}@example.com`,
    username: `user_${u}`,
    displayName,
    password: "password123",
  });
  expect(status).toBe(201);
  return body;
}

/** Opens a gateway socket and collects events. */
async function connect(token: string) {
  const events: ServerEvent[] = [];
  const ws = new WebSocket(`${base.replace("http", "ws")}/gateway?token=${token}`);
  ws.on("message", (raw) => events.push(JSON.parse(raw.toString())));
  await new Promise<void>((resolve, reject) => {
    ws.once("error", reject);
    const check = setInterval(() => {
      if (events.some((e) => e.t === "READY")) {
        clearInterval(check);
        resolve();
      }
    }, 10);
  });
  const waitFor = async <T extends ServerEvent["t"]>(t: T, pred: (e: Extract<ServerEvent, { t: T }>) => boolean = () => true) => {
    for (let i = 0; i < 200; i++) {
      const found = events.find((e) => e.t === t && pred(e as Extract<ServerEvent, { t: T }>));
      if (found) return found as Extract<ServerEvent, { t: T }>;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`timed out waiting for ${t}`);
  };
  return { ws, events, waitFor };
}

beforeAll(async () => {
  await sql`DROP SCHEMA public CASCADE`;
  await sql`CREATE SCHEMA public`;
  await migrate(sql, () => {});
  app = await buildApp({ sql, bus: createBus(process.env.TEST_REDIS_URL ?? null), logger: false });
  await app.listen({ port: 0, host: "127.0.0.1" });
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await app.close();
  await sql.end();
});

describe("auth", () => {
  it("registers, logs in, rejects bad credentials", async () => {
    const reg = await register("سارة");
    expect(reg.user.displayName).toBe("سارة");
    expect(reg.user.locale).toBe("ar");

    const ok = await api("POST", "/auth/login", undefined, { email: reg.user.email, password: "password123" });
    expect(ok.status).toBe(200);
    const bad = await api("POST", "/auth/login", undefined, { email: reg.user.email, password: "nope-nope" });
    expect(bad.status).toBe(401);
    expect(bad.body.error).toBe("invalid_credentials");

    const dup = await api("POST", "/auth/register", undefined, {
      email: reg.user.email,
      username: "another_name",
      displayName: "x",
      password: "password123",
    });
    expect(dup.body.error).toBe("email_taken");

    expect((await api("GET", "/me")).status).toBe(401);
    expect((await api("GET", "/me", reg.token)).body.id).toBe(reg.user.id);
  });

  it("validates usernames", async () => {
    const res = await api("POST", "/auth/register", undefined, {
      email: `${uniq()}@example.com`,
      username: "سارة",
      displayName: "x",
      password: "password123",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_username");
  });
});

describe("servers, invites, realtime chat", () => {
  it("runs the full flow", async () => {
    const owner = await register("عبدالله");
    const guest = await register("نورة");

    const created = await api<ServerDetail>("POST", "/servers", owner.token, { name: "مجلس الأصدقاء" });
    expect(created.status).toBe(201);
    const serverId = created.body.server.id;
    const general = created.body.channels[0]!;
    expect(general.name).toBe("عام");
    expect(created.body.myRole).toBe("owner");

    // Non-members can't see the server.
    expect((await api("GET", `/servers/${serverId}`, guest.token)).status).toBe(404);

    const ownerWs = await connect(owner.token);
    const guestWs = await connect(guest.token);

    const invite = await api<Invite & { url: string }>("POST", `/servers/${serverId}/invites`, owner.token, {});
    expect(invite.body.url).toContain(`/invite/${invite.body.code}`);
    expect((await api<Invite>("GET", `/invites/${invite.body.code}`, guest.token)).body.serverName).toBe("مجلس الأصدقاء");

    const joined = await api<ServerDetail>("POST", `/invites/${invite.body.code}`, guest.token);
    expect(joined.status).toBe(200);
    expect(joined.body.members).toHaveLength(2);
    await ownerWs.waitFor("MEMBER_ADD", (e) => e.d.user.id === guest.user.id);
    // Guest socket was subscribed to the server on join, so it gets presence + messages.
    await guestWs.waitFor("MEMBER_ADD");
    // Both sides learn each other's presence even though guest connected before joining.
    await ownerWs.waitFor("PRESENCE_UPDATE", (e) => e.d.userId === guest.user.id && e.d.status === "online");
    await guestWs.waitFor("PRESENCE_UPDATE", (e) => e.d.userId === owner.user.id && e.d.status === "online");

    // Typing
    guestWs.ws.send(JSON.stringify({ t: "TYPING", d: { channelId: general.id } }));
    const typing = await ownerWs.waitFor("TYPING_START");
    expect(typing.d.userId).toBe(guest.user.id);

    // Send an Arabic message and receive it in real time.
    const sent = await api<Message>("POST", `/channels/${general.id}/messages`, guest.token, {
      content: "السَّلامُ عليكم يا أصدقاء",
      nonce: "n1",
    });
    expect(sent.status).toBe(201);
    const pushed = await ownerWs.waitFor("MESSAGE_CREATE");
    expect(pushed.d.content).toBe("السَّلامُ عليكم يا أصدقاء");
    expect(pushed.d.author.displayName).toBe("نورة");
    expect(pushed.d.nonce).toBe("n1");

    // Reply + reactions
    const reply = await api<Message>("POST", `/channels/${general.id}/messages`, owner.token, {
      content: "وعليكم السلام 👋",
      replyToId: sent.body.id,
    });
    expect(reply.body.replyToId).toBe(sent.body.id);
    expect((await api("PUT", `/messages/${sent.body.id}/reactions/${encodeURIComponent("❤️")}`, owner.token)).status).toBe(204);
    await guestWs.waitFor("REACTION_ADD", (e) => e.d.emoji === "❤️");

    const history = await api<Message[]>("GET", `/channels/${general.id}/messages`, guest.token);
    expect(history.body.map((m) => m.id)).toEqual([sent.body.id, reply.body.id]);
    expect(history.body[0]!.reactions).toEqual([{ emoji: "❤️", count: 1, me: false }]);

    // Pagination
    const older = await api<Message[]>("GET", `/channels/${general.id}/messages?before=${reply.body.id}`, guest.token);
    expect(older.body.map((m) => m.id)).toEqual([sent.body.id]);

    // Arabic-normalised search: no diacritics, different alef / taa marbuta.
    const search = await api<Message[]>("GET", `/servers/${serverId}/search?q=${encodeURIComponent("السلام")}`, guest.token);
    expect(search.body.map((m) => m.id).sort()).toEqual([sent.body.id, reply.body.id].sort());
    const search2 = await api<Message[]>("GET", `/servers/${serverId}/search?q=${encodeURIComponent("اصدقاء")}`, guest.token);
    expect(search2.body.map((m) => m.id)).toEqual([sent.body.id]);

    // Edit: only the author.
    expect((await api("PATCH", `/messages/${sent.body.id}`, owner.token, { content: "hack" })).status).toBe(403);
    const edited = await api<Message>("PATCH", `/messages/${sent.body.id}`, guest.token, { content: "مرحباً" });
    expect(edited.body.editedAt).toBeTruthy();
    await ownerWs.waitFor("MESSAGE_UPDATE", (e) => e.d.content === "مرحباً");

    // Members can't create channels; owners can (Arabic names keep their script).
    expect((await api("POST", `/servers/${serverId}/channels`, guest.token, { name: "x" })).status).toBe(403);
    const ch = await api("POST", `/servers/${serverId}/channels`, owner.token, { name: "أخبار  الرياضة" });
    expect(ch.body.name).toBe("أخبار-الرياضة");
    await guestWs.waitFor("CHANNEL_CREATE");

    // Report
    expect((await api("POST", `/messages/${reply.body.id}/report`, guest.token, { reason: "spam" })).status).toBe(204);

    // Owner can delete others' messages.
    expect((await api("DELETE", `/messages/${sent.body.id}`, owner.token)).status).toBe(204);
    await guestWs.waitFor("MESSAGE_DELETE", (e) => e.d.id === sent.body.id);

    // Ban: guest is removed and can't rejoin.
    expect((await api("PUT", `/servers/${serverId}/bans/${guest.user.id}`, owner.token)).status).toBe(204);
    await guestWs.waitFor("MEMBER_REMOVE", (e) => e.d.userId === guest.user.id);
    const rejoin = await api("POST", `/invites/${invite.body.code}`, guest.token);
    expect(rejoin.status).toBe(403);
    expect(rejoin.body.error).toBe("banned");

    // After removal, guest no longer receives this server's messages.
    const before = guestWs.events.length;
    await api("POST", `/channels/${general.id}/messages`, owner.token, { content: "خاص" });
    await ownerWs.waitFor("MESSAGE_CREATE", (e) => e.d.content === "خاص");
    await new Promise((r) => setTimeout(r, 50));
    expect(guestWs.events.slice(before).some((e) => e.t === "MESSAGE_CREATE")).toBe(false);

    ownerWs.ws.close();
    guestWs.ws.close();
  });

  it("rate-limits message floods", async () => {
    const u = await register("سريع");
    const s = await api<ServerDetail>("POST", "/servers", u.token, { name: "test" });
    const ch = s.body.channels[0]!.id;
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await api("POST", `/channels/${ch}/messages`, u.token, { content: `m${i}` })).status);
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
  });

  it("deletes an account and its owned servers", async () => {
    const u = await register("مؤقت");
    const s = await api<ServerDetail>("POST", "/servers", u.token, { name: "temp" });
    expect((await api("DELETE", "/me", u.token)).status).toBe(204);
    const [row] = await sql`SELECT count(*)::int AS n FROM servers WHERE id = ${s.body.server.id}`;
    expect(row!.n).toBe(0);
  });
});
