-- 006_feedback.sql — user feedback (의견 보내기).
-- Hub users submit categorized free-text feedback. No admin UI: operators read
-- rows and update status via SQL (same operating model as account_bans).
-- category/status are closed sets; body cap mirrors feedback.go's rune check.
CREATE TABLE platform.feedback (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES platform.accounts(id),
    category   TEXT NOT NULL,
    body       TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'open',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT feedback_category_chk CHECK (category IN ('bug', 'suggestion', 'other')),
    CONSTRAINT feedback_status_chk   CHECK (status IN ('open', 'in_progress', 'resolved', 'dismissed')),
    CONSTRAINT feedback_body_len_chk CHECK (char_length(body) BETWEEN 1 AND 2000)
);
CREATE INDEX feedback_account_idx ON platform.feedback (account_id, created_at DESC);
