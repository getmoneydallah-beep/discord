# Majlis: monetization and growth plan

**The rule:** members (students and regular users) always use Majlis for free. **Only teachers, meaning server owners, pay.** They pay a monthly platform subscription, plus a small platform fee on what they sell. Teachers sell access to their server's paid content, and Majlis pays them out through Whop.

---

## 1. How money flows

```
                    ┌──────────────── Majlis (platform Whop account) ────────────────┐
 Teacher ──$29–199/mo──▶  Teacher subscription (our own Whop product)               │
                    │                                                               │
 Student ──pays 99 SAR──▶ Checkout on the TEACHER's connected account ─┐            │
                    │            (direct charge)                      │            │
                    │   application fee (2–5%) ──────────────────────▶ platform    │
                    │   remainder ──▶ teacher's Whop balance ──▶ payout to bank     │
                    └───────────────────────────────────────────────────────────────┘
 Majlis API ◀── webhooks (payment / membership valid / invalid / refund) ── Whop
      └─▶ grants or removes access (entitlements) inside the server
```

**Two separate Whop integrations:**

| | What | Whop feature | Who is the merchant |
|---|---|---|---|
| A | **Teacher pays Majlis** (SaaS subscription) | A normal Whop product on *our* account with monthly or yearly plans | Majlis |
| B | **Student pays teacher** (server access) | Whop **Platforms**: each teacher is a connected account (`biz_…`). We create checkout configurations on their account with an `application_fee_amount`. | The teacher, who handles refunds, disputes and Whop's fees |

We choose **direct charges** over collecting everything and transferring it on. The teacher is then the seller of record for refunds, disputes and tax, and Majlis isn't holding other people's money.

### ⚠️ Blockers to clear first
1. **Whop's Platforms API (connected accounts, KYC, payouts) is invite-only.** We must email sales@whop.com and get approved before part B can go live. Part A, the teacher subscription, doesn't need approval.
2. **The Whop sandbox can't do payouts**, and it takes cards only (no Apple Pay or Google Pay). We can build and test checkout, webhooks and access fully in the sandbox; payouts get tested in production with a small real amount.
3. **Payment methods in Saudi Arabia.** Saudi buyers rely heavily on **mada, Apple Pay and STC Pay**. We need to confirm which ones Whop's production checkout supports for KSA cards. If mada is missing, plan a second option: **Tap Payments** or **Moyasar**, both Saudi gateways that support split payments. Write the payments code behind one interface (`PaymentProvider`) so a second provider can be added without a rewrite.
4. **Whop's payouts to Saudi bank accounts.** Whop says it pays out to "200+ countries". We should confirm KSA bank payouts with Whop when we request Platforms access.
5. **Tax.** Saudi VAT is 15%, and ZATCA requires e-invoices. With direct charges each teacher is responsible for their own VAT. Majlis owes VAT on its own subscription revenue once it's registered. Get an accountant's confirmation.

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
seller_accounts       (server_id, whop_company_id 'biz_…', kyc_status, payouts_enabled)
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

**Part A: teacher subscription.** Available now in the sandbox.
- One Whop product, "Majlis for Teachers", with plans for Starter, Pro and Academy (monthly and yearly). It's created once, by a script.
- "Upgrade" calls the API, which creates a checkout configuration with `metadata.user_id` and redirects to Whop's checkout. The `redirect_url` returns to `/billing?ok=1`.
- Webhooks (membership valid or invalid, payment succeeded or failed) update `teacher_subscriptions`, and the app enables or limits plan features.
- The billing page shows the plan, renewal date, invoices, and change or cancel. This can link to Whop's own management page at first.

**Part B: teachers selling.** Needs the Platforms invite.
1. **"Start selling" onboarding:** create the teacher's connected account (`companies.create` with `parent_company_id` = Majlis). Then send them to Whop's hosted KYC and payout setup link (`account_links`, with `return_url` set to our dashboard). Store `kyc_status` and show a checklist.
2. **Publishing an offer:** create a product and plan on the teacher's account, plus a checkout configuration. Set `account_id` to the teacher's `biz_`, `variant.initial_price` to the price, the billing type, and `application_fee_amount` according to the teacher's tier.
3. **Buying:**
   - The student taps "Unlock", and the API creates or reuses a checkout session with `metadata.majlis_user_id` and `offer_id`, then redirects to Whop's checkout.
   - On return, a "Processing…" screen polls until the webhook confirms payment.
   - The webhook creates the entitlement; the server opens up, with a celebration screen and a push notification.
4. **Payouts:** a "Payouts" tab embeds or links Whop's payout portal (`account_links` with use case `payouts_portal`). Teachers withdraw to a bank, a mobile wallet or crypto.
5. **Refunds and disputes:** handled in Whop by the teacher. A webhook revokes access automatically.
6. **Webhook security:** verify Whop's signature, store each event ID so it's processed once (`webhook_events`), and process in a retry-safe queue. A nightly job compares entitlements against Whop memberships.

**Environments:**
- `WHOP_ENV=sandbox|production`: sandbox is `https://sandbox-api.whop.com/api/v1`; production is `https://api.whop.com/api/v1`.
- Secrets stored on Fly: `WHOP_API_KEY`, `WHOP_WEBHOOK_SECRET`, `WHOP_COMPANY_ID`.
- Sandbox test cards: `4242 4242 4242 4242` succeeds, `4000 0000 0000 0002` is declined, and `5385 3083 6013 5181` triggers the 3-D Secure check.

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
| **4** | **Teachers selling via Whop Platforms:** seller onboarding (KYC link), publishing offers as Whop checkouts with platform fee, purchase flow, webhooks → access, payout portal, refunds | **Platforms invite approved by Whop**; production keys | 1.5–2 weeks |
| **5** | Must-haves: coupons, trials, earnings dashboard, member list, announcements, onboarding checklist | — | 1.5 weeks |
| **6** | Growth: affiliates, drip, certificates, quizzes, bundles, reviews, watermark | — | ongoing |
| *(parallel)* | Saudi payment fallback (Tap or Moyasar) if Whop lacks mada or KSA payouts | Merchant account with Tap or Moyasar | 1–2 weeks |

Phases 1 and 2 need nothing from Whop and can start immediately. Phase 2 also lets teachers grant paid access manually, so they can start onboarding paying students (paid by bank transfer, for example) before checkout exists.

---

## 9. What we need from the owner

1. **Request Whop Platforms access.** Email sales@whop.com (draft below) and confirm Saudi payouts and mada support while you're at it.
2. **Whop sandbox account:**
   - Create one at sandbox.whop.com.
   - Generate an API key (Dashboard → Developer) and set up a webhook secret.
   - Add both as **environment secrets** in this cloud environment's settings (`WHOP_API_KEY`, `WHOP_WEBHOOK_SECRET`), **not in chat**.
3. **Decide prices:** the teacher tiers and the platform fee percentage on sales (the proposal is 5% / 2% / 0%).
4. **Logo and brand direction** for the landing page.
5. **Business entity:** a Saudi commercial registration (CR) or a foreign entity. Whop's KYC and VAT registration depend on it.

### Draft email to Whop (Platforms access)
> **Subject:** Platforms API access request: Majlis (Arabic community & course platform)
>
> Hi Whop team,
>
> We're building **Majlis**, an Arabic-first community and course platform (web, iOS, Android) where teachers run communities with chat and video courses and sell access to their members. We'd like to use **Whop Platforms**: each teacher would be a connected account; we'd create checkouts on their account with an application fee, and teachers would withdraw through your payouts portal. Our platform subscription for teachers would also run on Whop.
>
> Our main market is **Saudi Arabia** and the Gulf. Could you confirm (1) Platforms API eligibility for our use case, (2) payout support to Saudi bank accounts, and (3) whether **mada**, Apple Pay and STC Pay are supported at checkout for Saudi buyers?
>
> We're currently integrating against the sandbox. Thanks!
