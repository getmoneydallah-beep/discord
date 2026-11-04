import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import type { ClientEvent, ServerEvent } from "@majlis/shared";
import { verifyToken } from "./auth";
import type { Bus, Envelope } from "./bus";
import type { Repo } from "./repo";

interface Conn {
  ws: WebSocket;
  userId: string;
  displayName: string;
  servers: Set<string>;
  lastTyping: Map<string, number>;
  /** Deliveries are chained so access checks never reorder events on one socket. */
  chain: Promise<unknown>;
}

/**
 * WebSocket gateway. Each instance tracks its own sockets and indexes them by
 * user and server; the bus delivers every event to every instance and each
 * instance forwards it to the matching local sockets.
 */
export function registerGateway(app: FastifyInstance, deps: { bus: Bus; repo: Repo }) {
  const { bus, repo } = deps;
  const byUser = new Map<string, Set<Conn>>();
  const byServer = new Map<string, Set<Conn>>();
  const channelServer = new Map<string, string>(); // small cache for typing checks

  // Paid channels: only members who can open the channel get its real-time
  // events. Results are cached briefly per user+channel and dropped on
  // ACCESS_UPDATE / CHANNEL_UPDATE.
  const ACCESS_TTL = 60_000;
  const accessCache = new Map<string, { ok: boolean; at: number }>();
  async function allowed(userId: string, channelId: string): Promise<boolean> {
    const key = `${userId}:${channelId}`;
    const hit = accessCache.get(key);
    if (hit && Date.now() - hit.at < ACCESS_TTL) return hit.ok;
    let ok = false;
    try {
      const channel = await repo.getChannel(channelId);
      ok = await repo.canAccessChannel(channel, userId, await repo.membership(channel.serverId, userId));
    } catch {
      ok = false;
    }
    if (accessCache.size > 50_000) accessCache.clear();
    accessCache.set(key, { ok, at: Date.now() });
    return ok;
  }
  const channelOf = (e: ServerEvent): string | null => {
    switch (e.t) {
      case "MESSAGE_CREATE":
      case "MESSAGE_UPDATE":
      case "MESSAGE_DELETE":
      case "REACTION_ADD":
      case "REACTION_REMOVE":
      case "TYPING_START":
        return e.d.channelId;
      default:
        return null;
    }
  };

  const add = <K>(map: Map<K, Set<Conn>>, key: K, c: Conn) => {
    let set = map.get(key);
    if (!set) map.set(key, (set = new Set()));
    set.add(c);
  };
  const remove = <K>(map: Map<K, Set<Conn>>, key: K, c: Conn) => {
    const set = map.get(key);
    if (!set) return;
    set.delete(c);
    if (set.size === 0) map.delete(key);
  };
  const subscribe = (c: Conn, serverId: string) => {
    c.servers.add(serverId);
    add(byServer, serverId, c);
  };
  const unsubscribe = (c: Conn, serverId: string) => {
    c.servers.delete(serverId);
    remove(byServer, serverId, c);
  };
  const send = (c: Conn, e: ServerEvent) => {
    if (c.ws.readyState === c.ws.OPEN) c.ws.send(JSON.stringify(e));
  };

  bus.subscribe((env: Envelope) => {
    const { scope, event } = env;

    // Membership changes must update the index before delivery so the newly
    // added user receives the event (and subsequent events) for that server.
    if (event.t === "MEMBER_ADD") {
      for (const c of byUser.get(event.d.user.id) ?? []) subscribe(c, event.d.serverId);
    } else if (event.t === "SERVER_CREATE") {
      for (const c of byUser.get(event.d.ownerId) ?? []) subscribe(c, event.d.id);
    }

    const targets = new Set<Conn>();
    if ("serverIds" in scope) {
      for (const s of scope.serverIds) for (const c of byServer.get(s) ?? []) targets.add(c);
    } else {
      for (const u of scope.userIds) for (const c of byUser.get(u) ?? []) targets.add(c);
    }
    const channelId = channelOf(event);
    for (const c of targets) {
      c.chain = c.chain
        .then(async () => {
          if (!channelId || (await allowed(c.userId, channelId))) send(c, event);
        })
        .catch(() => {});
    }

    if (event.t === "ACCESS_UPDATE" || event.t === "CHANNEL_UPDATE") accessCache.clear();

    if (event.t === "MEMBER_REMOVE") {
      for (const c of byUser.get(event.d.userId) ?? []) unsubscribe(c, event.d.serverId);
    } else if (event.t === "SERVER_DELETE") {
      for (const c of [...(byServer.get(event.d.id) ?? [])]) unsubscribe(c, event.d.id);
    } else if (event.t === "CHANNEL_DELETE") {
      channelServer.delete(event.d.id);
    }
  });

  async function handleClientEvent(c: Conn, e: ClientEvent) {
    if (e.t === "PING") return send(c, { t: "PONG" });
    if (e.t === "TYPING") {
      const { channelId } = e.d;
      const now = Date.now();
      if (now - (c.lastTyping.get(channelId) ?? 0) < 3000) return;
      c.lastTyping.set(channelId, now);
      let serverId = channelServer.get(channelId);
      if (!serverId) {
        const ch = await repo.getChannel(channelId).catch(() => null);
        if (!ch) return;
        serverId = ch.serverId;
        if (channelServer.size > 10_000) channelServer.clear();
        channelServer.set(channelId, serverId);
      }
      if (!c.servers.has(serverId)) return;
      await bus.publish({
        scope: { serverIds: [serverId] },
        event: { t: "TYPING_START", d: { channelId, serverId, userId: c.userId, displayName: c.displayName } },
      });
    }
  }

  app.get("/gateway", { websocket: true }, async (ws, req) => {
    const token = (req.query as { token?: string }).token;
    const userId = token ? await verifyToken(token) : null;
    if (!userId) return ws.close(4001, "unauthorized");

    const me = await repo.getUser(userId);
    if (!me) return ws.close(4001, "unauthorized");

    const conn: Conn = { ws, userId, displayName: me.displayName, servers: new Set(), lastTyping: new Map(), chain: Promise.resolve() };
    const serverIds = await repo.userServerIds(userId);
    add(byUser, userId, conn);
    for (const s of serverIds) subscribe(conn, s);

    let alive = true;
    ws.on("pong", () => (alive = true));
    const ping = setInterval(() => {
      if (!alive) return ws.terminate();
      alive = false;
      ws.ping();
    }, 30_000);

    ws.on("message", (raw: Buffer) => {
      let e: ClientEvent;
      try {
        e = JSON.parse(raw.toString()) as ClientEvent;
      } catch {
        return;
      }
      handleClientEvent(conn, e).catch((err: unknown) => req.log.warn({ err }, "gateway event failed"));
    });

    ws.on("close", () => {
      clearInterval(ping);
      remove(byUser, userId, conn);
      for (const s of conn.servers) remove(byServer, s, conn);
      void (async () => {
        if ((await bus.presenceDecr(userId)) === 0) {
          const servers = await repo.userServerIds(userId);
          if (servers.length)
            await bus.publish({ scope: { serverIds: servers }, event: { t: "PRESENCE_UPDATE", d: { userId, status: "offline" } } });
        }
      })().catch((err: unknown) => req.log.warn({ err }, "presence update failed"));
    });

    const count = await bus.presenceIncr(userId);
    const online = await bus.online(await repo.peers(userId));
    send(conn, { t: "READY", d: { userId, online: online.includes(userId) ? online : [...online, userId] } });
    if (count === 1 && serverIds.length) {
      await bus.publish({
        scope: { serverIds },
        event: { t: "PRESENCE_UPDATE", d: { userId, status: "online" } },
      });
    }
  });

  /** Called when a user's display name changes so typing events stay accurate. */
  return {
    renameUser(userId: string, displayName: string) {
      for (const c of byUser.get(userId) ?? []) c.displayName = displayName;
    },
    closeUser(userId: string) {
      for (const c of byUser.get(userId) ?? []) c.ws.close(4002, "account_deleted");
    },
  };
}

export type GatewayHandle = ReturnType<typeof registerGateway>;
