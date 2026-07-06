-- 003_market.sql — Phase 3C: setup/strategy marketplace.
--
-- The marketplace sells setup params / strategy stints. Those payloads are the
-- product: masked until purchase (3D1). content_hash and params_canonical are
-- server-side only and MUST NEVER influence any publicly observable output — no
-- response field, no "duplicate" badge, no similar-by-hash, no count, ordering,
-- or error-path difference. The 23-field setup space is offline-enumerable, so
-- any public bit that confirms hash equality is an oracle for a target's exact
-- setup. This is why content_hash is deliberately NOT unique: a UNIQUE
-- constraint made POST /listings itself such an oracle (insert-conflict = "this
-- setup is already listed"). It is a per-seller similarity/integrity key only.

-- Immutable snapshots, derived server-side from the seller's own race (never
-- from client input). Same content can come from two sellers → two snapshots
-- with distinct provenance.
CREATE TABLE platform.snapshots (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind          TEXT NOT NULL,
    content_hash  TEXT NOT NULL,
    params_canonical BYTEA NOT NULL,
    payload       JSONB NOT NULL,   -- setup params or strategy stints; revealed only to owner/purchaser
    race_id       UUID REFERENCES platform.races(id) ON DELETE SET NULL,       -- provenance
    seller_id     UUID REFERENCES platform.accounts(id) ON DELETE SET NULL,    -- survives account deletion for purchasers
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT snapshots_kind_chk CHECK (kind IN ('setup', 'strategy')),
    UNIQUE (id, kind)              -- enables the composite FK from listings
);
CREATE INDEX snapshots_hash_idx ON platform.snapshots (content_hash);

-- Enforce content immutability (payload/hash/params/kind can never change) and
-- forbid deletion, so a 3D1 purchase referencing a snapshot can never be
-- silently altered or removed. FK SET NULL on race_id/seller_id is still allowed
-- because it does not touch the content columns.
CREATE FUNCTION platform.snapshots_immutable() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'platform.snapshots rows are immutable (no delete)';
    END IF;
    IF NEW.kind <> OLD.kind
       OR NEW.content_hash <> OLD.content_hash
       OR NEW.params_canonical IS DISTINCT FROM OLD.params_canonical
       OR NEW.payload IS DISTINCT FROM OLD.payload THEN
        RAISE EXCEPTION 'platform.snapshots content is immutable';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER snapshots_immutable_trg
    BEFORE UPDATE OR DELETE ON platform.snapshots
    FOR EACH ROW EXECUTE FUNCTION platform.snapshots_immutable();

-- Sale listings. price is virtual credits (BIGINT, 1..cap; 0 is rejected — a
-- free listing would be a free product unlock). One active listing per
-- (seller, source race, kind). The composite FK guarantees a listing's kind
-- matches its snapshot's kind, so the unlock path can never serve the wrong
-- payload type.
CREATE TABLE platform.listings (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_id     UUID NOT NULL REFERENCES platform.accounts(id) ON DELETE CASCADE,
    kind          TEXT NOT NULL,
    snapshot_id   UUID NOT NULL,
    race_id       UUID REFERENCES platform.races(id) ON DELETE SET NULL,
    track_id      INTEGER NOT NULL,
    game_format   TEXT NOT NULL DEFAULT '',
    title         TEXT NOT NULL DEFAULT '',
    price_credits BIGINT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'active',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT listings_kind_chk   CHECK (kind IN ('setup', 'strategy')),
    CONSTRAINT listings_status_chk CHECK (status IN ('active', 'delisted')),
    CONSTRAINT listings_price_chk  CHECK (price_credits BETWEEN 1 AND 1000000),
    CONSTRAINT listings_title_len_chk  CHECK (char_length(title) <= 80),
    CONSTRAINT listings_format_len_chk CHECK (char_length(game_format) <= 32),
    FOREIGN KEY (snapshot_id, kind) REFERENCES platform.snapshots (id, kind)
);
-- Browse: active listings by kind+track+format, newest first.
CREATE INDEX listings_browse_idx ON platform.listings (kind, track_id, game_format, created_at DESC) WHERE status = 'active';
CREATE INDEX listings_seller_idx ON platform.listings (seller_id);
-- One active listing per (seller, source race, kind); delist-then-relist works.
CREATE UNIQUE INDEX listings_active_unique_idx ON platform.listings (seller_id, race_id, kind) WHERE status = 'active';
