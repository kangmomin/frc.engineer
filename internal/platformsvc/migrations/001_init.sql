-- 001_init.sql — Foundation (Phase 3A): accounts, sessions, OpenID replay
-- guard, device pairing, rate-limit counters, moderation bans.
--
-- The schema name "platform" is hardcoded (never parameterized) so this raw SQL
-- stays injection-free. All amounts elsewhere are BIGINT; this migration has
-- none. gen_random_uuid() is core Postgres (>=13).

-- Accounts: Steam users plus system accounts (treasury/fee_sink) used by the
-- closed-loop economy in a later migration. System accounts have no steam_id64.
CREATE TABLE platform.accounts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    steam_id64  TEXT UNIQUE,
    persona     TEXT NOT NULL DEFAULT '',
    avatar_url  TEXT NOT NULL DEFAULT '',
    kind        TEXT NOT NULL DEFAULT 'user',
    verified_at TIMESTAMPTZ,           -- first proof-of-play (verified telemetry)
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT accounts_kind_chk CHECK (kind IN ('user', 'treasury', 'fee_sink')),
    -- SteamID64 is exactly 17 digits; system accounts carry NULL.
    CONSTRAINT accounts_steam_id64_chk CHECK (steam_id64 IS NULL OR steam_id64 ~ '^[0-9]{17}$')
);

-- Sessions: web login tokens and upload-scope device tokens. Only sha256(token)
-- is stored so a DB/backup leak is not an account takeover. Expiry is enforced
-- in SQL (expires_at > now()).
CREATE TABLE platform.sessions (
    token_hash  TEXT PRIMARY KEY,      -- sha256 hex of the opaque token
    account_id  UUID NOT NULL REFERENCES platform.accounts(id) ON DELETE CASCADE,
    scope       TEXT NOT NULL DEFAULT 'web',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL,
    CONSTRAINT sessions_scope_chk CHECK (scope IN ('web', 'upload'))
);
CREATE INDEX sessions_account_idx ON platform.sessions (account_id);

-- OpenID response_nonce single-use guard. An INSERT that conflicts means the
-- assertion is being replayed. Old rows are swept by created_at.
CREATE TABLE platform.openid_nonces (
    response_nonce TEXT PRIMARY KEY,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Device pairing: a logged-in web session mints a short-lived code; the local
-- desktop server (cmd/server) exchanges it for an upload-scope session token.
-- Single-use via consumed_at.
CREATE TABLE platform.device_pairings (
    code_hash   TEXT PRIMARY KEY,      -- sha256 hex of the pairing code
    account_id  UUID NOT NULL REFERENCES platform.accounts(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ
);

-- Rate-limit counters, kept in the DB (not in-memory) so limits survive
-- restarts and hold across instances. Used by upload/purchase/review paths.
CREATE TABLE platform.rate_limits (
    key          TEXT NOT NULL,        -- e.g. "<account_id>:upload"
    window_start TIMESTAMPTZ NOT NULL,
    count        INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (key, window_start)
);

-- Moderation: a row here bans the account from session creation, upload, and
-- marketplace actions. Single active ban per account (re-ban = upsert).
CREATE TABLE platform.account_bans (
    account_id UUID PRIMARY KEY REFERENCES platform.accounts(id) ON DELETE CASCADE,
    reason     TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
