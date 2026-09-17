-- Wreckveil database schema. Idempotent (safe to re-run against an already-migrated DB).

CREATE TABLE IF NOT EXISTS users (
  id             SERIAL PRIMARY KEY,
  username       VARCHAR(20) UNIQUE NOT NULL,
  password_salt  VARCHAR(32) NOT NULL,
  password_hash  VARCHAR(128) NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS player_stats (
  user_id         INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  kills           INTEGER NOT NULL DEFAULT 0,
  deaths          INTEGER NOT NULL DEFAULT 0,
  matches_played  INTEGER NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS player_customization (
  user_id          INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  primary_color    VARCHAR(7) NOT NULL DEFAULT '#3d7dca',
  secondary_color  VARCHAR(7) NOT NULL DEFAULT '#c79b73',
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
