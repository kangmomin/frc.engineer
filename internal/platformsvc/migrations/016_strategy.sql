-- Strategy evidence is collected by every upload-capable Sender.
-- Strategy consumption requires an explicitly assigned read permission.
CREATE TABLE platform.race_strategy (
    race_id UUID PRIMARY KEY REFERENCES platform.races(id) ON DELETE CASCADE,
    session_uid TEXT NOT NULL CHECK (session_uid ~ '^[1-9][0-9]{0,19}$'),
    evidence JSONB NOT NULL CHECK (jsonb_typeof(evidence) = 'object' AND octet_length(evidence::text) <= 160 * 1024)
);
CREATE INDEX race_strategy_session_idx ON platform.race_strategy (session_uid);
CREATE INDEX races_strategy_recent_idx ON platform.races (track_id, game_format, uploaded_at DESC) WHERE plausible;

INSERT INTO platform.permissions (name) VALUES
    ('pithub.strategy'), ('pithub.strategy.read');
-- No default user grant. Administrators assign access through existing roles.
