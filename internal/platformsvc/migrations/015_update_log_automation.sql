-- Stable caller-supplied publication identity. Manual UI publications keep NULL.
ALTER TABLE platform.update_logs ADD COLUMN release_key TEXT UNIQUE
    CHECK (release_key ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$');
