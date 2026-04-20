-- ═══════════════════════════════════════════════════════
-- MyEvent.io — PostgreSQL Schema
-- Run: psql -d myeventio -f schema.sql
-- ═══════════════════════════════════════════════════════

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── USERS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name         VARCHAR(150)  NOT NULL,
  email        VARCHAR(255)  NOT NULL UNIQUE,
  password_hash TEXT         NOT NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ── EVENTS ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS events (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title           TEXT         NOT NULL,
  date            DATE,
  location        TEXT,
  event_type      VARCHAR(50)  CHECK (event_type IN ('In-Person','Online/Virtual','Unknown')),
  cost            VARCHAR(50)  CHECK (cost IN ('Free','Paid','Unknown')),
  source_url      TEXT         NOT NULL,
  source_name     TEXT,
  scraped_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  matched_criteria BOOLEAN     NOT NULL DEFAULT FALSE,
  notified        BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_user_id   ON events(user_id);
CREATE INDEX IF NOT EXISTS idx_events_date       ON events(date);
CREATE INDEX IF NOT EXISTS idx_events_matched    ON events(user_id, matched_criteria);
CREATE INDEX IF NOT EXISTS idx_events_source_url ON events(user_id, source_url);

-- Unique constraint: same event from same source on same day per user
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_dedup
  ON events(user_id, title, COALESCE(date, '1970-01-01'::date), source_url);

-- ── URL_ANOMALIES ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS url_anomalies (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  original_url  TEXT         NOT NULL,
  corrected_url TEXT         NOT NULL,
  timestamp     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  site_name     VARCHAR(255),
  status        VARCHAR(50)  NOT NULL DEFAULT 'detected'
                             CHECK (status IN ('detected','dismissed','redirected','synced')),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_anomalies_user_id  ON url_anomalies(user_id);
CREATE INDEX IF NOT EXISTS idx_anomalies_timestamp ON url_anomalies(user_id, timestamp DESC);

-- ── URL_ACTIVITY (Interest Profiling) ────────────────
CREATE TABLE IF NOT EXISTS url_activity (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url         TEXT         NOT NULL,
  title       TEXT,
  domain      VARCHAR(255),
  score       INTEGER      NOT NULL DEFAULT 0 CHECK (score >= 0 AND score <= 100),
  visited_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_user_id  ON url_activity(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_domain   ON url_activity(user_id, domain);
CREATE INDEX IF NOT EXISTS idx_activity_visited  ON url_activity(user_id, visited_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_score    ON url_activity(user_id, score DESC);

-- ── REFRESH_TOKENS ────────────────────────────────────
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT        NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Trigger: auto-update updated_at on users ──────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_updated_at ON users;
CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
