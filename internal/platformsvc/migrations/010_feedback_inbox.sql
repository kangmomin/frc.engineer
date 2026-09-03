-- 010_feedback_inbox.sql — operator feedback inbox permission and read index.
-- The permission catalog is append-only; the default user role intentionally
-- receives no grant. Existing admin root grants inherit the new leaf.
INSERT INTO platform.permissions (name) VALUES
  ('pithub.feedback-inbox'),
  ('pithub.feedback-inbox.read');

-- Supports the inbox's global, deterministic newest-100 query.
CREATE INDEX feedback_global_created_idx
    ON platform.feedback (created_at DESC, id DESC);
