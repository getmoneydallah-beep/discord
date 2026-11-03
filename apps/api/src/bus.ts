import { EventEmitter } from "node:events";
import { Redis } from "ioredis";
import type { ServerEvent } from "@majlis/shared";

/** Who should receive an event. */
export type Scope = { serverIds: string[] } | { userIds: string[] };
export interface Envelope {
  scope: Scope;
  event: ServerEvent;
}

/**
 * Fan-out bus between API instances, plus a presence counter.
 *
 * With REDIS_URL set, events go through Redis pub/sub so every instance (and
 * therefore every connected socket) sees them. Without it, an in-process
 * emitter is used: fine for local dev and a single Fly machine.
 */
export interface Bus {
  publish(env: Envelope): Promise<void>;
  subscribe(handler: (env: Envelope) => void): void;
  /** Returns the number of open connections for the user after the change. */
  presenceIncr(userId: string): Promise<number>;
  presenceDecr(userId: string): Promise<number>;
  online(userIds: string[]): Promise<string[]>;
  close(): Promise<void>;
}

const CHANNEL = "majlis:events";
const PRESENCE_KEY = "majlis:presence";

export function createBus(redisUrl: string | null): Bus {
  return redisUrl ? redisBus(redisUrl) : localBus();
}

function localBus(): Bus {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0);
  const counts = new Map<string, number>();
  return {
    async publish(env) {
      emitter.emit("event", env);
    },
    subscribe(handler) {
      emitter.on("event", handler);
    },
    async presenceIncr(userId) {
      const n = (counts.get(userId) ?? 0) + 1;
      counts.set(userId, n);
      return n;
    },
    async presenceDecr(userId) {
      const n = Math.max(0, (counts.get(userId) ?? 0) - 1);
      if (n === 0) counts.delete(userId);
      else counts.set(userId, n);
      return n;
    },
    async online(userIds) {
      return userIds.filter((id) => counts.has(id));
    },
    async close() {
      emitter.removeAllListeners();
    },
  };
}

function redisBus(url: string): Bus {
  // Upstash and Fly Redis both work; family 6 lets ioredis resolve Fly's IPv6 private network.
  const pub = new Redis(url, { family: 6, maxRetriesPerRequest: 3 });
  const sub = new Redis(url, { family: 6, maxRetriesPerRequest: 3 });
  const handlers: ((env: Envelope) => void)[] = [];
  void sub.subscribe(CHANNEL);
  sub.on("message", (_ch: string, raw: string) => {
    try {
      const env = JSON.parse(raw) as Envelope;
      for (const h of handlers) h(env);
    } catch {
      /* ignore */
    }
  });
  return {
    async publish(env) {
      await pub.publish(CHANNEL, JSON.stringify(env));
    },
    subscribe(handler) {
      handlers.push(handler);
    },
    // NOTE: counts can drift if an instance crashes without closing sockets.
    // A per-instance heartbeat key with TTL would fix this; fine for the MVP.
    async presenceIncr(userId) {
      return pub.hincrby(PRESENCE_KEY, userId, 1);
    },
    async presenceDecr(userId) {
      const n = await pub.hincrby(PRESENCE_KEY, userId, -1);
      if (n <= 0) await pub.hdel(PRESENCE_KEY, userId);
      return Math.max(0, n);
    },
    async online(userIds) {
      if (userIds.length === 0) return [];
      const vals = await pub.hmget(PRESENCE_KEY, ...userIds);
      return userIds.filter((_, i) => Number(vals[i] ?? 0) > 0);
    },
    async close() {
      sub.disconnect();
      pub.disconnect();
    },
  };
}
