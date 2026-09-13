package platformsvc

import (
	"context"
	"fmt"
)

// StrategyObservation describes uploaded timings, without correcting for fuel,
// traffic, weather or game settings. Uploads are rows, not independent sessions.
// Fuel has its own sample count and remains unknown for legacy timing uploads.
type StrategyObservation struct {
	TrackID      int      `json:"trackId"`
	Tyre         string   `json:"tyre"`
	Uploads      int      `json:"uploads"`
	Laps         int      `json:"laps"`
	MedianLapMs  float64  `json:"medianLapMs"`
	MinLapMs     int      `json:"minLapMs"`
	MaxLapMs     int      `json:"maxLapMs"`
	FuelLaps     int      `json:"fuelLaps"`
	MedianFuelKg *float64 `json:"medianFuelKg"`
}

func (s *Store) LoadStrategyObservations(ctx context.Context, trackID int, format string) ([]StrategyObservation, error) {
	// Bound the uploads before expanding their laps (at most 300 * 500).
	// Only server-valid timings enter the descriptive statistics. Precise fuel
	// must match the same stored lap and tyre, and have explicit clean flags.
	rows, err := s.pool.Query(ctx, `
		WITH recent AS (
			SELECT r.id, r.track_id FROM platform.races r
			WHERE ($1::integer=-1 OR r.track_id=$1) AND r.game_format=$2 AND r.plausible
			  AND r.session_type IN ('Race','Race 2','Race 3')
			  AND NOT EXISTS (SELECT 1 FROM platform.account_bans b WHERE b.account_id=r.account_id)
			ORDER BY r.uploaded_at DESC,r.id LIMIT $3
		), timings AS (
			SELECT r.track_id,l.tyre,count(DISTINCT r.id) AS uploads,count(*) AS laps,
			       percentile_cont(0.5) WITHIN GROUP (ORDER BY l.lap_ms) AS median_lap_ms,
			       min(l.lap_ms) AS min_lap_ms,max(l.lap_ms) AS max_lap_ms
			FROM recent r JOIN platform.laps l ON l.race_id=r.id AND l.valid
			GROUP BY r.track_id,l.tyre
		), fuel AS (
			SELECT r.track_id,l.tyre,count(*) AS laps,
			       percentile_cont(0.5) WITHIN GROUP (ORDER BY (e->>'fuelKg')::double precision-(e->>'fuelEndKg')::double precision) AS median_kg
			FROM recent r JOIN platform.race_strategy st ON st.race_id=r.id
			CROSS JOIN LATERAL jsonb_array_elements(st.evidence->'laps') e
			JOIN platform.laps l ON l.race_id=r.id AND l.valid
			  AND l.lap_number=(e->>'number')::integer AND l.lap_ms=(e->>'timeMs')::integer AND l.tyre=e->>'tyre'
			WHERE jsonb_array_length(st.evidence->'reasons')=0 AND jsonb_array_length(e->'flags')=0
			  AND e->>'compound'=e->>'endCompound'
			  AND (e->>'fuelKg')::double precision BETWEEN 0 AND 200
			  AND (e->>'fuelEndKg')::double precision BETWEEN 0 AND (e->>'fuelKg')::double precision
			GROUP BY r.track_id,l.tyre
		)
		SELECT t.track_id,t.tyre,t.uploads,t.laps,t.median_lap_ms,t.min_lap_ms,t.max_lap_ms,COALESCE(f.laps,0),f.median_kg
		FROM timings t LEFT JOIN fuel f ON f.track_id=t.track_id AND f.tyre=t.tyre
		ORDER BY t.track_id,t.tyre`, trackID, format, StrategyRecordLimit)
	if err != nil {
		return nil, fmt.Errorf("platformsvc: strategy observations: %w", err)
	}
	defer rows.Close()
	out := []StrategyObservation{}
	for rows.Next() {
		var row StrategyObservation
		if err := rows.Scan(&row.TrackID, &row.Tyre, &row.Uploads, &row.Laps, &row.MedianLapMs, &row.MinLapMs, &row.MaxLapMs, &row.FuelLaps, &row.MedianFuelKg); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}
