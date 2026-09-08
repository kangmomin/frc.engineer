-- Owner-authorized capability links. A race has at most one active link;
-- deleting it revokes both detail and incident access. Re-creation gets a new
-- random token. The token is retained so the owner can copy an existing link.
-- Setup visibility is opt-in and exposes only the typed 23 setup parameters,
-- never canonical bytes, content hashes, or private setup metadata.
CREATE TABLE platform.race_analysis_shares (
    race_id       UUID PRIMARY KEY REFERENCES platform.races(id) ON DELETE CASCADE,
    token         UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    include_setup BOOLEAN NOT NULL DEFAULT false,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
