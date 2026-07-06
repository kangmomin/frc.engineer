-- 004_economy.sql — Phase 3D1: closed-loop virtual credit economy + reviews.
--
-- ZERO-SUM BY CONSTRUCTION (do not add a faucet): every ledger transaction's
-- amounts sum to 0, so the grand total across all accounts (users + system) is
-- always 0. Credits enter a user wallet ONLY from the treasury (one-time signup
-- grant) and move ONLY between wallets on purchase (buyer → seller + fee_sink).
-- A race/telemetry upload mints NOTHING (see NO-FAUCET INVARIANT, 002). Credits
-- have no cash value.
--
-- System accounts (treasury, fee_sink) are the counterparties that make each
-- transaction balance. They deliberately have NO wallet row: their balance is
-- implicit in the ledger (treasury trends negative as it grants; fee_sink trends
-- positive as it collects fees/sinks). Only USER wallets are materialized and
-- constrained (balance >= 0), so the treasury issuing credits never trips the
-- non-negative backstop.

-- Exactly one treasury and one fee_sink (system singletons; steam_id64 NULL).
CREATE UNIQUE INDEX accounts_system_singleton_idx ON platform.accounts (kind) WHERE kind <> 'user';
INSERT INTO platform.accounts (kind, persona) VALUES ('treasury', 'Treasury'), ('fee_sink', 'Fee Sink');

-- Materialized USER balances (a cache derivable from the ledger). balance >= 0 is
-- the atomic double-spend backstop, updated in the same tx as the debit.
CREATE TABLE platform.wallets (
    account_id UUID PRIMARY KEY REFERENCES platform.accounts(id) ON DELETE CASCADE,
    balance    BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT wallets_balance_chk CHECK (balance >= 0)
);

-- Append-only double-entry ledger. A transaction_id groups a balanced set of
-- entries (per-txn SUM(amount)=0). Rows are immutable and undeletable so history
-- and the zero-sum invariant can never be silently rewritten.
CREATE TABLE platform.ledger_entries (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    transaction_id UUID NOT NULL,
    account_id     UUID NOT NULL REFERENCES platform.accounts(id),
    kind           TEXT NOT NULL,        -- grant | purchase | sale | fee | sink_unlock
    amount         BIGINT NOT NULL,      -- signed: +credit, -debit
    ref            TEXT NOT NULL DEFAULT '', -- purchase_id / listing_id / ''
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ledger_kind_chk CHECK (kind IN ('grant', 'purchase', 'sale', 'fee', 'sink_unlock'))
);
CREATE INDEX ledger_account_idx ON platform.ledger_entries (account_id, id DESC);
CREATE INDEX ledger_txn_idx ON platform.ledger_entries (transaction_id);

-- Immutability: the ledger is the source of truth for the zero-sum invariant, so
-- no row may ever be changed or removed.
CREATE FUNCTION platform.ledger_append_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'platform.ledger_entries is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER ledger_append_only_trg
    BEFORE UPDATE OR DELETE ON platform.ledger_entries
    FOR EACH ROW EXECUTE FUNCTION platform.ledger_append_only();

-- Purchases: immediate 3-way settlement (no escrow, no self-serve refund).
-- snapshot_id is frozen at purchase time so a later delist/relist can never
-- change what the buyer owns. seller_id is denormalized so buyer<>seller is a
-- CHECK, and the composite FK to snapshots(id,kind) blocks payload-type
-- confusion. One live purchase per (buyer, listing) — a refund frees a re-buy.
CREATE TABLE platform.purchases (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    buyer_id    UUID NOT NULL REFERENCES platform.accounts(id),
    seller_id   UUID NOT NULL REFERENCES platform.accounts(id),
    listing_id  UUID NOT NULL REFERENCES platform.listings(id),
    snapshot_id UUID NOT NULL,
    kind        TEXT NOT NULL,
    price       BIGINT NOT NULL,
    fee         BIGINT NOT NULL,
    state       TEXT NOT NULL DEFAULT 'settled',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT purchases_kind_chk  CHECK (kind IN ('setup', 'strategy')),
    CONSTRAINT purchases_state_chk CHECK (state IN ('settled', 'refunded')),
    CONSTRAINT purchases_self_chk  CHECK (buyer_id <> seller_id),
    CONSTRAINT purchases_price_chk CHECK (price >= 1 AND fee >= 0 AND fee < price),
    FOREIGN KEY (snapshot_id, kind) REFERENCES platform.snapshots (id, kind)
);
CREATE UNIQUE INDEX purchases_active_unique_idx ON platform.purchases (buyer_id, listing_id) WHERE state <> 'refunded';
CREATE INDEX purchases_listing_idx ON platform.purchases (listing_id);

-- Reviews: gated to settled buyers (enforced in the service), one per (listing,
-- author). perf is a fixed 5-axis 0..100 vector, server-validated; body capped.
CREATE TABLE platform.reviews (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id UUID NOT NULL REFERENCES platform.listings(id),
    author_id  UUID NOT NULL REFERENCES platform.accounts(id),
    stars      SMALLINT NOT NULL,
    perf       JSONB NOT NULL,
    body       TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT reviews_stars_chk CHECK (stars BETWEEN 1 AND 5),
    CONSTRAINT reviews_body_chk  CHECK (char_length(body) <= 500),
    UNIQUE (listing_id, author_id)
);
CREATE INDEX reviews_listing_idx ON platform.reviews (listing_id, created_at DESC);
