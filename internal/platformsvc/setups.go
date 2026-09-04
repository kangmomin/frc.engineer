package platformsvc

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

// PlatformMySetupParams is the private, typed owner representation of the
// canonical 23-value setup. It intentionally aliases the upload struct: both
// directions have the same fixed JSON key set, and neither exposes the
// canonical bytes or content hash used internally for grouping.
type PlatformMySetupParams = UploadSetup

// PlatformMySetupSummary is one canonical setup group in an owner's history.
// All metadata is private to the owner; this type must never be reused by a
// public marketplace response.
type PlatformMySetupSummary struct {
	ID              string                `json:"id"`
	Name            string                `json:"name"`
	Rating          *int                  `json:"rating"`
	Memo            string                `json:"memo"`
	Params          PlatformMySetupParams `json:"params"`
	UsageCount      int                   `json:"usageCount"`
	FirstRecordedAt *string               `json:"firstRecordedAt"`
	LastRecordedAt  *string               `json:"lastRecordedAt"`
	LastTrackID     int                   `json:"lastTrackId"`
	LastTrackName   string                `json:"lastTrackName"`
	LastGameFormat  string                `json:"lastGameFormat"`
}

// PlatformMySetupRace is one visible use of a canonical setup. Nullable
// fields distinguish legacy/unknown data from a real zero value.
type PlatformMySetupRace struct {
	ID             string  `json:"id"`
	RecordedAt     *string `json:"recordedAt"`
	TrackID        int     `json:"trackId"`
	TrackName      string  `json:"trackName"`
	GameFormat     string  `json:"gameFormat"`
	SessionType    string  `json:"sessionType"`
	FinishPosition *int    `json:"finishPosition"`
	CompletedLaps  *int    `json:"completedLaps"`
	BestLapMs      *int    `json:"bestLapMs"`
}

// PlatformMySetupDetail extends a summary with its latest 100 visible uses.
type PlatformMySetupDetail struct {
	PlatformMySetupSummary
	Races []PlatformMySetupRace `json:"races"`
}

// UpdateMySetupRequest is a full replacement of owner-only metadata. The HTTP
// handler additionally enforces presence/type/unknown-key rules before it
// reaches this domain method.
type UpdateMySetupRequest struct {
	Name   string `json:"name"`
	Rating *int   `json:"rating"`
	Memo   string `json:"memo"`
}

// UpdateMySetupResult is returned after a successful metadata replacement.
type UpdateMySetupResult struct {
	Name      string `json:"name"`
	Rating    *int   `json:"rating"`
	Memo      string `json:"memo"`
	UpdatedAt string `json:"updatedAt"`
}

const mySetupsLimit = 100

// ListMySetups returns the owner's latest 100 groups. The visible CTE keeps
// every security predicate in one place: same owner, same canonical triple,
// and plausible races only. A window rank picks the deterministic latest race
// for each group without turning content_hash into an observable value.
func (s *Store) ListMySetups(ctx context.Context, accountID string) ([]PlatformMySetupSummary, error) {
	rows, err := s.pool.Query(ctx, `
		WITH visible AS (
			SELECT sg.id AS setup_id, sg.name, sg.rating, sg.memo, sg.params_canonical,
			       r.id AS race_id, r.recorded_at, r.uploaded_at,
			       r.track_id, r.track_name, r.game_format
			FROM platform.setup_groups sg
			JOIN platform.races r ON r.account_id = sg.account_id
			JOIN platform.race_setup rs
			  ON rs.race_id = r.id
			 AND rs.content_hash = sg.content_hash
			 AND rs.params_canonical = sg.params_canonical
			WHERE sg.account_id = $1 AND r.plausible
		), ranked AS (
			SELECT *,
			       row_number() OVER (
			           PARTITION BY setup_id
			           ORDER BY recorded_at DESC NULLS LAST, uploaded_at DESC, race_id DESC
			       ) AS setup_rank,
			       (count(*) OVER (PARTITION BY setup_id))::integer AS usage_count,
			       min(recorded_at) OVER (PARTITION BY setup_id) AS first_recorded_at,
			       max(recorded_at) OVER (PARTITION BY setup_id) AS last_recorded_at
			FROM visible
		)
		SELECT setup_id, name, rating, memo, params_canonical, usage_count,
		       first_recorded_at, last_recorded_at, track_id, track_name, game_format
		FROM ranked
		WHERE setup_rank = 1
		ORDER BY recorded_at DESC NULLS LAST, uploaded_at DESC, setup_id DESC
		LIMIT $2`, accountID, mySetupsLimit)
	if err != nil {
		return nil, fmt.Errorf("platformsvc: list my setups: %w", err)
	}
	defer rows.Close()

	out := []PlatformMySetupSummary{}
	for rows.Next() {
		summary, err := scanMySetupSummary(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, summary)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("platformsvc: list my setups: %w", err)
	}
	return out, nil
}

// GetMySetup returns one owner-visible group and its latest 100 uses. Missing,
// foreign, and groups whose only races are implausible all collapse to
// ErrNotFound so callers cannot probe another account's private history.
func (s *Store) GetMySetup(ctx context.Context, accountID, setupID string) (*PlatformMySetupDetail, error) {
	summary, err := s.getMySetupSummary(ctx, accountID, setupID)
	if err != nil {
		return nil, err
	}

	rows, err := s.pool.Query(ctx, `
		SELECT r.id, r.recorded_at, r.track_id, r.track_name, r.game_format,
		       r.session_type, r.finish_position, r.completed_laps, r.best_lap_ms
		FROM platform.setup_groups sg
		JOIN platform.races r ON r.account_id = sg.account_id
		JOIN platform.race_setup rs
		  ON rs.race_id = r.id
		 AND rs.content_hash = sg.content_hash
		 AND rs.params_canonical = sg.params_canonical
		WHERE sg.account_id = $1 AND sg.id = $2 AND r.plausible
		ORDER BY r.recorded_at DESC NULLS LAST, r.uploaded_at DESC, r.id DESC
		LIMIT $3`, accountID, setupID, mySetupsLimit)
	if err != nil {
		return nil, fmt.Errorf("platformsvc: get my setup races: %w", err)
	}
	defer rows.Close()

	detail := &PlatformMySetupDetail{
		PlatformMySetupSummary: *summary,
		Races:                  []PlatformMySetupRace{},
	}
	for rows.Next() {
		var race PlatformMySetupRace
		var recordedAt *time.Time
		if err := rows.Scan(
			&race.ID, &recordedAt, &race.TrackID, &race.TrackName, &race.GameFormat,
			&race.SessionType, &race.FinishPosition, &race.CompletedLaps, &race.BestLapMs,
		); err != nil {
			return nil, fmt.Errorf("platformsvc: scan my setup race: %w", err)
		}
		race.RecordedAt = formatOptionalTime(recordedAt)
		detail.Races = append(detail.Races, race)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("platformsvc: get my setup races: %w", err)
	}
	return detail, nil
}

// HasMySetup reports whether a setup is visible to its owner without loading
// response data. It uses the same owner, canonical triple, and plausible-race
// predicates as reads and metadata updates.
func (s *Store) HasMySetup(ctx context.Context, accountID, setupID string) (bool, error) {
	var visible bool
	err := s.pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM platform.setup_groups sg
			JOIN platform.races r ON r.account_id = sg.account_id
			JOIN platform.race_setup rs
			  ON rs.race_id = r.id
			 AND rs.content_hash = sg.content_hash
			 AND rs.params_canonical = sg.params_canonical
			WHERE sg.account_id = $1 AND sg.id = $2 AND r.plausible
		)`, accountID, setupID).Scan(&visible)
	if err != nil {
		return false, fmt.Errorf("platformsvc: check my setup visibility: %w", err)
	}
	return visible, nil
}

func (s *Store) getMySetupSummary(ctx context.Context, accountID, setupID string) (*PlatformMySetupSummary, error) {
	row := s.pool.QueryRow(ctx, `
		WITH visible AS (
			SELECT sg.id AS setup_id, sg.name, sg.rating, sg.memo, sg.params_canonical,
			       r.id AS race_id, r.recorded_at, r.uploaded_at,
			       r.track_id, r.track_name, r.game_format
			FROM platform.setup_groups sg
			JOIN platform.races r ON r.account_id = sg.account_id
			JOIN platform.race_setup rs
			  ON rs.race_id = r.id
			 AND rs.content_hash = sg.content_hash
			 AND rs.params_canonical = sg.params_canonical
			WHERE sg.account_id = $1 AND sg.id = $2 AND r.plausible
		), ranked AS (
			SELECT *,
			       row_number() OVER (
			           PARTITION BY setup_id
			           ORDER BY recorded_at DESC NULLS LAST, uploaded_at DESC, race_id DESC
			       ) AS setup_rank,
			       (count(*) OVER (PARTITION BY setup_id))::integer AS usage_count,
			       min(recorded_at) OVER (PARTITION BY setup_id) AS first_recorded_at,
			       max(recorded_at) OVER (PARTITION BY setup_id) AS last_recorded_at
			FROM visible
		)
		SELECT setup_id, name, rating, memo, params_canonical, usage_count,
		       first_recorded_at, last_recorded_at, track_id, track_name, game_format
		FROM ranked
		WHERE setup_rank = 1`, accountID, setupID)
	summary, err := scanMySetupSummary(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &summary, nil
}

func scanMySetupSummary(row pgx.Row) (PlatformMySetupSummary, error) {
	var summary PlatformMySetupSummary
	var canonical []byte
	var firstRecordedAt, lastRecordedAt *time.Time
	if err := row.Scan(
		&summary.ID, &summary.Name, &summary.Rating, &summary.Memo, &canonical,
		&summary.UsageCount, &firstRecordedAt, &lastRecordedAt,
		&summary.LastTrackID, &summary.LastTrackName, &summary.LastGameFormat,
	); err != nil {
		return PlatformMySetupSummary{}, err
	}
	if err := json.Unmarshal(canonical, &summary.Params); err != nil {
		return PlatformMySetupSummary{}, fmt.Errorf("platformsvc: decode my setup params: %w", err)
	}
	summary.FirstRecordedAt = formatOptionalTime(firstRecordedAt)
	summary.LastRecordedAt = formatOptionalTime(lastRecordedAt)
	return summary, nil
}

func formatOptionalTime(value *time.Time) *string {
	if value == nil {
		return nil
	}
	formatted := formatUTCTime(*value)
	return &formatted
}

func formatUTCTime(value time.Time) string {
	return value.UTC().Format(time.RFC3339)
}

// UpdateMySetup replaces one owner's private metadata. The EXISTS predicate is
// intentionally the same owner/canonical/plausible join used by reads, so an
// update cannot create a cross-owner relation or make an invisible group
// addressable by an otherwise valid UUID.
func (s *Store) UpdateMySetup(ctx context.Context, accountID, setupID string, req UpdateMySetupRequest) (*UpdateMySetupResult, error) {
	if err := validateMySetupMetadata(&req); err != nil {
		return nil, err
	}
	var result UpdateMySetupResult
	var updatedAt time.Time
	err := s.pool.QueryRow(ctx, `
		UPDATE platform.setup_groups AS sg
		SET name = $3, rating = $4, memo = $5, updated_at = now()
		WHERE sg.id = $1
		  AND sg.account_id = $2
		  AND EXISTS (
		      SELECT 1
		      FROM platform.races r
		      JOIN platform.race_setup rs
		        ON rs.race_id = r.id
		       AND rs.content_hash = sg.content_hash
		       AND rs.params_canonical = sg.params_canonical
		      WHERE r.account_id = sg.account_id AND r.plausible
		  )
		RETURNING sg.name, sg.rating, sg.memo, sg.updated_at`,
		setupID, accountID, req.Name, req.Rating, req.Memo,
	).Scan(&result.Name, &result.Rating, &result.Memo, &updatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("platformsvc: update my setup: %w", err)
	}
	result.UpdatedAt = formatUTCTime(updatedAt)
	return &result, nil
}

func validateMySetupMetadata(req *UpdateMySetupRequest) error {
	req.Name = strings.TrimSpace(req.Name)
	req.Memo = strings.TrimSpace(req.Memo)
	if utf8.RuneCountInString(req.Name) > 80 || hasMySetupNameControl(req.Name) {
		return ErrBadUpload
	}
	if utf8.RuneCountInString(req.Memo) > 500 || hasControlCharAllowNewline(req.Memo) {
		return ErrBadUpload
	}
	if req.Rating != nil && (*req.Rating < 1 || *req.Rating > 5) {
		return ErrBadUpload
	}
	return nil
}

func hasMySetupNameControl(value string) bool {
	for _, r := range value {
		if r != '\t' && unicode.IsControl(r) {
			return true
		}
	}
	return false
}
