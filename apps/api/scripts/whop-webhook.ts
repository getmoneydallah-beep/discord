/**
 * Creates (or rotates) Majlis's Whop webhook and stores its signing secret
 * without ever printing it.
 *
 *   WHOP_API_KEY=... WHOP_ACCOUNT_ID=biz_... pnpm --filter @majlis/api whop:webhook -- \
 *     [--url https://majlis-sa-api.fly.dev/webhooks/whop] [--replace] \
 *     [--fly-app majlis-sa-api] [--out /path/to/secret-file]
 *
 * --replace   delete existing webhooks for the same URL first (rotates the secret)
 * --fly-app   pipe WHOP_WEBHOOK_SECRET into `fly secrets import --app <app>`
 * --stage     with --fly-app: stage the secret (applied on the next deploy) instead of restarting now
 * --out       write the secret to a file (mode 600) instead / as well
 *
 * Whop shows a webhook secret only once; if it's lost, run again with --replace.
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { WHOP_WEBHOOK_EVENTS } from "../src/billing";
import { WHOP_API_VERSION_DATE, WHOP_BASE_URL } from "../src/whop";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const apiKey = process.env.WHOP_API_KEY;
const accountId = process.env.WHOP_ACCOUNT_ID;
const env = process.env.WHOP_ENV === "production" ? "production" : "sandbox";
if (!apiKey || !accountId) {
  console.error("Set WHOP_API_KEY and WHOP_ACCOUNT_ID.");
  process.exit(1);
}
const url = opt("url") ?? "https://majlis-sa-api.fly.dev/webhooks/whop";
const flyApp = opt("fly-app");
const out = opt("out");
if (!flyApp && !out) {
  console.error("Pass --fly-app <app> and/or --out <file>: the secret is shown only once and is never printed.");
  process.exit(1);
}

const base = WHOP_BASE_URL[env];
async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(base + path, {
    method,
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "Api-Version-Date": WHOP_API_VERSION_DATE },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as T;
  if (!res.ok) throw new Error(`Whop ${method} ${path} → ${res.status} ${JSON.stringify(data).slice(0, 300)}`);
  return data;
}

interface Hook {
  id: string;
  url: string;
  enabled: boolean;
  events: string[];
  webhook_secret?: string;
}

const existing = (await call<{ data: Hook[] }>("GET", `/webhooks?account_id=${accountId}`)).data.filter((h) => h.url === url);
if (existing.length && !flag("replace")) {
  console.error(`A webhook for ${url} already exists (${existing.map((h) => h.id).join(", ")}). Use --replace to rotate it.`);
  process.exit(1);
}
for (const h of existing) {
  await call("DELETE", `/webhooks/${h.id}`);
  console.log(`deleted old webhook ${h.id}`);
}

const hook = await call<Hook>("POST", "/webhooks", {
  url,
  events: WHOP_WEBHOOK_EVENTS,
  resource_id: accountId,
  api_version_date: WHOP_API_VERSION_DATE,
  enabled: true,
  title: "Majlis API",
});
const secret = hook.webhook_secret;
if (!secret) throw new Error("Whop did not return a webhook secret");
console.log(`created webhook ${hook.id} (${env}) → ${hook.url}`);
console.log(`events: ${hook.events.join(", ")}`);

if (out) {
  writeFileSync(out, `WHOP_WEBHOOK_SECRET=${secret}\n`, { mode: 0o600 });
  console.log(`secret written to ${out}`);
}
if (flyApp) {
  const r = spawnSync("fly", ["secrets", "import", ...(flag("stage") ? ["--stage"] : []), "--app", flyApp], { input: `WHOP_WEBHOOK_SECRET=${secret}\n`, stdio: ["pipe", "inherit", "inherit"] });
  if (r.status !== 0) {
    console.error("fly secrets import failed; the webhook exists, rerun with --replace once fly works (or use --out).");
    process.exit(1);
  }
  console.log(`WHOP_WEBHOOK_SECRET set on Fly app ${flyApp}`);
}
