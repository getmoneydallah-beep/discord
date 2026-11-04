-- Monetization: teacher subscriptions (Whop), paid offers, entitlements,
-- the append-only earnings ledger and owner-sent payouts.
-- Money is stored in minor units (halalas / cents) as bigint.

-- Free/paid per channel (a course is a channel), free preview per lesson.
ALTER TABLE channels ADD COLUMN access text NOT NULL DEFAULT 'free' CHECK (access IN ('free', 'paid'));
ALTER TABLE lessons ADD COLUMN free_preview boolean NOT NULL DEFAULT false;

-- Whop objects Majlis creates once and reuses (teacher product and plans).
CREATE TABLE whop_catalog (
  key        text PRIMARY KEY,           -- e.g. 'teacher:product', 'teacher:pro:monthly'
  whop_id    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE teacher_subscriptions (
  user_id              text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tier                 text NOT NULL CHECK (tier IN ('starter', 'pro', 'academy')),
  interval             text CHECK (interval IN ('monthly', 'yearly')),
  status               text NOT NULL CHECK (status IN ('trialing', 'active', 'past_due', 'canceled', 'expired')),
  whop_membership_id   text UNIQUE,
  whop_plan_id         text,
  manage_url           text,
  trial_ends_at        timestamptz,
  current_period_end   timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- Every Whop checkout configuration we create, so webhooks can be tied back to
-- a user even if Whop drops our metadata.
CREATE TABLE checkout_sessions (
  id           text PRIMARY KEY,         -- Whop checkout configuration id (ch_...)
  kind         text NOT NULL CHECK (kind IN ('teacher_subscription', 'offer')),
  user_id      text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  offer_id     text,
  tier         text,
  interval     text,
  whop_plan_id text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX checkout_sessions_user_idx ON checkout_sessions (user_id, created_at DESC);

CREATE TABLE offers (
  id              text PRIMARY KEY,
  server_id       text NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name            text NOT NULL,
  description     text NOT NULL DEFAULT '',
  price_minor     bigint NOT NULL CHECK (price_minor > 0),
  currency        text NOT NULL DEFAULT 'sar',
  billing         text NOT NULL CHECK (billing IN ('one_time', 'monthly', 'yearly')),
  trial_days      integer,
  seat_limit      integer,
  active          boolean NOT NULL DEFAULT true,
  position        integer NOT NULL DEFAULT 0,
  whop_product_id text,
  whop_plan_id    text UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX offers_server_idx ON offers (server_id, position);

-- Old Whop plans of an offer (a price change creates a new plan; existing
-- subscribers keep the old one and renewals must still map to the offer).
CREATE TABLE offer_plans (
  whop_plan_id text PRIMARY KEY,
  offer_id     text NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE offer_grants (
  offer_id    text NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  target_type text NOT NULL CHECK (target_type IN ('server', 'channel')),
  target_id   text NOT NULL,
  PRIMARY KEY (offer_id, target_type, target_id)
);

CREATE TABLE entitlements (
  id                 text PRIMARY KEY,
  user_id            text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  offer_id           text NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  server_id          text NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  source             text NOT NULL CHECK (source IN ('whop', 'manual')),
  status             text NOT NULL CHECK (status IN ('active', 'trialing', 'past_due', 'canceled', 'expired', 'revoked')),
  whop_membership_id text UNIQUE,
  granted_by         text REFERENCES users(id) ON DELETE SET NULL,
  starts_at          timestamptz NOT NULL DEFAULT now(),
  ends_at            timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, offer_id)
);
CREATE INDEX entitlements_user_server_idx ON entitlements (user_id, server_id);
CREATE INDEX entitlements_offer_idx ON entitlements (offer_id);

-- One row per Whop payment we've seen.
CREATE TABLE payments (
  id                 text PRIMARY KEY,   -- Whop payment id (pay_...)
  kind               text NOT NULL CHECK (kind IN ('teacher_subscription', 'offer')),
  user_id            text REFERENCES users(id) ON DELETE SET NULL,
  offer_id           text REFERENCES offers(id) ON DELETE SET NULL,
  server_id          text REFERENCES servers(id) ON DELETE SET NULL,
  teacher_user_id    text REFERENCES users(id) ON DELETE SET NULL,
  whop_membership_id text,
  currency           text NOT NULL,
  total_minor        bigint NOT NULL,
  whop_fee_minor     bigint NOT NULL DEFAULT 0,
  platform_fee_minor bigint NOT NULL DEFAULT 0,
  refunded_minor     bigint NOT NULL DEFAULT 0,
  status             text NOT NULL,
  raw                jsonb NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payments_teacher_idx ON payments (teacher_user_id, created_at DESC);

-- Prevents processing a webhook delivery twice (Whop delivers at least once).
CREATE TABLE webhook_events (
  id           text PRIMARY KEY,         -- webhook-id header
  provider     text NOT NULL DEFAULT 'whop',
  type         text NOT NULL,
  received_at  timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  error        text
);

-- Append-only. Every balance is derived from these rows.
CREATE TABLE ledger_entries (
  id              text PRIMARY KEY,
  teacher_user_id text REFERENCES users(id) ON DELETE SET NULL,  -- kept for accounting if the account is deleted
  server_id       text REFERENCES servers(id) ON DELETE SET NULL,
  type            text NOT NULL CHECK (type IN ('sale', 'whop_fee', 'platform_fee', 'refund', 'chargeback', 'payout', 'adjustment')),
  amount_minor    bigint NOT NULL,
  currency        text NOT NULL,
  payment_id      text,
  payout_id       text,
  -- Idempotency key, e.g. 'sale:pay_123', 'refund:rfnd_9'. A webhook replay can't double-book.
  ref             text NOT NULL UNIQUE,
  note            text,
  available_at    timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ledger_teacher_idx ON ledger_entries (teacher_user_id, currency, available_at);

CREATE TABLE payout_accounts (
  teacher_user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  whop_username   text,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payouts (
  id              text PRIMARY KEY,
  teacher_user_id text REFERENCES users(id) ON DELETE SET NULL,  -- kept for accounting if the account is deleted
  amount_minor    bigint NOT NULL CHECK (amount_minor > 0),
  currency        text NOT NULL,
  status          text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed')),
  whop_reference  text,
  note            text,
  sent_by         text REFERENCES users(id) ON DELETE SET NULL,
  sent_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payouts_teacher_idx ON payouts (teacher_user_id, sent_at DESC);
