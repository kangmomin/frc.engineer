package platformsvc

import (
	"context"
	"fmt"
)

// leaderboardLimit caps rows returned per leaderboard query.
const leaderboardLimit = 200

// paceMinLaps is the minimum valid laps an account needs to appear on the pace
// board. Without it a single valid lap yields stddev 0 → consistency 1.0,
// collapsing pace into a second best-lap board. Note: pit in/out laps are
// telemetrically valid and inflate the average — accepted for v1.
const paceMinLaps = 5

// TTEntry is one legacy all-session PB row with its sector split.
type TTEntry struct {
	Rank      int    `json:"rank"`
	AccountID string `json:"accountId"`
	Persona   string `json:"persona"`
	LapMs     uint32 `json:"lapMs"`
	S1Ms      uint32 `json:"s1Ms"`
	S2Ms      uint32 `json:"s2Ms"`
	S3Ms      uint32 `json:"s3Ms"`
	You       bool   `json:"you"`
}

// PaceEntry is one pace leaderboard row: an account's average valid lap on a track+format, with lap count, consistency, and dominant tyre.
type PaceEntry struct {
	Rank        int     `json:"rank"`
	AccountID   string  `json:"accountId"`
	Persona     string  `json:"persona"`
	AvgMs       uint32  `json:"avgMs"`
	Laps        int     `json:"laps"`
	Consistency float64 `json:"consistency"`
	Tyre        string  `json:"tyre"`
	You         bool    `json:"you"`
}

// TimeTrialLeaderboard retains the legacy all-session best valid lap per account for a
// track+format, ranked ascending. viewerID (may be empty) is flagged as You.
// Banned accounts are excluded.
func (s *Store) TimeTrialLeaderboard(ctx context.Context, trackID int, format, viewerID string) ([]TTEntry, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT best.account_id, best.persona, best.lap_ms, best.s1_ms, best.s2_ms, best.s3_ms
		FROM (
			SELECT DISTINCT ON (r.account_id)
			       r.account_id, a.persona, l.lap_ms, l.s1_ms, l.s2_ms, l.s3_ms, r.uploaded_at
			FROM platform.laps l
			JOIN platform.races r ON r.id = l.race_id
			JOIN platform.accounts a ON a.id = r.account_id
			WHERE r.track_id = $1 AND r.game_format = $2 AND r.plausible AND l.valid
			  AND NOT EXISTS (SELECT 1 FROM platform.account_bans b WHERE b.account_id = r.account_id)
			ORDER BY r.account_id, l.lap_ms ASC, r.uploaded_at ASC, r.id, l.id
		) best
		ORDER BY best.lap_ms ASC, best.uploaded_at ASC, best.account_id
		LIMIT $3`,
		trackID, format, leaderboardLimit,
	)
	if err != nil {
		return nil, fmt.Errorf("platformsvc: tt leaderboard: %w", err)
	}
	defer rows.Close()

	out := []TTEntry{}
	for rows.Next() {
		var e TTEntry
		if err := rows.Scan(&e.AccountID, &e.Persona, &e.LapMs, &e.S1Ms, &e.S2Ms, &e.S3Ms); err != nil {
			return nil, fmt.Errorf("platformsvc: scan tt: %w", err)
		}
		e.Rank = len(out) + 1
		e.You = viewerID != "" && e.AccountID == viewerID
		out = append(out, e)
	}
	return out, rows.Err()
}

// PaceLeaderboard returns average valid-lap pace per account for a track+format,
// ranked ascending by average. Consistency is 1-(stddev/avg), floored at 0.
// Banned accounts are excluded.
func (s *Store) PaceLeaderboard(ctx context.Context, trackID int, format, viewerID string) ([]PaceEntry, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT p.account_id, p.persona, p.avg_ms, p.laps, p.sd, p.tyre
		FROM (
			SELECT r.account_id, a.persona,
			       avg(l.lap_ms)::int AS avg_ms,
			       count(*)           AS laps,
			       coalesce(stddev_pop(l.lap_ms), 0) AS sd,
			       mode() WITHIN GROUP (ORDER BY l.tyre) AS tyre
			FROM platform.laps l
			JOIN platform.races r ON r.id = l.race_id
			JOIN platform.accounts a ON a.id = r.account_id
			WHERE r.track_id = $1 AND r.game_format = $2 AND r.plausible AND l.valid
			  AND NOT EXISTS (SELECT 1 FROM platform.account_bans b WHERE b.account_id = r.account_id)
			GROUP BY r.account_id, a.persona
			HAVING count(*) >= $3
		) p
		ORDER BY p.avg_ms ASC, p.account_id
		LIMIT $4`,
		trackID, format, paceMinLaps, leaderboardLimit,
	)
	if err != nil {
		return nil, fmt.Errorf("platformsvc: pace leaderboard: %w", err)
	}
	defer rows.Close()

	out := []PaceEntry{}
	for rows.Next() {
		var e PaceEntry
		var sd float64
		if err := rows.Scan(&e.AccountID, &e.Persona, &e.AvgMs, &e.Laps, &sd, &e.Tyre); err != nil {
			return nil, fmt.Errorf("platformsvc: scan pace: %w", err)
		}
		if e.AvgMs > 0 {
			e.Consistency = max(0, 1-sd/float64(e.AvgMs))
		}
		e.Rank = len(out) + 1
		e.You = viewerID != "" && e.AccountID == viewerID
		out = append(out, e)
	}
	return out, rows.Err()
}
