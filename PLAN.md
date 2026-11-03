# Arabic-first community chat app: plan

The goal is a Discord-style community chat app built for Arabic first, shipped as a **web app**, an **iOS app** and an **Android app** that share as much code as possible.

> We need our own brand name. "Discord" is a trademark, so the stores will reject anything that uses it. The code calls the project `majlis` (مجلس) for now. Any name works; this is only a placeholder.

---

## 1. Product scope

### MVP (v1)
- Sign up and log in with email or phone OTP, plus Google and Apple sign-in. Apple sign-in is required on iOS whenever we offer other social logins.
- Servers (communities): create, invite by link, join, leave.
- Text channels, with categories to group them.
- Real-time messages: send, edit, delete, reply, mentions, emoji reactions.
- Typing indicators and online/offline presence.
- Image and file attachments.
- Direct messages, both one-to-one and small groups.
- Basic roles and permissions: owner, admin, member.
- Push notifications on mobile and web.
- **RTL Arabic UI by default**, with an English toggle.
- Moderation basics: report a message, kick, ban, delete.

### v2
- Voice channels and video calls, with screen share on web.
- Threads, pinned messages, and search across a server.
- Custom emoji, server banners, profile customisation.
- Bots and webhooks API.
- Stage or audio rooms for majlis-style talks and Q&A.

---

## 2. Arabic-first requirements
These shape the design from day one. They are hard to bolt on later.

| Area | What we do |
|---|---|
| **Layout** | RTL is the default. Use CSS logical properties (`margin-inline-start`, not `margin-left`). On mobile, use `I18nManager` plus `forceRTL`. Mirror icons that point in a direction, such as back arrows and send. |
| **Mixed text** | Messages often mix Arabic, English, numbers and links. Render every message with `dir="auto"` and Unicode bidi isolation so each one shows in the right direction. |
| **Fonts** | IBM Plex Sans Arabic or Noto Sans Arabic for the UI, with an Arabic-friendly emoji fallback. Self-host the fonts so they load fast in the Gulf. |
| **Search** | Normalise Arabic before indexing: unify أ/إ/آ to ا, ى to ي, and ة to ه, and strip tashkeel and tatweel (ـ). Postgres full-text search with a custom normaliser is enough for v1. |
| **Numbers and dates** | A user setting chooses between Western (123) and Eastern Arabic (١٢٣) digits. Dates use `Intl` with the `ar` locale, and a Hijri calendar is optional. |
| **Moderation** | Profanity and spam filters must handle Arabic dialects (Gulf, Egyptian, Levantine, Maghrebi) and Arabizi (Arabic written in Latin letters and numbers, e.g. "7abibi"). |
| **Store listings** | Arabic screenshots, an Arabic name and description, and the Arabic locale enabled in App Store Connect and Play Console. |

---

## 3. Tech stack: one codebase, three apps

```
majlis/                     (pnpm + Turborepo monorepo)
├── apps/
│   ├── web/                Next.js (React)        → Web app
│   ├── mobile/             Expo (React Native)    → iOS + Android
│   └── api/                Node.js (Fastify) + WebSocket gateway
├── packages/
│   ├── shared/             types, zod schemas, permission logic
│   ├── api-client/         typed REST + realtime client (used by web & mobile)
│   ├── i18n/               ar / en translations, Arabic text utils (normalise, bidi)
│   └── ui-tokens/          colors, spacing, typography (shared design system)
└── infra/                  docker-compose for local dev, deploy configs
```

**Why this stack**
- **Expo (React Native)** builds iOS and Android from one TypeScript codebase. EAS Build and Submit handle store builds from the cloud, so we don't need a Mac to build for iOS.
- **Next.js** for the web, with the same React, TypeScript, API client and translations as mobile, so roughly 60–70% of the logic is shared.
- **Fastify with a WebSocket gateway** for the backend. Chat needs long-lived real-time connections, so it runs as an always-on server rather than serverless functions.
- **PostgreSQL** stores users, servers, channels and messages. It is relational, reliable and has good full-text search.
- **Redis** handles pub/sub between gateway instances, presence, typing state and rate limits.
- **LiveKit** for voice and video in v2. It is an open-source WebRTC media server with React and React Native SDKs, run either on LiveKit Cloud or self-hosted.
- **Expo Notifications** sends push through APNs (Apple) and FCM (Google) from one API.
- **Auth:** Better-Auth (self-hosted, inside our API) or Clerk (managed). Recommended: Better-Auth, so we keep control of user data.

---

## 4. Hosting: where each piece lives

| Piece | Host (recommended) | Why | Rough cost to start |
|---|---|---|---|
| Web app (Next.js) | **Vercel** | Zero-config Next.js, global CDN, preview URL per branch | Free, then $20/mo Pro |
| API and WebSocket gateway | **Fly.io** or **Railway** | Always-on containers with good WebSocket support. Vercel functions can't hold sockets open. | ~$5–25/mo |
| PostgreSQL | **Neon** | Serverless Postgres with database branches for each preview environment | Free, then ~$19/mo |
| Redis | **Upstash** | Serverless Redis that supports pub/sub | Free, then pay-as-you-go |
| File and image storage | **Cloudflare R2** | S3-compatible with **no egress fees**, which matters for a chat app full of images | ~$0.015/GB/mo |
| CDN, DNS, DDoS protection | **Cloudflare** | Free tier, strong presence in the Middle East | Free |
| Voice and video (v2) | **LiveKit Cloud** | Managed SFU with a free tier | Free, then usage-based |
| iOS and Android builds | **Expo EAS** | Cloud builds and store submission | Free tier, then $19/mo |
| App Store | Apple Developer Program | Required to publish on iOS | **$99/year** |
| Google Play | Google Play Console | Required to publish on Android | **$25 one-time** |

**Total to launch the MVP: about $0–50 a month, plus $99 a year for Apple and $25 once for Google.**

### Region and data residency
- Most users will likely be in the Gulf, Egypt and the Levant, so we put the API and database **as close to the Middle East as possible**.
  - Start in **Frankfurt (eu-central)**, which Neon, Fly and Upstash all support. Latency to the Gulf is roughly 80–120 ms, which is fine for chat.
  - If we need in-country data or lower latency later, move the backend to **AWS me-central-1 (UAE)**, **AWS me-south-1 (Bahrain)** or **Google Cloud me-central2 (Dammam, KSA)**.
- If we target Saudi users seriously, review **PDPL** (the Saudi Personal Data Protection Law), since it may require data to be stored in the Kingdom. The UAE PDPL and Egypt's data-protection law are lighter but still apply.
- Everything runs in Docker containers, so moving clouds later is a redeploy, not a rewrite.

---

## 5. Architecture

```
  iOS / Android (Expo)        Web (Next.js on Vercel)
          │   HTTPS (REST) + WSS (realtime)   │
          └──────────────┬────────────────────┘
                         ▼
               Cloudflare (DNS / CDN / WAF)
                         ▼
        API + WebSocket gateway (Fly.io, N instances)
           │            │              │
           ▼            ▼              ▼
     PostgreSQL     Redis pub/sub    Cloudflare R2
       (Neon)       (Upstash)        (attachments, presigned uploads)
                         │
                         ▼
             Push: Expo → APNs / FCM
             Voice/Video (v2): LiveKit
```

**How a message flows:** the client sends it over the WebSocket. The API checks permissions, saves the message in Postgres, publishes it to the Redis channel `channel:{id}`, and every gateway instance pushes it to its connected members. Members who are offline get a push notification.

**Core data model:** `users`, `servers`, `server_members`, `roles`, `member_roles`, `channels` (with `type`: text, voice or category), `messages` (indexed on `channel_id` and `created_at`; IDs are snowflake or ULID so they sort by time), `attachments`, `reactions`, `dm_channels`, `invites`, `push_tokens`.

---

## 6. Roadmap

| Phase | Weeks | Deliverable |
|---|---|---|
| **0. Foundation** | 1 | Monorepo, CI (GitHub Actions), lint and test setup, local docker-compose (Postgres and Redis), RTL design tokens, ar/en i18n |
| **1. Auth and servers** | 2–3 | Sign up and login, profiles, create and join servers, invites, channel list, shown in the web app |
| **2. Real-time chat** | 4–5 | WebSocket gateway, messages, edits, replies, reactions, typing, presence, attachments through R2 |
| **3. Mobile app** | 6–7 | Expo app with the same features, RTL navigation, push notifications, deep links for invites |
| **4. DMs, roles, moderation** | 8 | DMs, roles and permissions, report, kick and ban, rate limits |
| **5. Beta launch** | 9–10 | Deploy to production, TestFlight (iOS) and Play internal testing (Android), Arabic store listings, privacy policy and terms |
| **6. v2** | 11+ | Voice and video (LiveKit), threads, search, custom emoji, bots |

### App store checklist
- [ ] Apple Developer account (individual, or organisation with a D-U-N-S number).
- [ ] Google Play Console account. New personal accounts must run a closed test with 12+ testers for 14 days before going to production.
- [ ] Privacy policy and terms pages, in Arabic and English, hosted on the web app.
- [ ] **User-generated content rules:** both stores require reporting, blocking, a content filter and a way to contact us. All are in the MVP.
- [ ] Account deletion inside the app. Both stores require it.
- [ ] Age rating questionnaire. Chat apps are usually rated 12+ or 17+.

---

## 7. Decisions still open
1. **Brand name** and domain.
2. **Main target country.** This decides the hosting region and whether Saudi PDPL applies.
3. **Voice in the MVP, or v2?** Recommended: v2. Text chat first, then voice.
4. **Auth:** Better-Auth (self-hosted, recommended) or Clerk (managed, faster to set up).
5. **Hosting accounts:** we already have Vercel, Neon and Cloudflare connected. We still need to decide between Fly.io and Railway for the API.
