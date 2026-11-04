/**
 * ULID-style IDs: 48-bit millisecond timestamp + 80 bits of randomness,
 * Crockford base32, 26 chars. Lexicographic order == creation order, which
 * lets us paginate messages by ID.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function newId(now: number = Date.now()): string {
  let time = "";
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = ALPHABET[t % 32]! + time;
    t = Math.floor(t / 32);
  }
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let rand = "";
  for (let i = 0; i < 16; i++) rand += ALPHABET[bytes[i]! % 32];
  return time + rand;
}

export function idTimestamp(id: string): number {
  let t = 0;
  for (const ch of id.slice(0, 10)) t = t * 32 + ALPHABET.indexOf(ch);
  return t;
}

/**
 * Only same-site paths are allowed as post-login redirects ("/s", "/invite/x?join=1").
 * Anything else (absolute URLs, protocol-relative "//evil", "/\\evil", javascript:) falls back.
 */
export function safeNextPath(next: string | null | undefined, fallback = "/s"): string {
  if (!next || typeof next !== "string") return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f\\]/.test(next)) return fallback;
  return next;
}
