-- Ordinary PostgreSQL, kept outside Supabase's exposed Data API schemas.
CREATE SCHEMA IF NOT EXISTS credit_cards;
REVOKE ALL ON SCHEMA credit_cards FROM PUBLIC;
CREATE TABLE credit_cards.accounts (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  balance integer NOT NULL DEFAULT 0 CHECK (balance BETWEEN 0 AND 1000000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE credit_cards.credit_operations (
  account_id uuid NOT NULL REFERENCES credit_cards.accounts(id),
  request_id uuid NOT NULL,
  delta smallint NOT NULL CHECK (delta IN (-1, 1)),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, request_id)
);
CREATE TABLE credit_cards.staff_sessions (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL
);
CREATE INDEX staff_sessions_expiry ON credit_cards.staff_sessions(expires_at);
CREATE TABLE credit_cards.login_attempts (
  window_start timestamptz PRIMARY KEY,
  attempts integer NOT NULL CHECK (attempts > 0)
);
REVOKE ALL ON ALL TABLES IN SCHEMA credit_cards FROM PUBLIC;
ALTER TABLE credit_cards.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_cards.credit_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_cards.staff_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_cards.login_attempts ENABLE ROW LEVEL SECURITY;
