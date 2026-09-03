package platformsvc

import (
	"context"
	"fmt"
	"strings"
	"time"
)

// maxFeedbackLen bounds a feedback body in runes; matches the DDL's
// feedback_body_len_chk (char_length(body) BETWEEN 1 AND 2000).
const maxFeedbackLen = 2000

const feedbackInboxLimit = 100

// feedbackCategories whitelists the closed category set (mirrors the DDL's
// feedback_category_chk).
var feedbackCategories = map[string]bool{"bug": true, "suggestion": true, "other": true}

// FeedbackEntry is a privacy-safe feedback row returned by feedback read APIs.
type FeedbackEntry struct {
	ID        string `json:"id"`
	Category  string `json:"category"`
	Body      string `json:"body"`
	Status    string `json:"status"`
	CreatedAt string `json:"createdAt"`
}

// CreateFeedbackRequest is the POST /feedback body.
type CreateFeedbackRequest struct {
	Category string `json:"category"`
	Body     string `json:"body"`
}

// validate checks and normalizes a feedback request.
func (r *CreateFeedbackRequest) validate() error {
	if !feedbackCategories[r.Category] {
		return ErrBadUpload
	}
	r.Body = strings.TrimSpace(r.Body)
	if r.Body == "" || len([]rune(r.Body)) > maxFeedbackLen || hasControlCharAllowNewline(r.Body) {
		return ErrBadUpload
	}
	return nil
}

// SubmitFeedback records a piece of user feedback and returns its id.
func (s *Store) SubmitFeedback(ctx context.Context, accountID string, req CreateFeedbackRequest) (string, error) {
	if err := req.validate(); err != nil {
		return "", err
	}
	var id string
	if err := s.pool.QueryRow(ctx, `
		INSERT INTO platform.feedback (account_id, category, body)
		VALUES ($1, $2, $3) RETURNING id`,
		accountID, req.Category, req.Body,
	).Scan(&id); err != nil {
		return "", fmt.Errorf("platformsvc: insert feedback: %w", err)
	}
	return id, nil
}

// ListMyFeedback returns the caller's own feedback, newest first.
func (s *Store) ListMyFeedback(ctx context.Context, accountID string) ([]FeedbackEntry, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, category, body, status, created_at
		FROM platform.feedback
		WHERE account_id = $1
		ORDER BY created_at DESC
		LIMIT $2`,
		accountID, browseLimit,
	)
	if err != nil {
		return nil, fmt.Errorf("platformsvc: my feedback: %w", err)
	}
	defer rows.Close()
	out := []FeedbackEntry{}
	for rows.Next() {
		var e FeedbackEntry
		var created time.Time
		if err := rows.Scan(&e.ID, &e.Category, &e.Body, &e.Status, &created); err != nil {
			return nil, fmt.Errorf("platformsvc: scan feedback: %w", err)
		}
		e.CreatedAt = created.Format(time.RFC3339)
		out = append(out, e)
	}
	return out, rows.Err()
}

// ListFeedback returns the newest feedback across all accounts without any
// submitter identity fields. Equal timestamps are ordered by id for stability.
func (s *Store) ListFeedback(ctx context.Context) ([]FeedbackEntry, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, category, body, status, created_at
		FROM platform.feedback
		ORDER BY created_at DESC, id DESC
		LIMIT $1`,
		feedbackInboxLimit,
	)
	if err != nil {
		return nil, fmt.Errorf("platformsvc: list feedback: %w", err)
	}
	defer rows.Close()
	out := []FeedbackEntry{}
	for rows.Next() {
		var e FeedbackEntry
		var created time.Time
		if err := rows.Scan(&e.ID, &e.Category, &e.Body, &e.Status, &created); err != nil {
			return nil, fmt.Errorf("platformsvc: scan feedback inbox: %w", err)
		}
		e.CreatedAt = created.Format(time.RFC3339)
		out = append(out, e)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("platformsvc: iterate feedback inbox: %w", err)
	}
	return out, nil
}
