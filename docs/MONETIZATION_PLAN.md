# Majlis: monetization and growth plan

**The rule:** members (students and regular users) always use Majlis for free. **Only teachers, meaning server owners, pay.** They pay a monthly platform subscription, plus a small platform fee on what they sell. Teachers sell access to their server's paid content, and Majlis pays them out through Whop.

---

## 1. How money flows

**Model:** Majlis's own Whop account is the **only seller**. Every payment — teacher subscriptions *and* student purchases — goes into Majlis's Whop balance. Majlis keeps an **earnings ledger** for every teacher and **pays teachers out through Whop connected accounts** (the owner has done this before). No Whop Platforms API, no invite needed.

```
 Teacher ──$29–199/mo──────────────▶ ┌──────────────────────────────┐
                                      │  Majlis Whop account         │
 Student ──pays 99 SAR (offer by ────▶│  (merchant of record)        │
           teacher X)                 └──────┬───────────────────────┘
                                             │ webhook: payment succeeded / refunded / disputed
                                             ▼
                                   Majlis API → access granted + ledger entry:
                                     +99.00 sale  −Whop fees  −Majlis fee (5%) = teacher X earns
                                             │ after a 14-day hold (refund window)
                                             ▼
                              "Payouts" admin page: teacher X has 412 SAR available
                                             │ owner sends it in Whop to X's connected account
                                             ▼                (later: automated via Transfers API)
                                   mark payout paid → teacher sees it under "Earnings → Paid"
```

| | Teacher subscription | Student buys a teacher's offer |
|---|---|---|
| Seller on Whop | Majlis | **Majlis** |
| Whop objects | One product "Majlis for Teachers" + plans | One Whop product + plan **per teacher offer**, on Majlis's account (created by our API; `metadata` holds `server_id` / `offer_id` / `teacher_id`) |
| Refunds & disputes | Majlis | **Majlis** (deducted from the teacher's ledger) |
| Money to teacher | — | Payout from Majlis's balance to the teacher's **Whop connected account** |

### What this means
- ✅ **Everything works in the Whop sandbox today**: checkout, trials, coupons, webhooks, access. Only the payout step itself is done in production (sandbox has no payouts) — and it's a step the owner already knows.
- ✅ **Teachers don't need KYC with us to start selling** — they only need a Whop account to *receive* payouts. They can sell from day one and connect payouts later; earnings accumulate.
- ⚠️ **Majlis carries refund and chargeback risk.** Mitigation: a **hold period** (default 14 days, longer for new teachers) before earnings become payable; refunds/chargebacks after payout create a negative balance recovered from future earnings; content-abuse rules in the teacher terms.
- ⚠️ **Tax:** Majlis collects the full sale, so it is the seller of record for VAT purposes (Saudi VAT 15%, ZATCA e-invoicing) — or a "marketplace agent" if structured that way. **Accountant must confirm the structure** before going live; it also decides what goes on student receipts.
- ⚠️ **Saudi payment methods:** confirm Whop checkout supports **mada / Apple Pay / STC Pay** for Saudi buyers. If not, Tap Payments or Moyasar can be added later as a second checkout behind the same `PaymentProvider` interface — the ledger and payouts stay the same.
- ⚠️ **Sandbox limits:** cards only (no Apple/Google Pay), no payouts.

---

## 2. Teacher plans (proposal: prices to be decided)

| | **Free** | **Starter** | **Pro** | **Academy** |
|---|---|---|---|---|
| Price | 0 | **$29/mo** (≈109 SAR) | **$79/mo** (≈296 SAR) | **$199/mo** (≈746 SAR) |
| Servers you own | 1 | 1 | 3 | 10 |
| Selling paid access | ✗ (free communities only) | ✓ | ✓ | ✓ |
| Paid offers per server | n/a | 3 | Unlimited | Unlimited |
| Majlis fee on sales | n/a | 5% | 2% | 0% |
| Video and file storage | 2 GB | 50 GB | 300 GB | 1 TB |
| Coupons and free trials | ✗ | ✓ | ✓ | ✓ |
| Affiliate program | ✗ | ✗ | ✓ | ✓ |
| Analytics | Basic | Basic | Full | Full + export |
| Custom domain and branding | ✗ | ✗ | ✓ | ✓ (remove Majlis branding) |
| Extra admins and moderators | 1 | 2 | 5 | Unlimited |
| Certificates, drip content, quizzes | ✗ | ✓ | ✓ | ✓ |

- Every paid plan starts with a **14-day free trial**, which Whop supports on plans.
- Offer a yearly price with two months free.
- The server stays usable if the subscription lapses. Selling pauses, and paid content stays accessible to existing buyers until their own access ends. Never punish students for the teacher's billing.

---

## 3. Free and paid content (the teacher decides)

Teachers create **offers** («العروض»). An offer is something a student can buy, and it unlocks chosen parts of the server.

- **Offer:** name, description, price, and billing type: **one-time** (lifetime), **monthly** or **yearly**. An optional free trial and a seat limit (for example "first 50 students") can be added.
- **What it unlocks:** any mix of specific **courses**, specific **channels** (for example a VIP chat or a homework channel), or "everything in the server".
- **Default visibility for each course and channel:**
  - 🟢 **Free:** every member.
  - 🔒 **Paid:** only members holding an offer that unlocks it.
  - 👁 **Preview:** inside a paid course, chosen lessons are marked **"free preview"**. Visitors can watch them; the rest show a lock. This is the strongest sales tool.
- **Locked items stay visible** in the sidebar and course outline with a 🔒 and an «افتح بـ 99 ر.س» ("Unlock for 99 SAR") button. Hiding them would hide what's for sale.
- **Manual access:** the teacher can give someone an offer for free (scholarships, gifts, a team), and can revoke it.

### Data model (new tables)
```
teacher_subscriptions (user_id, whop_membership_id, tier, status, trial_ends_at, current_period_end)
payout_accounts       (teacher_user_id, whop_username / whop_company_id, connected_at, status)  -- where we send money
offers                (id, server_id, name, description, price_minor, currency, billing: one_time|monthly|yearly,
                       trial_days, seat_limit, whop_product_id, whop_plan_id, whop_checkout_config_id, active, position)
offer_grants          (offer_id, target_type: server|channel|course, target_id)
channel_access        (channel_id, visibility: free|paid)          -- default free
lesson_flags          (lesson_id, free_preview bool)
entitlements          (id, user_id, offer_id, source: whop|manual|coupon, whop_membership_id,
                       status: active|trialing|past_due|canceled|expired, starts_at, ends_at)
coupons               (id, server_id, code, percent_off|amount_off, max_uses, expires_at, whop_promo_id)
payments_log          (id, server_id, user_id, offer_id, whop_payment_id, amount, fee, status, raw jsonb)
webhook_events        (id, provider, event_id UNIQUE, type, received_at, processed_at)   -- prevents processing an event twice
```

### Enforcement (server-side, never trusted to the client)
- A single `canAccess(user, target)` check:
  - owner or admin → yes;
  - target is free → yes;
  - otherwise yes only if the user has an active entitlement whose offer unlocks the target, or the whole server.
- It's used everywhere `channelAccess` is used today:
  - reading and sending messages;
  - the gateway's real-time push (locked channels don't receive pushes);
  - lessons and progress;
  - **signed R2 links for videos and files** (no link is issued without access);
  - search results.
- When access ends (refund, cancellation, failed payment), the API emits an event, and clients re-lock the content immediately.

---

## 4. Whop integration details

All on **Majlis's single Whop account** with a normal company API key — no Platforms API.

**A. Teacher subscription**
- One Whop product "Majlis for Teachers" with Starter/Pro/Academy plans (monthly + yearly, 14-day trial) — created once by a setup script.
- Upgrade → API creates a checkout configuration (`metadata.kind = "teacher_subscription"`, `metadata.user_id`) → redirect to Whop checkout → `redirect_url` back to `/billing`.
- Webhooks (membership valid/invalid, payment succeeded/failed) update `teacher_subscriptions` → tier limits apply instantly.

**B. Students buying a teacher's offer**
1. **Publishing an offer** creates a Whop product + plan on Majlis's account (name shows teacher + offer, e.g. «أكاديمية التصميم — الاشتراك الشهري»), billing one-time / monthly / yearly, optional trial. Editing price creates a new plan (existing subscribers keep theirs).
2. **Buying:** "Unlock" → API creates a checkout configuration with `metadata = { kind: "offer", offer_id, server_id, teacher_id, majlis_user_id, ref }` → Whop checkout → back to a "Processing…" screen that waits for the webhook.
3. **Webhook `payment succeeded`** → entitlement granted (or extended for renewals) **and** ledger entries written: `sale` +gross, `whop_fee` −actual fee from the payment object, `platform_fee` −(tier %), each with `available_at = now + hold`.
4. **Membership invalid** (cancelled/expired/failed renewal) → entitlement ends at period end. **Refund / dispute** → access revoked + negative ledger entries.
5. **Coupons** map to Whop promo codes scoped to that offer's plan (teacher creates them in Majlis; API creates them in Whop).

**C. Teacher payouts (via Whop connected accounts)**
- **Teacher → "Earnings" page:** pending (in hold), available, paid; per-sale history; "Connect your Whop account to receive payouts" (store their Whop username / account id — the owner links it as a connected account in the Whop dashboard).
- **Owner → "Payouts" admin page:** list of teachers with available balance ≥ minimum (e.g. 100 SAR), their connected Whop account, CSV export → owner sends payouts in Whop (as today) → clicks "Mark paid" with the Whop reference → `payout` ledger entry, teacher notified.
- **Schedule:** e.g. every Sunday / twice a month. **Later (optional):** automate with Whop's Transfers API (`transfers.create`, origin = Majlis, destination = teacher's account) if available on the account — the ledger already supports it.
- **Safety:** payouts never exceed the available (post-hold) balance; negative balances block payouts; every number is derived from the append-only ledger, so it always reconciles with Whop.

**Webhooks & reliability:** verify Whop signature, idempotency via `webhook_events`, retry-safe processing, nightly reconciliation of memberships and payments against Whop.

**Environments:** `WHOP_ENV=sandbox|production` (sandbox API `https://sandbox-api.whop.com/api/v1`, production `https://api.whop.com/api/v1`); secrets on Fly: `WHOP_API_KEY`, `WHOP_WEBHOOK_SECRET`, `WHOP_COMPANY_ID`. Sandbox test cards: `4242 4242 4242 4242` (success), `4000 0000 0000 0002` (declined), `5385 3083 6013 5181` (3DS).

---

## 5. App Store and Google Play rules (important)

- **Apple (guideline 3.1.1)** requires Apple's own in-app purchase for digital content bought *inside* the iOS app. On the Saudi App Store we also **may not link or point** users to an outside purchase page.
- **The approach:** the **iOS and Android apps never show prices or "buy" buttons.** Content someone has already bought unlocks in the app automatically, which Apple allows for multiplatform services under 3.1.3(b). Locked items in the app say «متاح للمشتركين» ("For subscribers") with no price and no link.
- **All selling happens on the website:** teacher subscriptions and student purchases.
- Teacher subscriptions are business software, also sold only on the web.
- Revisit later. Adding Apple and Google in-app purchases for student offers is possible, but Apple and Google take 15–30%.

---

## 6. Landing pages

### 6.1 Platform landing page (`majlis…/`, for logged-out visitors)
Arabic first with an English toggle. Rendered on the server so search engines can index it (today the web app renders entirely in the browser). Sections:
1. **Hero:** «حوّل خبرتك إلى مجتمع يدفع» ("Turn your expertise into a paying community") — community, courses and payments in one Arabic platform. Main button: «ابدأ مجتمعك مجاناً» ("Start your community free"). Second button: «جرّب كطالب» ("Try as a student").
2. **For whom:** teachers, trainers, coaches, Quran teachers, creators.
3. **How it works in 3 steps:** create your majlis → add courses and chat → sell access and get paid.
4. **Features grid:** Arabic-first and RTL, video courses, live chat, mobile apps, progress tracking, payouts, coupons, affiliates, certificates.
5. **Product screenshots:** course page, lesson page, chat, earnings dashboard.
6. **Pricing:** the teacher plans from §2, with a note that students never pay to use Majlis.
7. **FAQ:** fees, payouts, mada, refunds, content protection, data location.
8. **Final call to action**, and a footer with terms, privacy and contact.

### 6.2 Public sales page for each server (`/m/<slug>`)
The page teachers share on Instagram, X, Snapchat and WhatsApp. Also server-rendered, with rich link previews (Open Graph) and indexable. It shows:
- cover, logo, name and tagline;
- teacher bio and photo;
- member count;
- **what's included:** courses with lesson count and total duration, channels, and free-preview lessons that play right on the page;
- **offers** with prices (one-time, monthly or yearly), coupon entry and trial badge;
- testimonials and FAQ (written by the teacher);
- «انضم مجاناً» ("Join free") for the free tier, «اشترك» ("Subscribe") per offer.

Teachers edit it in a simple form, with no page builder.

---

## 7. More features that help course sellers sell (prioritized)

**Must-have (launch with payments):**
1. **Free preview lessons and a free tier.** People try before they buy; this is the biggest driver of sales.
2. **Coupons and launch pricing:** for example «خصم ٣٠٪ لأول ٥٠ طالب» (30% off for the first 50 students), Ramadan offers and expiry dates.
3. **Free trials** on monthly offers.
4. **Earnings dashboard:** revenue, monthly recurring revenue (MRR), active subscribers, new versus cancelled, payouts, best-selling offer.
5. **Member management (CRM):** buyer list, offer and status, progress, export to CSV, grant or revoke access, message a member.
6. **Announcements:** a broadcast to all members or one offer's buyers, as a push notification plus a pinned post (email later).
7. **Teacher onboarding checklist:** "Your majlis in 5 steps": add a cover, create your first course, add a free preview, create an offer, share your link.

**Next (growth):**
8. **Affiliate program:** members get a referral link and earn a share (for example 20%) of sales they bring in. Whop has affiliate support; tracking uses `?ref=` stored at checkout.
9. **Drip content:** unlock a lesson or section X days after joining, or on a set date (cohort launch).
10. **Certificates of completion:** an Arabic PDF with the teacher's name and signature, a verification link, and easy sharing to LinkedIn.
11. **Quizzes and assignments:** multiple choice with auto-grading, and file-upload assignments the teacher reviews.
12. **Live sessions and events calendar:** schedule with reminders, then live audio and video through LiveKit (planned v2), with recordings auto-added as lessons.
13. **Bundles and upsells:** "Course + VIP chat" at a discount; show a related offer after a purchase.
14. **Reviews and ratings** on the sales page, from verified buyers only.
15. **Content protection:**
    - signed links (done);
    - a moving watermark showing the student's email or ID on video;
    - downloads disabled;
    - later, Cloudflare Stream with signed streaming links.
16. **Custom domain** for the sales page (Pro plan), for example `academy.teacher.sa`.
17. **Abandoned-checkout recovery:** remind a member who started a checkout but didn't pay, by push notification.
18. **Learner engagement:** streaks, a "you're 80% done" nudge, and a course discussion channel created automatically per course.
19. **Hijri dates and Ramadan and Eid campaigns** built into coupons and scheduling.

---

## 8. Build phases

| Phase | What | Needs from you | Est. |
|---|---|---|---|
| **1** | Platform landing page; server-rendered public sales page `/m/<slug>` with link previews; slugs | Logo or brand direction; landing copy approval | 1 week |
| **2** | Free/paid/preview access rules: offers, grants and entitlements, **manual grants**, locked screens on web and mobile, `canAccess` enforced everywhere, including real-time push and signed R2 links | nothing | 1–1.5 weeks |
| **3** | **Teacher subscription via Whop (sandbox → production):** plans and tier limits, checkout, webhooks, billing page, trials | Whop **sandbox** API key and webhook secret in the environment settings; final prices | 1–1.5 weeks |
| **4** | **Teachers selling:** offers → Whop products/plans on Majlis's account, purchase flow, webhooks → access, **earnings ledger** with hold period, refunds/disputes, teacher Earnings page, owner **Payouts** page (paid via Whop connected accounts) | Same sandbox key; production key at launch | 1.5–2 weeks |
| **5** | Must-haves: coupons, trials, earnings dashboard, member list, announcements, onboarding checklist | — | 1.5 weeks |
| **6** | Growth: affiliates, drip, certificates, quizzes, bundles, reviews, watermark | — | ongoing |
| *(parallel)* | Saudi payment fallback (Tap or Moyasar) if Whop lacks mada or KSA payouts | Merchant account with Tap or Moyasar | 1–2 weeks |

Phases 1 and 2 need nothing from Whop and can start immediately; phases 3–4 run fully in the Whop sandbox (only real payouts need production). Phase 2 also lets teachers grant paid access manually, so they can start onboarding paying students (paid by bank transfer, for example) before checkout exists.

---

## 9. What we need from the owner

1. **Whop sandbox account** — create at sandbox.whop.com → Dashboard → Developer → API key + a webhook secret, and add them as **environment secrets** in this cloud environment's settings (`WHOP_API_KEY`, `WHOP_WEBHOOK_SECRET`) — **not in chat**.
2. **Decide prices:** teacher tiers, Majlis fee % on sales (proposal 5 / 2 / 0 %), **hold period** (proposal 14 days) and **minimum payout** (proposal 100 SAR), payout schedule.
3. **Ask Whop support** (normal support, no Platforms request): does checkout support **mada / Apple Pay / STC Pay** for Saudi buyers?
4. **Accountant:** VAT structure when Majlis collects payments on behalf of teachers (seller of record vs. agent), ZATCA invoices.
5. **Teacher terms:** refund policy, hold period, payout schedule, prohibited content — I'll draft them in Arabic + English.
6. **Logo / brand direction** for the landing page.
