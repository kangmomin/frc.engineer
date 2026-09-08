package platformsvc

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"
)

const updateLogPageSize = 20

type UpdateLog struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Body        string `json:"body"`
	PublishedAt string `json:"publishedAt"`
}

type UpdateLogPage struct {
	Items          []UpdateLog `json:"items"`
	LatestRevision string      `json:"latestRevision"`
	HasUnseen      bool        `json:"hasUnseen"`
	NextBefore     string      `json:"nextBefore,omitempty"`
}

type CreateUpdateLogRequest struct {
	Title string `json:"title"`
	Body  string `json:"body"`
}

func (r *CreateUpdateLogRequest) validate() error {
	r.Title, r.Body = strings.TrimSpace(r.Title), strings.TrimSpace(r.Body)
	if r.Title == "" || len([]rune(r.Title)) > 120 || hasControlChar(r.Title) ||
		r.Body == "" || len([]rune(r.Body)) > 10000 || hasControlCharAllowNewline(r.Body) {
		return ErrBadUpload
	}
	return nil
}

// Publications are immutable. Serialize before allocating an identity so a
// delayed commit cannot publish a lower ID behind an acknowledged higher ID.
func (s *Store) CreateUpdateLog(ctx context.Context, req CreateUpdateLogRequest) (*UpdateLog, error) {
	if err := req.validate(); err != nil {
		return nil, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("platformsvc: publish begin: %w", err)
	}
	defer tx.Rollback(context.Background()) //nolint:errcheck
	if _, err := tx.Exec(ctx, `LOCK TABLE platform.update_logs IN SHARE ROW EXCLUSIVE MODE`); err != nil {
		return nil, fmt.Errorf("platformsvc: publish lock: %w", err)
	}
	entry := &UpdateLog{Title: req.Title, Body: req.Body}
	var published time.Time
	if err := tx.QueryRow(ctx, `INSERT INTO platform.update_logs (title, body)
		VALUES ($1, $2) RETURNING id::text, published_at`, req.Title, req.Body).Scan(&entry.ID, &published); err != nil {
		return nil, fmt.Errorf("platformsvc: publish update log: %w", err)
	}
	entry.PublishedAt = published.UTC().Format(time.RFC3339Nano)
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("platformsvc: publish commit: %w", err)
	}
	return entry, nil
}

// One statement keeps the latest revision, seen state, and entries in the
// same snapshot. IDs travel as strings to preserve bigint precision in JS.
func (s *Store) ListUpdateLogs(ctx context.Context, accountID string, before int64) (*UpdateLogPage, error) {
	if before < 0 {
		return nil, ErrBadUpload
	}
	page := &UpdateLogPage{}
	var raw []byte
	err := s.pool.QueryRow(ctx, `WITH latest AS (
		SELECT COALESCE(MAX(id), 0) AS id FROM platform.update_logs
	), entries AS (
		SELECT id, title, body, published_at FROM platform.update_logs
		WHERE ($2::bigint = 0 OR id < $2) ORDER BY id DESC LIMIT $3
	)
	SELECT latest.id::text, latest.id > a.update_log_seen_id,
		COALESCE((SELECT jsonb_agg(jsonb_build_object(
			'id', id::text, 'title', title, 'body', body, 'publishedAt', published_at
		) ORDER BY id DESC) FROM entries), '[]'::jsonb)
	FROM latest CROSS JOIN platform.accounts a WHERE a.id = $1`,
		accountID, before, updateLogPageSize+1).Scan(&page.LatestRevision, &page.HasUnseen, &raw)
	if err != nil {
		return nil, fmt.Errorf("platformsvc: list update logs: %w", err)
	}
	if err := json.Unmarshal(raw, &page.Items); err != nil {
		return nil, fmt.Errorf("platformsvc: decode update logs: %w", err)
	}
	if len(page.Items) > updateLogPageSize {
		page.Items = page.Items[:updateLogPageSize]
		page.NextBefore = page.Items[len(page.Items)-1].ID
	}
	return page, nil
}

// Acknowledge the displayed revision, never the latest revision at request time.
// GREATEST prevents older tabs/devices from moving the cursor backwards.
func (s *Store) MarkUpdateLogsSeen(ctx context.Context, accountID, revision string) error {
	id, err := strconv.ParseInt(revision, 10, 64)
	if err != nil || id <= 0 || strconv.FormatInt(id, 10) != revision {
		return ErrBadUpload
	}
	result, err := s.pool.Exec(ctx, `UPDATE platform.accounts
		SET update_log_seen_id = GREATEST(update_log_seen_id, $2)
		WHERE id = $1 AND EXISTS (SELECT 1 FROM platform.update_logs WHERE id = $2)`, accountID, id)
	if err != nil {
		return fmt.Errorf("platformsvc: acknowledge update logs: %w", err)
	}
	if result.RowsAffected() == 0 {
		return ErrBadUpload
	}
	return nil
}
