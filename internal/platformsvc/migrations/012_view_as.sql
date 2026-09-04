-- 012_view_as.sql — short-lived, read-only child sessions for operator View As.
--
-- A parent web session owns at most one child. The parent FK makes logout and
-- account deletion revoke the child automatically; only token hashes are
-- persisted, matching platform.sessions.

CREATE TABLE platform.view_as_sessions (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash         TEXT NOT NULL UNIQUE,
    parent_token_hash  TEXT NOT NULL UNIQUE
        REFERENCES platform.sessions(token_hash) ON DELETE CASCADE,
    subject_account_id UUID NOT NULL
        REFERENCES platform.accounts(id) ON DELETE CASCADE,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at         TIMESTAMPTZ NOT NULL
);

CREATE INDEX view_as_sessions_subject_idx
    ON platform.view_as_sessions (subject_account_id);
CREATE INDEX view_as_sessions_expires_idx
    ON platform.view_as_sessions (expires_at);

-- Append-only RBAC catalog extension. The default user role intentionally gets
-- no grant; the admin role inherits this leaf from its existing pithub root.
INSERT INTO platform.permissions (name) VALUES
  ('pithub.view-as'),
  ('pithub.view-as.create');
