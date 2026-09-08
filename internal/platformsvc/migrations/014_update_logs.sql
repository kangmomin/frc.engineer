-- Whole-feed acknowledgment: no per-account/per-publication receipt table.
ALTER TABLE platform.accounts ADD COLUMN update_log_seen_id BIGINT NOT NULL DEFAULT 0
    CHECK (update_log_seen_id >= 0);

CREATE TABLE platform.update_logs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
    body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 10000),
    published_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

INSERT INTO platform.permissions (name) VALUES
    ('pithub.update-log'), ('pithub.update-log.create');
