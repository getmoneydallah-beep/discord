-- Students now pay teachers' own Whop accounts. Majlis only earns from teacher
-- plans, so the earnings ledger and payouts are gone. No real sales were made
-- under the old model.

DROP TABLE payouts;
DROP TABLE payout_accounts;
DROP TABLE ledger_entries;
ALTER TABLE payments DROP COLUMN platform_fee_minor;

-- One Whop account per teacher, connected with a pasted API key.
CREATE TABLE whop_connections (
  id                 text PRIMARY KEY,
  teacher_user_id    text NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  whop_account_id    text NOT NULL,
  account_title      text NOT NULL,
  api_key_enc        text,                -- AES-256-GCM (crypto.ts); NULL once disconnected
  api_key_last4      text,
  webhook_id         text,
  webhook_secret_enc text,
  status             text NOT NULL CHECK (status IN ('active', 'broken', 'disconnected')),
  last_error         text,
  last_checked_at    timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
-- A Whop account can sell for one Majlis teacher at a time.
CREATE UNIQUE INDEX whop_connections_account_idx ON whop_connections (whop_account_id) WHERE status <> 'disconnected';

-- Which connection an offer's Whop product/plan, a checkout and a payment belong to.
ALTER TABLE offers ADD COLUMN connection_id text REFERENCES whop_connections(id) ON DELETE SET NULL;
ALTER TABLE checkout_sessions ADD COLUMN connection_id text REFERENCES whop_connections(id) ON DELETE SET NULL;
ALTER TABLE payments ADD COLUMN connection_id text REFERENCES whop_connections(id) ON DELETE SET NULL;
ALTER TABLE offer_plans ADD COLUMN connection_id text REFERENCES whop_connections(id) ON DELETE CASCADE;
