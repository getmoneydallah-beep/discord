# مجلس · Majlis

An Arabic-first community chat app (servers, channels, real-time messages) for **web, iOS and Android**, all from one TypeScript monorepo.

```
apps/
  api/      Fastify REST API + WebSocket gateway  → Fly.io
  web/      Next.js web app (RTL-first)           → Vercel
  mobile/   Expo / React Native (iOS + Android)   → EAS → App Store / Google Play
packages/
  shared/      types, zod schemas, permissions, Arabic text utils, design tokens
  i18n/        Arabic + English strings, date/number formatting
  api-client/  typed REST client, auto-reconnecting gateway, shared zustand store
```

The web and mobile apps share the same API client and the same state store (`@majlis/api-client/store`). Messages, presence, typing and reactions behave the same on every platform.

## What works today
- Email and password sign-up and login. Tokens are JWTs, kept in localStorage on web and the Keychain or Keystore on mobile.
- Servers: create, rename, delete, leave. Every new server gets a default channel called `عام` ("general").
- Text channels. Names can be in any script, Arabic included.
- Invites: links with an expiry and a use limit. `https://<web>/invite/CODE` works on web and is set up as a deep link on mobile.
- Real-time messaging over WebSockets: send, edit, delete, reply, emoji reactions, typing indicators and online presence. Sent messages appear instantly and are reconciled with the server copy.
- Message history loads older pages as you scroll up.
- **Arabic-aware search**: alef forms (أ إ آ ا), ة/ه, ى/ي, diacritics (tashkeel) and the stretch character (tatweel) are normalised before indexing, so "اصدقاء" finds "أصدقاء".
- Roles (owner, admin, member), kick, ban, and making or removing admins.
- Reporting messages, and deleting your own account. Both app stores require these.
- RTL by default with an English toggle. Each message chooses its own text direction. Optional Eastern Arabic digits (١٢٣). Dates use the Gregorian calendar, with Hijri formatting available.
- Rate limits on sign-in and on sending messages.
- **Files in chat:** attach images, videos and any other file. You can use the + button, drag and drop, or paste a screenshot, and each file shows upload progress. Images and videos play inline, other files show as download cards, and YouTube or Vimeo links become embedded players.
- **Courses:** a channel type for teaching. Admins can create any number of courses per server. A course has a cover, a description and sections, and each section has lessons. A lesson has a video (uploaded to R2, or a YouTube/Vimeo link), notes, and downloadable files.
  - **For learners:** a single "Start / Continue" button, a checklist with ✓ for finished lessons, and a progress bar. Videos resume where you stopped and complete the lesson automatically when they end. Every lesson ends with one big "I finished this lesson, next" button.
  - **For admins:** an inline editor with up/down ordering (lessons can move between sections). Changes save immediately.
  - On mobile, learners can do everything. Adding and editing lessons is web-only for now.

**Not built yet:** push notifications, DMs, phone OTP login, voice, adaptive video streaming (HLS). See `PLAN.md`.

## Local development

Requirements: Node 22+, pnpm 10, and Docker (or a local Postgres).

```bash
pnpm install
```

```bash
docker compose up -d          # Postgres 16 + Redis
```

```bash
cp apps/api/.env.example apps/api/.env
```

```bash
pnpm db:migrate
```

```bash
pnpm dev                      # API on :4000, web on :3000
```

Mobile (in another terminal):

```bash
pnpm dev:mobile               # Expo dev server; press i (iOS sim) / a (Android) or scan with Expo Go
```

On a physical phone, set `EXPO_PUBLIC_API_URL=http://<your-LAN-ip>:4000` before starting Expo.

### Tests

```bash
pnpm typecheck
```

```bash
pnpm test                     # unit tests + API integration tests against Postgres (majlis_test DB)
```

The API tests start the real server and drive the REST API and the WebSocket gateway end to end. Set `TEST_REDIS_URL` to run them through Redis pub/sub instead of the in-process bus.

## Deployment

| Piece | Where | How |
|---|---|---|
| API + gateway | Fly.io `fra` | `fly deploy --config apps/api/fly.toml` from the repo root. Migrations run as the release command. |
| Postgres | Neon `aws-eu-central-1` (Frankfurt) | Set `DATABASE_URL` with `fly secrets set` |
| Redis | Upstash `eu-central-1` | Set `REDIS_URL` with `fly secrets set`. Required once you run more than one machine. |
| Files and videos | Cloudflare R2 bucket `majlis-media` | Set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and `R2_BUCKET` with `fly secrets set`. Apply the CORS policy in `infra/r2-cors.json`. |
| Web | Vercel | Root directory `apps/web`, env `NEXT_PUBLIC_API_URL=https://api.majlis.app` |
| iOS / Android | Expo EAS | `cd apps/mobile && eas build --profile production` then `eas submit` |

**Live now:** web <https://majlis-web.fly.dev>, API <https://majlis-sa-api.fly.dev> (Fly.io `fra`). Until R2 is configured, the API stores uploads on a 3 GB Fly volume (`majlis_data`), so it runs as a single machine (`--ha=false`).

Redeploy after changes (from the repo root):

```bash
fly deploy --config apps/api/fly.toml --ha=false
```

```bash
fly deploy --config apps/web/fly.toml
```

If deploys hang at "Waiting for remote builder" behind a corporate/agent proxy, add `--depot=false` and run `fly wireguard websockets enable` once.

First API deploy (fresh account):

```bash
fly apps create majlis-api
```

```bash
fly secrets set --app majlis-api DATABASE_URL=... REDIS_URL=... JWT_SECRET=$(openssl rand -hex 32)
```

```bash
fly deploy --config apps/api/fly.toml
```

### Cloudflare R2 setup (files and course videos)

1. In the Cloudflare dashboard, go to **R2** → **Create bucket**, name it `majlis-media` and choose location hint **Eastern Europe** or **Automatic**. Keep it **private**. The API hands out signed URLs that expire, so only members can open files.
2. Go to **R2** → **Manage API tokens** → **Create token** with *Object Read & Write* permission on that bucket. Copy the Access Key ID, the Secret Access Key, and your Account ID.
3. Open the bucket → **Settings** → **CORS policy**, and paste in `infra/r2-cors.json` with your real domains. This lets browsers upload straight to R2.
4. Store the credentials as Fly secrets:

```bash
fly secrets set --app majlis-api R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... R2_BUCKET=majlis-media
```

How it works: the app asks the API for a signed upload URL, sends the file **directly to R2** (the bytes never pass through Fly), then tells the API it's done. The API checks the file's real size. Every hour, files that nothing references any more (deleted messages, lessons or servers, abandoned uploads) are deleted from R2. Without `R2_*` set, development stores files on local disk in `apps/api/.uploads` using the same flow.

Limits: chat attachments up to 100 MB; course videos up to 4 GB (R2's single upload limit is 5 GB); lesson files up to 200 MB. R2 charges nothing for downloads, so video views don't cost bandwidth.

> **Saudi hosting note:** Fly.io has no region inside Saudi Arabia. Frankfurt is the closest well-connected option, about 80–120 ms from Riyadh and Jeddah. Read PLAN.md §4 before launch: the Saudi data-protection law (PDPL) may require keeping personal data in the Kingdom.
