-- 011_my_setups.sql — owner-only canonical setup history.
--
-- Rolling-safety invariant: take the races lock FIRST. Old binaries insert a
-- race and then the legacy three-column race_setup row in one transaction; by
-- draining/blocking those writers before the trigger/backfill window, every
-- setup is either backfilled or passes through the new trigger after commit.
LOCK TABLE platform.races IN ACCESS EXCLUSIVE MODE;

CREATE TABLE platform.setup_groups (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id       UUID NOT NULL REFERENCES platform.accounts(id) ON DELETE CASCADE,
    content_hash     TEXT NOT NULL,
    params_canonical BYTEA NOT NULL,
    name             TEXT NOT NULL DEFAULT '',
    rating           SMALLINT,
    memo             TEXT NOT NULL DEFAULT '',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT setup_groups_hash_len_chk CHECK (char_length(content_hash) = 64),
    CONSTRAINT setup_groups_rating_chk CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
    CONSTRAINT setup_groups_name_len_chk CHECK (char_length(name) <= 80),
    CONSTRAINT setup_groups_memo_len_chk CHECK (char_length(memo) <= 500),
    UNIQUE (account_id, content_hash, params_canonical)
);

-- The trigger deliberately reads the owner from races instead of adding any
-- owner field to race_setup. Keeping race_setup's existing three-column writer
-- contract is what makes deployed older senders safe during a rolling upgrade.
CREATE FUNCTION platform.ensure_setup_group() RETURNS trigger AS $$
BEGIN
    INSERT INTO platform.setup_groups (account_id, content_hash, params_canonical)
    SELECT r.account_id, NEW.content_hash, NEW.params_canonical
    FROM platform.races r
    WHERE r.id = NEW.race_id
    ON CONFLICT (account_id, content_hash, params_canonical) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Install before backfill: rows inserted by a writer released after the races
-- lock is committed cannot fall into a trigger-less gap.
CREATE TRIGGER race_setup_ensure_group_trg
    AFTER INSERT ON platform.race_setup
    FOR EACH ROW EXECUTE FUNCTION platform.ensure_setup_group();

INSERT INTO platform.setup_groups (account_id, content_hash, params_canonical)
SELECT r.account_id, rs.content_hash, rs.params_canonical
FROM platform.race_setup rs
JOIN platform.races r ON r.id = rs.race_id
ON CONFLICT (account_id, content_hash, params_canonical) DO NOTHING;

-- Nullable preserves historical rows. New ingestion always derives
-- completed_laps from len(laps), so zero is intentionally not representable.
ALTER TABLE platform.races
    ADD COLUMN recorded_at TIMESTAMPTZ,
    ADD COLUMN finish_position SMALLINT,
    ADD COLUMN completed_laps INTEGER,
    ADD CONSTRAINT races_finish_position_chk CHECK (finish_position BETWEEN 1 AND 24),
    ADD CONSTRAINT races_completed_laps_chk CHECK (completed_laps BETWEEN 1 AND 500);

CREATE INDEX race_setup_group_lookup_idx
    ON platform.race_setup (content_hash, params_canonical, race_id);
CREATE INDEX races_owner_recorded_idx
    ON platform.races (account_id, recorded_at DESC NULLS LAST, uploaded_at DESC, id DESC)
    WHERE plausible;

-- The catalog is append-only. Existing admin pithub-root grants inherit this
-- leaf; the default user role receives the explicit update grant.
INSERT INTO platform.permissions (name) VALUES
    ('pithub.race.update');

INSERT INTO platform.role_permissions (role_id, permission_name)
SELECT r.id, 'pithub.race.update'
FROM platform.roles r
WHERE r.name = 'user';
