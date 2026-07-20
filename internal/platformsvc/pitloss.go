package platformsvc

import (
	"context"
	"fmt"
)

// Stop-type classification thresholds (stationary work time, ms): a short stop is
// tyres-only, a long stop includes a wing/front-wing change. Type is NOT stored in
// race_pit_loss — it is derived here at query time, so the policy can change without
// a migration. This is the single source of truth for the thresholds (the frontend
// does not duplicate them), so there is no cross-layer drift risk.
const (
	pitTyresMaxMs     = 3500 // stationary_ms <= this → "tyres"
	pitWingMinMs      = 7000 // stationary_ms >= this → "wing"
	pitLossMinSamples = 3    // minimum measured rows per type to publish an average
)

// PitLossEntry is one track's measured pit-loss average for a single stop type.
type PitLossEntry struct {
	StopType  string `json:"stopType"`  // "tyres" | "wing" | "unknown"
	AvgLaneMs int    `json:"avgLaneMs"` // mean pit-lane dwell (travel + stationary)
	AvgStatMs int    `json:"avgStatMs"` // mean stationary (box work) time
	Samples   int    `json:"samples"`
}

// PitLossByTrack averages measured pit-loss for a track+game_format, split by stop
// type (classified from stationary_ms). Only plausible races count (leaderboards
// convention) and a type must clear pitLossMinSamples to be published.
func (s *Store) PitLossByTrack(ctx context.Context, trackID int, format string) ([]PitLossEntry, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT CASE
		           WHEN pl.stationary_ms > 0 AND pl.stationary_ms <= $3 THEN 'tyres'
		           WHEN pl.stationary_ms >= $4                          THEN 'wing'
		           ELSE 'unknown'
		       END                            AS stop_type,
		       avg(pl.pit_lane_time_ms)::int  AS avg_lane_ms,
		       avg(pl.stationary_ms)::int     AS avg_stat_ms,
		       count(*)                       AS samples
		FROM platform.race_pit_loss pl
		JOIN platform.races r ON r.id = pl.race_id
		WHERE r.track_id = $1 AND r.game_format = $2 AND r.plausible
		GROUP BY stop_type
		HAVING count(*) >= $5
		ORDER BY stop_type
		LIMIT $6`,
		trackID, format, pitTyresMaxMs, pitWingMinMs, pitLossMinSamples, leaderboardLimit,
	)
	if err != nil {
		return nil, fmt.Errorf("platformsvc: pit loss by track: %w", err)
	}
	defer rows.Close()

	out := []PitLossEntry{}
	for rows.Next() {
		var e PitLossEntry
		if err := rows.Scan(&e.StopType, &e.AvgLaneMs, &e.AvgStatMs, &e.Samples); err != nil {
			return nil, fmt.Errorf("platformsvc: scan pit loss: %w", err)
		}
		out = append(out, e)
	}
	return out, rows.Err()
}
