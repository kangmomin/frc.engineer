-- 005_race_detail.sql — rich, versioned per-race detail (stints, per-lap timing,
-- dynamics, event/issue timeline) uploaded alongside the lap summary.
--
-- Trust model unchanged: this payload is client-supplied and never feeds the
-- leaderboards or any server-derived value. It is a private, display-oriented
-- document — the ingest service caps its size and re-marshals it, but does not
-- trust its contents. race_detail is NEVER joined by the leaderboard queries.
--
-- Versioning: schema_version is a single document version (mirrors the local
-- summary's schemaVersion). Readers dispatch on it; unknown-future versions must
-- render only the fields they know. The payload is opaque JSONB so its internal
-- structure can evolve without a migration — only a structural break bumps the
-- version. Follows the established sibling-table (race_setup) + JSONB
-- (snapshots.payload, reviews.perf) conventions.

CREATE TABLE platform.race_detail (
    race_id        UUID PRIMARY KEY REFERENCES platform.races(id) ON DELETE CASCADE,
    schema_version SMALLINT NOT NULL,
    payload        JSONB NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT race_detail_version_chk CHECK (schema_version BETWEEN 1 AND 32767)
);
