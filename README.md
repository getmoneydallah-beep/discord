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

**Not built yet:** attachments (R2), push notifications, DMs, phone OTP login, voice. See `PLAN.md`.

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
| Web | Vercel | Root directory `apps/web`, env `NEXT_PUBLIC_API_URL=https://api.majlis.app` |
| iOS / Android | Expo EAS | `cd apps/mobile && eas build --profile production` then `eas submit` |

First API deploy:

```bash
fly apps create majlis-api
```

```bash
fly secrets set --app majlis-api DATABASE_URL=... REDIS_URL=... JWT_SECRET=$(openssl rand -hex 32)
```

```bash
fly deploy --config apps/api/fly.toml
```

> **Saudi hosting note:** Fly.io has no region inside Saudi Arabia. Frankfurt is the closest well-connected option, about 80–120 ms from Riyadh and Jeddah. Read PLAN.md §4 before launch: the Saudi data-protection law (PDPL) may require keeping personal data in the Kingdom.
