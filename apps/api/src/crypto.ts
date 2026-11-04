import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Encrypts secrets at rest (teachers' Whop API keys and webhook secrets) with
 * AES-256-GCM. The master key lives only in the environment
 * (WHOP_KEYS_ENCRYPTION_KEY, 64 hex chars), never in the database.
 *
 * Format: v1.<iv b64url>.<tag b64url>.<ciphertext b64url>
 */
export function createSecretBox(masterKeyHex: string) {
  const key = /^[0-9a-f]{64}$/i.test(masterKeyHex)
    ? Buffer.from(masterKeyHex, "hex")
    : createHash("sha256").update(masterKeyHex).digest(); // dev fallback: any string
  return {
    seal(plain: string): string {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
      return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
    },
    open(sealed: string): string {
      const [v, iv, tag, ct] = sealed.split(".");
      if (v !== "v1" || !iv || !tag || ct === undefined) throw new Error("bad sealed secret");
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
    },
  };
}

export type SecretBox = ReturnType<typeof createSecretBox>;
