package platformsvc

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"time"

	"frc.engineer/internal/strategy"
)

const StrategyRecordLimit = 300
const AllStrategyTracks = -1
const strategyRecordsPerUser = 20

// StrategyArchiveCoverage counts recent eligible uploads, including those
// without strategy measurements. These are upload rows, not independent races.
type StrategyArchiveCoverage struct {
	UploadedRaces   int        `json:"uploadedRaces"`
	WithEvidence    int        `json:"withEvidence"`
	WithoutEvidence int        `json:"withoutEvidence"`
	LatestUploadAt  *time.Time `json:"latestUploadAt"`
	Truncated       bool       `json:"truncated"`
	Limit           int        `json:"limit"`
}

func (s *Store) LoadStrategyArchiveCoverage(ctx context.Context, trackID int, format string) (StrategyArchiveCoverage, error) {
	out := StrategyArchiveCoverage{Limit: StrategyRecordLimit}
	err := s.pool.QueryRow(ctx, `
		WITH recent AS (
			SELECT r.id, r.uploaded_at
			FROM platform.races r
			WHERE ($1::integer=-1 OR r.track_id=$1) AND r.game_format=$2 AND r.plausible
			  AND r.session_type IN ('Race','Race 2','Race 3')
			  AND NOT EXISTS (SELECT 1 FROM platform.account_bans b WHERE b.account_id=r.account_id)
			ORDER BY r.uploaded_at DESC,r.id LIMIT $3
		), sampled AS (
			SELECT * FROM recent ORDER BY uploaded_at DESC,id LIMIT $4
		)
		SELECT count(*), count(st.race_id), max(r.uploaded_at),
		       (SELECT count(*) > $4 FROM recent)
		FROM sampled r LEFT JOIN platform.race_strategy st ON st.race_id=r.id`,
		trackID, format, StrategyRecordLimit+1, StrategyRecordLimit).Scan(
		&out.UploadedRaces, &out.WithEvidence, &out.LatestUploadAt, &out.Truncated)
	if err != nil {
		return out, fmt.Errorf("platformsvc: strategy archive coverage: %w", err)
	}
	out.WithoutEvidence = out.UploadedRaces - out.WithEvidence
	return out, nil
}

// LoadStrategyRecords reads a bounded, deduplicated cross-user corpus. Banned
// users are excluded at query time. The payload and all identities remain
// internal; handlers expose only strategy.Context/Result aggregate models.
// AllStrategyTracks selects all tracks within the same global corpus limits.
func (s *Store) LoadStrategyRecords(ctx context.Context, trackID int, format string) ([]strategy.Record, bool, error) {
	rows, err := s.pool.Query(ctx, `
		WITH dedup AS (
			SELECT DISTINCT ON (r.account_id, r.track_id, st.session_uid)
				r.id, r.account_id, r.track_id, st.session_uid, r.uploaded_at, st.evidence
			FROM platform.races r JOIN platform.race_strategy st ON st.race_id=r.id
			WHERE ($1::integer=-1 OR r.track_id=$1) AND r.game_format=$2 AND r.plausible
			  AND r.session_type IN ('Race','Race 2','Race 3')
			  AND NOT EXISTS (SELECT 1 FROM platform.account_bans b WHERE b.account_id=r.account_id)
			ORDER BY r.account_id, r.track_id, st.session_uid, jsonb_array_length(st.evidence->'laps') DESC, r.uploaded_at DESC, r.id
		), ranked AS (
			SELECT *, row_number() OVER (PARTITION BY account_id ORDER BY uploaded_at DESC,id) AS user_row FROM dedup
		)
		SELECT id::text,account_id::text,track_id,evidence FROM ranked WHERE user_row <= $3
		ORDER BY uploaded_at DESC,id LIMIT $4`, trackID, format, strategyRecordsPerUser, StrategyRecordLimit+1)
	if err != nil {
		return nil, false, fmt.Errorf("platformsvc: strategy corpus: %w", err)
	}
	defer rows.Close()
	out := []strategy.Record{}
	for rows.Next() {
		var r strategy.Record
		var body []byte
		if err := rows.Scan(&r.RaceID, &r.AccountID, &r.TrackID, &body); err != nil {
			return nil, false, err
		}
		if err := json.Unmarshal(body, &r.Evidence); err != nil {
			return nil, false, fmt.Errorf("platformsvc: stored strategy: %w", err)
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, false, err
	}
	truncated := len(out) > StrategyRecordLimit
	if truncated {
		out = out[:StrategyRecordLimit]
	}
	return out, truncated, nil
}

func validateStrategyUpload(req *UploadRequest) error {
	e := req.Strategy
	if e == nil {
		return nil
	}
	if strategy.ValidateEvidence(e) != nil {
		return ErrBadUpload
	}
	format := fmt.Sprintf("F1 %d", e.Conditions.PacketFormat-2000)
	session := map[int]string{15: "Race", 16: "Race 2", 17: "Race 3"}[e.Conditions.SessionType]
	if req.GameFormat != format || req.SessionType != session {
		return ErrBadUpload
	}
	byNumber := map[int]UploadLap{}
	for _, l := range req.Laps {
		byNumber[l.LapNumber] = l
	}
	for _, l := range e.Laps {
		p, ok := byNumber[l.Number]
		if !ok || int(p.LapMs) != l.TimeMs {
			return ErrBadUpload
		}
	}
	return nil
}

// The normal server-side lap plausibility decision also governs new evidence.
// A client cannot turn an invalid leaderboard lap into a clean training lap.
func normalizedStrategyEvidence(req UploadRequest, minMs, maxMs uint32) *strategy.Evidence {
	e := *req.Strategy
	e.Laps = append([]strategy.Lap{}, req.Strategy.Laps...)
	valid := map[int]bool{}
	for _, l := range req.Laps {
		valid[l.LapNumber] = validateLap(l, minMs, maxMs)
	}
	for i := range e.Laps {
		l := &e.Laps[i]
		if valid[l.Number] {
			continue
		}
		hasInvalid := false
		for _, flag := range l.Flags {
			if flag == "invalid" {
				hasInvalid = true
			}
		}
		if !hasInvalid {
			l.Flags = append(append([]string{}, l.Flags...), "invalid")
			sort.Strings(l.Flags)
		}
	}
	return &e
}
