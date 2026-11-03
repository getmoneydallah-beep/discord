import { HttpError } from "./errors";

/**
 * In-memory sliding-window limiter. Per instance — good enough to stop floods;
 * swap for a Redis-backed limiter when running many instances.
 */
export function createLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  const sweep = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [k, v] of hits) if ((v[v.length - 1] ?? 0) < cutoff) hits.delete(k);
  }, windowMs * 2);
  sweep.unref();

  return function check(key: string) {
    const now = Date.now();
    const arr = (hits.get(key) ?? []).filter((t) => t > now - windowMs);
    if (arr.length >= limit) throw new HttpError(429, "rate_limited");
    arr.push(now);
    hits.set(key, arr);
  };
}
