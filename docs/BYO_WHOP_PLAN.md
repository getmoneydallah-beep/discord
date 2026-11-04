# Plan: teachers sell through their own Whop accounts

> **Status: built (2026-11-04), Whop sandbox.** Decisions: no per-sale cut (teacher plans only), teacher plans stay on Majlis's Whop account, only paid plans can connect.
>
> Verified against the real sandbox:
> - `GET /accounts/me` identifies the account behind a pasted key.
> - Connecting creates the webhook on the teacher's account.
> - A real checkout on the teacher's account, relayed with that connection's stored secret, grants access and shows in Sales.
> - A real refund removes access.
> - Disconnecting deletes the teacher's webhook on Whop.
>
> Still open: a second, separately owned sandbox account with a narrowly scoped key, to confirm the exact permission names and archiving a plan with only `access_pass:update`/`plan:create`.

**Change:** students pay the teacher's **own** Whop account, not Majlis's. Each teacher connects their Whop account to Majlis by pasting an API key. The teacher is the seller: they handle refunds, chargebacks, VAT and payouts on their side. Majlis becomes software that opens checkouts and unlocks content when Whop says a payment went through.

This replaces the "Majlis is the seller" model in `MONETIZATION_PLAN.md` §1 and §4B–C for **student purchases**. Teacher plans (what teachers pay Majlis) stay on Majlis's own Whop account: Majlis selling its own software is ordinary and low risk.

---

## 1. What changes for whom

| | Before (built) | After |
|---|---|---|
| Who receives student money | Majlis's Whop account | The teacher's Whop account |
| Seller of record (VAT, receipts) | Majlis | The teacher |
| Refunds and chargebacks | Majlis pays, deducted from the teacher's ledger | The teacher, in their own Whop dashboard |
| Paying teachers | Owner sends payouts by hand | Nothing to do: Whop pays the teacher directly |
| Earnings ledger, hold, Payouts page | Needed | **Removed** (replaced by a read-only Sales list) |
| Majlis income | Teacher plan + 5 / 2 / 0 % per sale | Teacher plan only (see decision 1) |
| Teacher setup | None | Create a Whop account, paste an API key |

**Legal risk:** this removes the biggest risks in the old model: being the seller, VAT and ZATCA invoicing on teachers' sales, holding other people's money, and carrying chargebacks. Two things remain:
- Majlis stores teachers' API keys. That's a security duty: the keys must be encrypted, permission-scoped and revocable.
- Majlis still processes student data (PDPL).

An accountant or lawyer should still confirm the structure, but it's much simpler.

---

## 2. How it works

```
Teacher                          Majlis API                         Teacher's Whop account
   │ 1. pastes API key ─────────▶ checks key, finds the account ──▶ GET /accounts, GET /webhooks
   │                              encrypts and stores the key
   │                              creates a webhook on THEIR account ─▶ POST /webhooks
   │                                   (url /webhooks/whop/<connectionId>, secret stored encrypted)
Student
   │ 2. "Unlock 99 SAR" ────────▶ creates product + plan + checkout ─▶ on the teacher's account
   │ ◀───── redirect to Whop checkout (money goes to the teacher)
   │                              ◀── 3. webhook from the teacher's account: payment.succeeded
   │                              verifies with THAT connection's secret → grants access
   │                              refund / dispute / membership ended → removes access
```

### Key permissions the teacher selects (Whop → Dashboard → Developer → API keys)
`company:basic:read`, `access_pass:create`, `access_pass:update`, `access_pass:basic:read`, `plan:create`, `plan:basic:read`, `checkout_configuration:create`, `checkout_configuration:basic:read`, `payment:basic:read`, `member:basic:read`, `developer:manage_webhook`, `webhook_receive:payments`, `webhook_receive:memberships`, `webhook_receive:refunds`, `webhook_receive:disputes`.

No `payment:manage` and no balance or payout permissions: a leaked key can't move money or issue refunds. The exact list is confirmed in step 0.

### When a key is pasted, the API:
1. Checks the format (`apik_...`) and calls Whop to find the account (`biz_...`) and its title.
2. Checks each required permission with a harmless read or dry call. Any missing permission is shown by name, with the fix.
3. Creates (or replaces) a webhook on the teacher's account pointing to `https://<api>/webhooks/whop/<connectionId>`, pinned to the same API version.
4. Stores the key and webhook secret encrypted with AES-256-GCM. The master key is a Fly secret, `WHOP_KEYS_ENCRYPTION_KEY`, never in the database. Only the last 4 characters of the API key are ever shown again.

### Disconnect and broken keys
- **Disconnect** (teacher clicks, or the key stops working): Majlis deletes its webhook on their account if it still can, wipes the stored key, and pauses selling. Existing buyers keep access, matching the "never punish students" rule.
- **A Whop call fails with 401 or 403:** the connection is marked `broken`, the teacher sees "Reconnect Whop", and checkouts for their offers say "selling paused".
- **Health check:** a daily job checks each connection with a cheap read and records the result.

---

## 3. Code changes (on top of what's built)

**Keep, with small edits**
- Offers, grants, free and paid channels and courses, free previews, entitlements and manual grants.
- `canAccess` everywhere, all lock screens, the mobile "For subscribers" rule.
- Teacher plans, tier limits and the billing page, all still on Majlis's Whop account.
- Checkout flow and webhook handling for payment, membership, refund and dispute. The difference: refunds and disputes now only change access and never touch money.

**New**
- **Migration 004:**
  - a `whop_connections` table: `id`, `teacher_user_id` (unique), `whop_account_id`, `account_title`, `api_key_enc`, `api_key_last4`, `webhook_id`, `webhook_secret_enc`, `status` (`active` / `broken` / `disconnected`), `last_checked_at`, `last_error`, `created_at`
  - a `connection_id` column on `offers`, `checkout_sessions` and `payments`
- **`src/crypto.ts`:** encrypt and decrypt with the master key, which is required in production. Tests cover the round trip and tampering.
- **`createWhop` per connection:** a small cache of clients keyed by connection id. Offer publishing and checkouts use the **server owner's** connection.
- **Routes:**
  - `GET /whop/connection` returns the status, account title and key ending, never the key itself
  - `PUT /whop/connection` takes `{ apiKey }` and runs the checks above
  - `DELETE /whop/connection` disconnects
- **Webhook:** `POST /webhooks/whop/:connectionId` looks up the connection, decrypts its secret, verifies the delivery, and checks the envelope's `account_id` equals the connection's account. Duplicate handling (`webhook_events`) and processing stay as they are. The existing `/webhooks/whop` stays for teacher plans on Majlis's account.
- **Security:** keys never appear in logs (a redaction rule for `apiKey` and `authorization`), and connecting is rate-limited.
- **Web:**
  - a "Connect Whop" card on the Offers page and in Settings, with a step-by-step guide (where to click in Whop, the permission list to tick), connection status, and Reconnect and Disconnect buttons
  - a read-only **Sales** list (from `payments`: date, student, offer, amount, refunded) with a link to the teacher's Whop dashboard for money matters

**Remove**
- The ledger, holds, Majlis fee booking, payout accounts, payouts and the owner Payouts page.
  - Their tables are dropped in migration 004. Production has no real sales yet, so nothing is lost.
  - Their routes, UI, translations and tests go too.
  - The Earnings page becomes the Sales list.
- Majlis-account offer publishing: `offerPlanId` moves to the teacher's connection.

**Tests**
- A fake Whop per connection: connecting with a good key, a key missing permissions, and a bad key.
- A webhook signed with connection A's secret is rejected on connection B's URL, and an `account_id` mismatch is rejected.
- Purchase → access, refund → no access, dispute → no access, with no ledger entries.
- A broken connection pauses checkout, and existing buyers keep access.
- Encryption round trip; the key never appears in API responses or logs.

**Sandbox check (same method as before):** a second sandbox account plays the teacher. Paste its key in the real UI, buy an offer with a real checkout, then relay the real payment and refund to the local API. After deploy, Whop's own deliveries hit `/webhooks/whop/<id>`.

---

## 4. Steps and order

| Step | What | Est. |
|---|---|---|
| 0 | **Spike in the sandbox:** create a second sandbox account and a scoped key. Confirm the exact permission names, that this key can create a webhook on its own account, and plan archiving (`plan:update`?). Adjust the permission list. | ½ day |
| 1 | Migration 004, encryption, connection routes and checks, per-connection client | 1 day |
| 2 | Per-connection webhook route; checkout and publishing moved to the teacher's account; refunds and disputes access-only | 1 day |
| 3 | Remove the ledger and payouts; add the Sales list | ½ day |
| 4 | Web: Connect Whop guide and status, Sales page; translations | 1 day |
| 5 | Tests, sandbox E2E, docs (README, rewrite `MONETIZATION_PLAN.md` §1 and §4) | ½–1 day |
| 6 | Deploy: `fly secrets set WHOP_KEYS_ENCRYPTION_KEY=$(openssl rand -hex 32)`, then deploy the API and web | when the Fly token is available |

About **4–5 days** of work. The existing Majlis-account webhook stays, because teacher plans still use it.

---

## 5. Decisions needed from you

1. **Majlis's income per sale.** With the teacher's own account, Majlis can't take a cut automatically. Whop's application fees only work for sub-accounts created through its invite-only Platforms program. Options:
   - **(a) Recommended:** drop the per-sale fee and earn from teacher plans only. Simple and clean, and it matches the lower-risk goal. Maybe raise plan prices a little.
   - (b) Invoice teachers monthly for a percentage of the sales Majlis saw. That means more admin and collection risk.
2. **Keep teacher plans on Majlis's Whop account?** Recommended: yes. That's Majlis selling its own product; the legal risk you wanted to drop was in reselling teachers' content.
3. **Which plans can connect Whop?** Recommended: as now, only paid plans can sell, so Free stays "free communities only".

**Later (optional) upgrade:** replace key pasting with a **Whop app**. The teacher clicks "Install Majlis" on Whop and approves the permissions. Majlis then stores no teacher keys at all: one app key plus one app webhook for every teacher, and the teacher can revoke it in Whop. It needs an extra linking step (Whop sign-in) to tie an installation to a Majlis account, so it's a follow-up, not v1.
