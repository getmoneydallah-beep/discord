# Security audit: Majlis (web, API, mobile client)

**Date:** 2026-11-04 · **Scope:** this monorepo at commit `4136bf3`, plus the fixes in this change: `apps/api` (Fastify + WebSocket), `apps/web` (Next.js), `packages/*`, and `apps/mobile` (client-side only) · **Method:** manual code review of every route, hook, timer and client flow; local reproduction tests against Postgres; real-browser tests (Playwright) for frontend flows; read-only `HEAD`/`GET` requests against production for headers only. No production data was read or changed, and nothing was deployed.

---

## Executive summary

**Overall posture:** good on the fundamentals, with gaps in the edges around them.
- **Fundamentals that held up under test:** tenant isolation, server-side authorization, parameterized SQL, payment and webhook integrity, and secret handling.
- **Gaps found:** rate-limit integrity, logging hygiene, browser security headers, redirect handling and resource quotas.

**Most significant risks found:**
1. **SEC-01 (High):** the login brute-force limit could be bypassed by sending a fake `X-Forwarded-For` header. The API trusted every proxy hop, so an attacker could rotate fake IPs and guess passwords without limit.
2. **SEC-03 (Medium):** 30-day login tokens were written to the request logs in plain text through the WebSocket `?token=` URL.
3. **SEC-10 (Medium):** an open redirect after login could send users to a phishing site through a crafted link.
4. **SEC-04 (Medium):** the web app sent no security headers: it could be framed (clickjacking), and had no `nosniff` and no HSTS.
5. **SEC-06 (Medium):** there was no storage quota, so any member could fill a majlis's R2 storage, at the teacher's or Majlis's expense.
6. **SEC-11 (Medium):** a crafted `?join=1` invite link silently added a logged-in user to an attacker's server.

**Release-blocking issues:** none remain open. Every confirmed Critical, High and Medium finding is fixed, and each has a regression test. **The fixes are not deployed:** see the deployment notes at the end.

---

## Application map (Phase 1)

| Area | What it is |
|---|---|
| Runtime | Node 22, TypeScript monorepo (pnpm and turbo) |
| API | Fastify 5 REST and a `@fastify/websocket` gateway; `postgres` (postgres.js) with tagged-template queries; zod validation |
| Database | PostgreSQL (Neon in production); migrations 001–005 |
| Auth | Email and password (scrypt N=16384), HS256 JWT valid for 30 days, sent as `Authorization: Bearer` (REST) or `?token=` (WebSocket). Web keeps it in `localStorage`; mobile in SecureStore |
| Storage | Cloudflare R2 with presigned PUT/GET; local-disk driver with HMAC-signed URLs for development |
| Payments | Whop. Majlis's account sells teacher plans (`/webhooks/whop`). Teachers' own accounts are connected with a pasted API key, encrypted with AES-256-GCM, and each gets a webhook at `/webhooks/whop/:connectionId` |
| Multi-tenant | **Yes.** A "server" (majlis) is the tenant. Roles: owner > admin > member. Paid content is gated by entitlements |
| Background jobs | Hourly upload garbage collection (advisory lock); daily Whop key health check |
| Trust boundaries | Browser/mobile → API (JWT); Whop → API (Standard Webhooks HMAC); API → Whop/R2 (server credentials); teacher-supplied Whop keys (stored, encrypted) |

**Routes reviewed:** about 60 REST routes across `auth`, `servers`, `messages`, `courses`, `uploads` and `billing`; the local `/storage/*` routes; `/gateway`; `/health`. Server-side permission helpers: `requireAuth`, `repo.requireMember`, `repo.channelAccess`, `repo.channelContentAccess`, `canAccessChannel`, plus owner/admin checks per route.

---

## Vulnerability table

| ID | Severity | Vulnerability | Location | Status |
|---|---|---|---|---|
| SEC-01 | **High** | Login and sign-up rate limits bypassable by spoofing `X-Forwarded-For` (`trustProxy: true`); no per-account limit | `apps/api/src/app.ts` (Fastify options), `src/routes/auth.ts` | **Fixed** |
| SEC-03 | Medium | JWTs written to request logs through `/gateway?token=` | `apps/api/src/app.ts` (logger) | **Fixed** |
| SEC-04 | Medium | Web app missing security headers (clickjacking, sniffing, HSTS); API has no `nosniff` | `apps/web/next.config.ts`, `apps/api/src/app.ts` | **Fixed** |
| SEC-06 | Medium | No storage quota per majlis (cost exhaustion by any member) | `apps/api/src/routes/uploads.ts` | **Fixed** |
| SEC-10 | Medium | Open redirect after login (`/login?next=https://…`) | `apps/web/components/AuthForm.tsx` | **Fixed** |
| SEC-11 | Medium | Cross-site forced join through a crafted `/invite/CODE?join=1` link | `apps/web/app/invite/[code]/page.tsx` | **Fixed** |
| SEC-05 | Low | Uploaded files served with the uploader-supplied content type (stored HTML/XSS on the storage origin) | `apps/api/src/storage.ts`, `src/files.ts` | **Fixed** (R2 upload binding still open: R-4) |
| SEC-02 | Low | Tokens of deleted accounts still accepted | `apps/api/src/auth.ts` | **Fixed** |
| SEC-07 | Low | Checkout endpoints (which call Whop's API) not rate-limited | `apps/api/src/routes/billing.ts` | **Fixed** |
| SEC-08 | Low | Members could broadcast "typing" into announcement-only or locked channels | `apps/api/src/gateway.ts` | **Fixed** |
| SEC-12 | Low | Login response time revealed whether an email is registered | `apps/api/src/routes/auth.ts` | **Fixed** |
| SEC-13 | Low | Production would allow any CORS origin if `CORS_ORIGINS` were unset | `apps/api/src/config.ts` | **Fixed** (startup check) |
| SEC-14 | Info | `X-Powered-By: Next.js` header | `apps/web/next.config.ts` | **Fixed** |

No Critical findings.

---

## Detailed findings

### SEC-01 · High · Brute-force protection bypass through `X-Forwarded-For`
- **Root cause:** `Fastify({ trustProxy: true })` trusts *every* hop in `X-Forwarded-For`, so `req.ip` became the left-most, client-controlled address. Login and sign-up were limited only per `req.ip` (10/min), so changing the header each request removed the limit. Nothing limited attempts per account.
- **Evidence:** `test/security.test.ts › SEC-01`, before the fix: 12 login attempts with rotating `X-Forwarded-For` all returned `401`, never `429`.
- **Impact:** unlimited online password guessing against any account (there's no MFA). Mass sign-up abuse.
- **Fix:**
  - `trustProxy` now trusts exactly `TRUST_PROXY_HOPS` hops (`fly.toml` sets `1` for Fly's edge proxy, which appends the real client IP; the default is 0).
  - New per-account limiter: 10 attempts per 15 minutes per email, whatever the IP.
- **Verification:** the test now models Fly: spoofed entries plus a proxy-appended real IP. It asserts `429` for (a) one real IP rotating spoofed entries and (b) one account attacked from 12 different IPs. **Passes.**

### SEC-03 · Medium · Bearer tokens in logs
- **Root cause:** the WebSocket takes its JWT as `?token=` (browsers can't set headers on WebSocket connections), and Fastify logged `req.url` in full.
- **Evidence:** my local log from earlier test runs held 16 entries of `"url":"/gateway?token=eyJ…"`. Production logs at the same `info` level, so the same happens there.
- **Impact:** anyone with access to the logs (Fly dashboard, log drains, support tooling) could take over accounts for 30 days.
- **Fix:** a custom request serializer runs `redactUrl()`, which replaces `token=` values with `[redacted]`.
- **Verification:** unit test `SEC-03`. Live check: after a fresh gateway connection, the log contained 0 raw tokens and 4 redacted entries. **Passes.**
- **Follow-up:** production logs written before this fix still contain tokens. They are signed with `JWT_SECRET`, so **rotating `JWT_SECRET` at deploy invalidates every logged token** (and logs everyone out). Recommended.

### SEC-04 · Medium · Missing security headers
- **Evidence:** production `HEAD /` returned none of `X-Frame-Options`, CSP, `X-Content-Type-Options`, HSTS or `Referrer-Policy`, and did return `X-Powered-By: Next.js`. The API returned none either.
- **Impact:** the app could be framed to trick users into clicking actions (clickjacking), browsers could sniff MIME types, and there was no HSTS.
- **Fix:**
  - **Web:** `X-Frame-Options: DENY`, `CSP: frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, and HSTS; `poweredByHeader: false`.
  - **API:** `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, and HSTS in production.
- **Verification:** `SEC-04` (API). Local web headers checked with `curl -I`. YouTube embeds, Whop checkout redirects and uploads are unaffected (CSP doesn't restrict `frame-src`, `script-src` or `connect-src`). **Passes.**

### SEC-06 · Medium · No storage quota
- **Root cause:** each plan advertises a storage size (`TIERS.storageGb`), but nothing enforced it. Any member could create 100 MB attachment uploads at 60 per minute.
- **Evidence:** `SEC-06`, before the fix: two 1.5 GB uploads on a Free (2 GB) majlis were both accepted (`201`).
- **Fix:** at upload creation, the total size of the majlis's uploads plus the new one must fit the owner's plan, otherwise `413 storage_quota_exceeded`. Pending uploads count, so an unfinished upload can't be used to get around it.
- **Verification:** `SEC-06` (the second upload gets `413`). **Passes.** See R-4 for the remaining R2 limitation.

### SEC-10 · Medium · Open redirect after login
- **Root cause:** `AuthForm` called `router.replace(params.get("next"))` without validating it.
- **Evidence (Playwright):** logging in at `/login?next=https://example.org/phish` landed on `https://example.org/phish`.
- **Fix:** a new `safeNextPath()` helper in `packages/shared` allows only same-site paths and rejects absolute URLs, `//host`, `/\host`, `javascript:` and control characters.
- **Verification:** unit tests in `packages/shared`. A Playwright re-run now lands on `/s`. **Passes.**

### SEC-11 · Medium · Forced join (CSRF-style) through `?join=1`
- **Root cause:** the invite page auto-joined any logged-in visitor when the URL had `?join=1`. That flag was meant only for "continue after sign-up".
- **Evidence (Playwright):** a logged-in victim opening an attacker's `/invite/CODE?join=1` became a member without clicking anything.
- **Impact:** an attacker could add victims to a server without consent, exposing their display name to its members and pushing its messages to them.
- **Fix:** the sign-up and login form saves `majlis.pendingJoin = <code>` in `sessionStorage`. The invite page auto-joins only if that marker matches, then clears it. Otherwise it shows the normal "Join" button.
- **Verification:** the Playwright re-run shows the victim is not joined, and the legitimate invite → sign-up → auto-join flow still lands on the majlis home. **Passes.**

### SEC-05 · Low · Upload content-type spoofing
- **Root cause:** the declared content type was checked at upload creation, but the stored object kept whatever `Content-Type` the client sent with the bytes, and that type was used when serving it.
- **Evidence:** `SEC-05` (local driver): a PUT of `<script>…` with `text/html` for an upload declared as `image/png` was served back as `text/html`.
- **Impact:**
  - **R2:** files are served from `*.r2.cloudflarestorage.com`, a different origin with no Majlis credentials, so this allows hosting phishing or HTML there rather than stealing sessions.
  - **Local driver** (development, or `ALLOW_LOCAL_STORAGE`): files are served from the API origin. No cookies are used, but it's still undesirable.
- **Fix:**
  - **Local driver:** the declared type is now part of the PUT signature, so a mismatched upload gets `403`, and files are served with `nosniff`.
  - **Both drivers:** GET links now force `response-content-type` to the type recorded in the database.
- **Verification:** `SEC-05`. **Passes.** The R2 upload itself still isn't bound to the type: see R-4.

### SEC-02 · Low · Deleted accounts' tokens still worked
- **Evidence:** `SEC-02`, before the fix: `GET /servers` returned `200` after `DELETE /me`.
- **Fix:** `authenticate()` checks that the user still exists, on every REST request and gateway connection.
- **Verification:** `SEC-02` (`401`). **Passes.**

### SEC-07 · Low · Unthrottled checkout creation
- **Fix:** 10 checkouts per minute per user, shared by `/billing/checkout` and `/offers/:id/checkout`.
- **Verification:** `SEC-07`. **Passes.**

### SEC-08 · Low · Typing indicator in channels the user can't post in
- **Fix:** the gateway's `TYPING` handler now requires membership, posting rights (announcement channels are staff-only) and access to the channel (paid content).
- **Verification:** `SEC-08` (no `TYPING_START` reaches the owner). **Passes.**

### SEC-12 · Low · Account enumeration by timing
- **Fix:** an unknown email now still runs one scrypt comparison, against a fixed dummy hash.
- **Verification:** code review only; I didn't run a statistical timing test. Sign-up still reveals `email_taken`, which is accepted (see R-2).

### SEC-13 / SEC-14 · Low / Info
- **SEC-13:** the API now refuses to start in production without `CORS_ORIGINS`. `fly.toml` already sets it, and production currently sends no CORS header to foreign origins (verified with `curl`).
- **SEC-14:** the `X-Powered-By` header is removed.

---

## Verified controls (tested, no issue found)

- **Tenant isolation and privilege** (`SEC-09`): 64 checks. An outsider, an anonymous client and a plain member tried every server-scoped resource:
  - servers, channels, messages, reactions and reports
  - courses, sections, lessons, progress and previews
  - uploads, invites, offers, entitlements, summary and search
  - roles, kick and ban

  Every attempt was denied (`401/403/404`), and the owner's data was intact. The tenant always comes from verified membership on the server, never from request parameters.
- **Payment and webhook integrity** (`test/billing.test.ts`, 16 tests, all passing):
  - Webhooks are rejected for a bad signature, a stale timestamp, the wrong account, or another teacher's connection secret.
  - Duplicate deliveries are ignored.
  - Purchases only unlock offers whose server is owned by the connection's teacher.
  - Teacher-plan events are only accepted on Majlis's own webhook.
  - Prices, plans and metadata are always set on the server.
  - The tier comes from webhook data, and entitlements are server-side.
  - Refunds and chargebacks remove access.
  - A revoked Whop key pauses selling, and keys are encrypted at rest and never returned.
- **SQL injection:** every query uses postgres.js tagged templates. `sql.unsafe` is used only with constants (`uploadJson`) and migration files. Search terms are stripped to letters and digits before `to_tsquery`.
- **XSS:** there's no `dangerouslySetInnerHTML` except a constant theme script. Message links render only `http(s)` URLs. Video embeds are rebuilt from a validated YouTube or Vimeo ID. React escapes everything else.
- **Path traversal:** storage keys are generated by the server (`serverId/uploadId.ext`), and the local driver confines paths to its root.
- **Uploads:** per-purpose type and size rules, a size re-check on completion, an owner check on complete and cancel, and same-server and purpose checks when attaching.
- **Course reordering:** the new order must describe exactly the course's own sections and lessons. Lesson and section IDs from other courses are rejected.
- **JWT:** the algorithm is pinned to HS256, and production requires a secret of at least 32 characters.
- **Secrets:**
  - none in tracked files or git history (pattern scan)
  - only `.env.example` files are committed
  - the only frontend environment value is the public API URL
  - the Whop webhook secret is never printed (the script stages it straight into Fly)

---

## Remaining risks and recommendations

| # | Risk | Recommendation |
|---|---|---|
| R-1 | **Tokens:** JWTs last 30 days, with no server-side revocation (only account deletion). The web app keeps them in `localStorage`, so any future XSS could steal them | Shorter access tokens plus refresh tokens, or httpOnly `SameSite` cookies with CSRF protection. Add a `token_version` column to support "log out everywhere" |
| R-2 | **Accounts:** no email verification and no password reset (neither feature exists). Sign-up reveals registered emails | Add verification and reset flows (single-use, expiring tokens). Accept or reduce sign-up enumeration |
| R-3 | **Rate limits are in memory**, per instance. They weaken with more than one API machine | Move to Redis (Upstash is already planned) before scaling out |
| R-4 | **R2 presigned PUT doesn't bind content type or size.** A client can upload a different type or a larger object than declared until `complete` checks it. Unfinished oversized objects stay until the 24 h garbage collection runs | Sign `content-type` into the R2 PUT (needs testing against the real bucket), and add an R2 lifecycle rule deleting objects older than 2 days without a database row. Downloads are already forced to the recorded type |
| R-5 | **CSP has no `script-src`** (only framing, base, object and form are restricted) | Nonce-based CSP once inline scripts are inventoried |
| R-6 | **By design:** server admins can grant paid access for free. A teacher can read their own Whop webhook secret and forge events, but only for their own offers (verified) | Document in the teacher terms |
| R-7 | **Dependencies:** 2 moderate advisories (`glob`, `minimatch`) in `expo` → `@expo/cli`, build-time tooling only | Upgrade Expo when a fixed release is available |
| R-8 | **WebSocket limits:** no limit on connections per user. Typing is throttled per connection | Cap connections per user in the gateway |
| R-9 | **No linter is configured** in the repo | Add ESLint with security rules (e.g. `eslint-plugin-security`) to CI |
| R-10 | **Proxy hops:** `TRUST_PROXY_HOPS=1` assumes only Fly's edge sits in front of the API | Set it to `2` if Cloudflare (or another proxy) is placed in front |

### Not tested (assumptions to verify)
- **R2 bucket:** that it is private, and its CORS policy. I didn't access the bucket. The README says private, and access works only through signed URLs.
- **Neon database role:** its privileges and the TLS settings in the `DATABASE_URL` stored as a Fly secret, which I didn't read.
- **Fly organisation access** and log-drain recipients.
- **Mobile binaries:** pinning, jailbreak and root behavior. Only the shared client code was reviewed.
- **Load and denial-of-service testing,** and **real-money payments.** Both excluded by the audit rules. Payment flows were verified in the Whop **sandbox** in earlier work and with mocked webhooks here.
- **Login timing:** a statistical measurement after SEC-12. Not run.

---

## Final assessment

- **No known Critical or High findings remain open.** The one High (SEC-01) and all Medium findings are fixed, and every fix has an automated regression test.
- **Validation run for this report:**
  - `pnpm test`: 61 passed (API 47, shared 14)
  - `pnpm typecheck`: 6 of 6 packages
  - API production build and web production build: both pass
  - `pnpm audit --prod`: 2 moderate issues (build tooling only)
  - real-browser checks of the redirect and invite flows

This doesn't make the application completely secure. The items under "Remaining risks" and "Not tested" — especially R-1 (token lifetime and storage), R-2 (no verification or reset) and R-3 (in-memory rate limits) — should be addressed before a large public launch.

### Deployment notes (not deployed)
1. Deploy the API with the committed `fly.toml`. It sets `TRUST_PROXY_HOPS=1`. Without it, every user would share one rate-limit bucket (the proxy's IP), and logins would be throttled site-wide.
2. `CORS_ORIGINS` must be set in production, or the API now refuses to start (it already is in `fly.toml`).
3. **Recommended:** rotate `JWT_SECRET` when deploying, to invalidate tokens that may already be in production logs (SEC-03). Everyone will need to log in again.
4. Then deploy the web app to pick up the headers and the redirect and join fixes.
