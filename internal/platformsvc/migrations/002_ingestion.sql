-- 002_ingestion.sql — Phase 3B: central telemetry ingestion + leaderboards.
--
-- Trust model: every uploaded byte is attacker-controlled. Columns marked
-- "server-derived" (best_lap_ms) or "server-validated" (laps.valid) are computed
-- by the ingest service, never trusted from the client.
--
-- NO-FAUCET INVARIANT (do not break in 3D1): a plausible race, and stamping
-- accounts.verified_at, mint NO credits and MUST NOT gate or trigger any ledger
-- write. `plausible` is a proof-of-play / anti-noise signal, NOT economic trust.

-- Central race records. `plausible` (not "verified") is deliberately named: it
-- means the race passed the anti-noise gate, not that it is trusted. A race is
-- plausible once at least one lap passes the gate. UNIQUE(account_id,
-- source_race_id) makes re-upload idempotent.
CREATE TABLE platform.races (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id    UUID NOT NULL REFERENCES platform.accounts(id) ON DELETE CASCADE,
    source_race_id TEXT NOT NULL,
    track_id      INTEGER NOT NULL,
    track_name    TEXT NOT NULL DEFAULT '',
    session_type  TEXT NOT NULL DEFAULT '',
    game_format   TEXT NOT NULL DEFAULT '',
    best_lap_ms   INTEGER,                     -- server-derived min valid lap; NULL if none
    plausible     BOOLEAN NOT NULL DEFAULT false,
    uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (account_id, source_race_id),
    CONSTRAINT races_source_len_chk CHECK (char_length(source_race_id) BETWEEN 1 AND 128),
    CONSTRAINT races_format_len_chk CHECK (char_length(game_format) <= 32),
    CONSTRAINT races_type_len_chk   CHECK (char_length(session_type) <= 48),
    CONSTRAINT races_track_len_chk  CHECK (char_length(track_name) <= 64)
);
-- Leaderboards filter by track+format over plausible races.
CREATE INDEX races_leaderboard_idx ON platform.races (track_id, game_format) WHERE plausible;

-- Uploaded car setup, stored privately. NEVER exposed on a public endpoint: the
-- marketplace (3C) derives immutable snapshots server-side; the raw upload is
-- visible only to its owner. content_hash inherits the same never-public rule:
-- the 23-field setup space is low-entropy and offline-enumerable, so exposing
-- the hash (or any public bit confirming hash equality) would leak the exact
-- setup the marketplace sells. It is a server-side similarity/integrity key
-- only — never a dedup key and never publicly observable (see 003_market.sql).
CREATE TABLE platform.race_setup (
    race_id          UUID PRIMARY KEY REFERENCES platform.races(id) ON DELETE CASCADE,
    params_canonical BYTEA NOT NULL,
    content_hash     TEXT NOT NULL
);

-- Per-lap timing. valid is server-validated (advisory): client valid AND within
-- plausibility bounds AND sector sum ≈ lap. UNIQUE(race_id, lap_number) rejects
-- duplicate laps in one upload.
CREATE TABLE platform.laps (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    race_id     UUID NOT NULL REFERENCES platform.races(id) ON DELETE CASCADE,
    lap_number  INTEGER NOT NULL,
    lap_ms      INTEGER NOT NULL,
    s1_ms       INTEGER NOT NULL DEFAULT 0,
    s2_ms       INTEGER NOT NULL DEFAULT 0,
    s3_ms       INTEGER NOT NULL DEFAULT 0,
    tyre        TEXT NOT NULL DEFAULT '',
    valid       BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (race_id, lap_number)
);
-- Best-lap-per-account (TT) and pace aggregates scan valid laps of a race.
CREATE INDEX laps_valid_idx ON platform.laps (race_id, lap_ms) WHERE valid;

-- Optional per-track plausibility bounds (ms). A missing row falls back to
-- generic physical bounds in the ingest service. Values are intentionally wide
-- and safe (mins comfortably below any real fastest lap) — anti-noise, not
-- anti-cheat; banning (account_bans) is the real anti-poisoning lever. Full
-- population of all track ids is an ops task; a confident subset is seeded here.
CREATE TABLE platform.track_bounds (
    track_id    INTEGER PRIMARY KEY,
    min_lap_ms  INTEGER NOT NULL,
    max_lap_ms  INTEGER NOT NULL
);
INSERT INTO platform.track_bounds (track_id, min_lap_ms, max_lap_ms) VALUES
    (3,  75000, 600000),   -- Bahrain
    (5,  60000, 600000),   -- Monaco
    (7,  72000, 600000),   -- Silverstone (United Kingdom)
    (9,  90000, 600000),   -- Spa (Belgium)
    (10, 68000, 600000),   -- Monza (Italy)
    (12, 76000, 600000);   -- Suzuka (Japan)
