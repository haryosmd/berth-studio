-- Sample data for the throwaway dev database (scripts/dev-db/start.sh).
-- These are local test credentials for a database that only listens on 127.0.0.1.
--   app     write user, owns the acme database      password: berth-dev-app
--   app_ro  read-only user, stands in for a replica password: berth-dev-ro
CREATE ROLE app LOGIN PASSWORD 'berth-dev-app';
CREATE ROLE app_ro LOGIN PASSWORD 'berth-dev-ro';
ALTER ROLE app_ro SET default_transaction_read_only = on;
CREATE DATABASE acme OWNER app;

\connect acme
SET ROLE app;

CREATE TABLE orgs (
  id         serial PRIMARY KEY,
  name       text NOT NULL,
  plan       text NOT NULL DEFAULT 'starter',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id          serial PRIMARY KEY,
  email       text NOT NULL UNIQUE,
  full_name   text NOT NULL,
  org_id      int REFERENCES orgs (id),
  plan        text NOT NULL,
  is_verified boolean NOT NULL DEFAULT false,
  metadata    jsonb,
  last_login  timestamptz
);

CREATE TABLE orders (
  id          bigserial PRIMARY KEY,
  user_id     int NOT NULL REFERENCES users (id),
  status      text NOT NULL,
  total_cents int NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO orgs (name, plan)
SELECT 'Org ' || g, (ARRAY['starter', 'pro', 'team'])[1 + g % 3] FROM generate_series(1, 20) g;

INSERT INTO users (email, full_name, org_id, plan, is_verified, metadata, last_login)
SELECT 'user' || g || '@acme.dev', 'User ' || g, 1 + g % 20, (ARRAY['starter', 'pro', 'team'])[1 + g % 3], g % 4 <> 0,
       CASE WHEN g % 5 = 0 THEN NULL ELSE jsonb_build_object('source', (ARRAY['signup', 'invite', 'import'])[1 + g % 3]) END,
       CASE WHEN g % 7 = 0 THEN NULL ELSE now() - (g || ' hours')::interval END
FROM generate_series(1, 1300) g;

INSERT INTO orders (user_id, status, total_cents, created_at)
SELECT 1 + g % 1300, (ARRAY['paid', 'pending', 'refunded'])[1 + g % 3], 500 + (g * 37) % 20000, now() - (g || ' minutes')::interval
FROM generate_series(1, 8000) g;

ANALYZE orgs, users, orders;
RESET ROLE;

GRANT CONNECT ON DATABASE acme TO app_ro;
GRANT USAGE ON SCHEMA public TO app_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_ro;
