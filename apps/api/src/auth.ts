import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { jwtVerify, SignJWT } from "jose";
import { config } from "./config";
import { HttpError } from "./errors";

const SCRYPT: ScryptOptions = { N: 16384, r: 8, p: 1 };

function scrypt(password: string, salt: Buffer, len: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password, salt, len, SCRYPT, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

/** Format: scrypt$<salt b64>$<hash b64> */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return ["scrypt", salt.toString("base64"), hash.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, saltB64, hashB64] = stored.split("$");
  if (algo !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length);
  return timingSafeEqual(expected, actual);
}

const secret = new TextEncoder().encode(config.jwtSecret);

export async function signToken(userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret);
}

export async function verifyToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

declare module "fastify" {
  interface FastifyRequest {
    userId: string;
  }
}

/**
 * Set by buildApp: does this user still exist? Tokens of deleted accounts are
 * rejected even though their signature is still valid.
 */
let userExists: ((id: string) => Promise<boolean>) | null = null;
export function setUserExistsCheck(fn: (id: string) => Promise<boolean>) {
  userExists = fn;
}

/** Resolves a token to a live user id, or null. */
export async function authenticate(token: string | null | undefined): Promise<string | null> {
  const userId = token ? await verifyToken(token) : null;
  if (!userId) return null;
  if (userExists && !(await userExists(userId))) return null;
  return userId;
}

/** preHandler: requires a valid Bearer token and sets request.userId. */
export async function requireAuth(req: FastifyRequest) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  const userId = await authenticate(token);
  if (!userId) throw new HttpError(401, "unauthorized");
  req.userId = userId;
}

/** A real scrypt hash of a random password, so unknown emails cost the same time as wrong passwords. */
let dummyHash: Promise<string> | null = null;
export function dummyPasswordHash() {
  return (dummyHash ??= hashPassword(randomBytes(16).toString("hex")));
}
