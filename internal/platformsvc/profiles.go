package platformsvc

import (
	"context"
	"fmt"

	"frc.engineer/internal/tracks"
)

// DriverProfile is the privacy-safe, authenticated view of one eligible driver.
// It deliberately does not embed Account or Race: Steam, source/session, and
// race-detail fields must remain impossible to serialize from this endpoint.
type DriverProfile struct {
	AccountID string         `json:"accountId"`
	Persona   string         `json:"persona"`
	AvatarURL string         `json:"avatarUrl"`
	Verified  bool           `json:"verified"`
	Summary   ProfileSummary `json:"summary"`
	Tracks    []ProfileTrack `json:"tracks"`
}

type ProfileSummary struct {
	VerifiedRaces int `json:"verifiedRaces"`
	ValidLaps     int `json:"validLaps"`
	TrackFormats  int `json:"trackFormats"`
}

type ProfileTrack struct {
	TrackID    int              `json:"trackId"`
	TrackName  string           `json:"trackName"`
	GameFormat string           `json:"gameFormat"`
	TimeTrial  ProfileTimeTrial `json:"timeTrial"`
	RacePace   *ProfileRacePace `json:"racePace"`
}

type ProfileTimeTrial struct {
	Rank         int `json:"rank"`
	Participants int `json:"participants"`
	LapMS        int `json:"lapMs"`
	S1MS         int `json:"s1Ms"`
	S2MS         int `json:"s2Ms"`
	S3MS         int `json:"s3Ms"`
}

type ProfileRacePace struct {
	Rank         int     `json:"rank"`
	Participants int     `json:"participants"`
	AvgMS        int     `json:"avgMs"`
	Laps         int     `json:"laps"`
	Consistency  float64 `json:"consistency"`
	StddevMS     float64 `json:"stddevMs"`
	Tyre         string  `json:"tyre"`
}

// DriverProfile returns a single consistent snapshot for an eligible target.
// Its leaderboard populations intentionally retain the existing leaderboard
// semantics (plausible valid laps from every non-banned account), while the
// canonical pairs are restricted up front to the target's own valid data.
func (s *Store) DriverProfile(ctx context.Context, accountID string) (*DriverProfile, error) {
	pairs := tracks.SupportedTrackFormatPairs()
	trackIDs := make([]int, 0, len(pairs))
	formats := make([]string, 0, len(pairs))
	for _, pair := range pairs {
		trackIDs = append(trackIDs, pair.TrackID)
		formats = append(formats, pair.Format)
	}

	rows, err := s.pool.Query(ctx, `
		WITH target AS (
			SELECT a.id, a.persona, a.avatar_url
			FROM platform.accounts a
			WHERE a.id = $1
			  AND a.kind = 'user'
			  AND a.verified_at IS NOT NULL
			  AND NOT EXISTS (SELECT 1 FROM platform.account_bans b WHERE b.account_id = a.id)
		), canonical_pairs AS (
			SELECT track_id, game_format, ord::int AS ord
			FROM unnest($2::int[], $3::text[]) WITH ORDINALITY AS p(track_id, game_format, ord)
		), target_valid_laps AS (
			SELECT r.id AS race_id, r.track_id, r.game_format, cp.ord
			FROM target t
			JOIN platform.races r ON r.account_id = t.id
			JOIN canonical_pairs cp ON cp.track_id = r.track_id AND cp.game_format = r.game_format
			JOIN platform.laps l ON l.race_id = r.id AND l.valid
			WHERE r.plausible
		), target_pairs AS (
			SELECT track_id, game_format, min(ord) AS ord
			FROM target_valid_laps
			GROUP BY track_id, game_format
		), summary AS (
			SELECT count(DISTINCT race_id)::int AS verified_races,
			       count(*)::int AS valid_laps,
			       count(DISTINCT (track_id, game_format))::int AS track_formats
			FROM target_valid_laps
		), tt_representatives AS (
			SELECT DISTINCT ON (r.account_id, tp.track_id, tp.game_format)
			       r.account_id, tp.track_id, tp.game_format,
			       l.lap_ms, l.s1_ms, l.s2_ms, l.s3_ms, r.uploaded_at
			FROM target_pairs tp
			JOIN platform.races r ON r.track_id = tp.track_id AND r.game_format = tp.game_format
			JOIN platform.laps l ON l.race_id = r.id AND l.valid
			WHERE r.plausible
			  AND NOT EXISTS (SELECT 1 FROM platform.account_bans b WHERE b.account_id = r.account_id)
			ORDER BY r.account_id, tp.track_id, tp.game_format, l.lap_ms, r.uploaded_at, r.id, l.id
		), tt_ranked AS (
			SELECT tt_representatives.*,
			       row_number() OVER (PARTITION BY track_id, game_format ORDER BY lap_ms, uploaded_at, account_id)::int AS rank,
			       count(*) OVER (PARTITION BY track_id, game_format)::int AS participants
			FROM tt_representatives
		), pace_stats AS (
			SELECT r.account_id, tp.track_id, tp.game_format,
			       avg(l.lap_ms)::int AS avg_ms,
			       count(*)::int AS laps,
			       coalesce(stddev_pop(l.lap_ms), 0)::float8 AS sd,
			       mode() WITHIN GROUP (ORDER BY l.tyre) AS tyre
			FROM target_pairs tp
			JOIN platform.races r ON r.track_id = tp.track_id AND r.game_format = tp.game_format
			JOIN platform.laps l ON l.race_id = r.id AND l.valid
			WHERE r.plausible
			  AND NOT EXISTS (SELECT 1 FROM platform.account_bans b WHERE b.account_id = r.account_id)
			GROUP BY r.account_id, tp.track_id, tp.game_format
			HAVING count(*) >= $4
		), pace_ranked AS (
			SELECT pace_stats.*,
			       row_number() OVER (PARTITION BY track_id, game_format ORDER BY avg_ms, account_id)::int AS rank,
			       count(*) OVER (PARTITION BY track_id, game_format)::int AS participants
			FROM pace_stats
		)
		SELECT t.id, t.persona, t.avatar_url,
		       s.verified_races, s.valid_laps, s.track_formats,
		       tp.track_id, tp.game_format,
		       tt.rank, tt.participants, tt.lap_ms, tt.s1_ms, tt.s2_ms, tt.s3_ms,
		       pace.rank, pace.participants, pace.avg_ms, pace.laps, pace.sd, pace.tyre
		FROM target t
		CROSS JOIN summary s
		LEFT JOIN target_pairs tp ON true
		LEFT JOIN tt_ranked tt ON tt.account_id = t.id AND tt.track_id = tp.track_id AND tt.game_format = tp.game_format
		LEFT JOIN pace_ranked pace ON pace.account_id = t.id AND pace.track_id = tp.track_id AND pace.game_format = tp.game_format
		ORDER BY tp.ord`,
		accountID, trackIDs, formats, paceMinLaps,
	)
	if err != nil {
		return nil, fmt.Errorf("platformsvc: driver profile: %w", err)
	}
	defer rows.Close()

	// A row can only originate from target, whose predicate requires verified_at.
	profile := &DriverProfile{Verified: true, Tracks: make([]ProfileTrack, 0)}
	found := false
	for rows.Next() {
		var (
			trackID, ttRank, ttParticipants, ttLapMS, ttS1MS, ttS2MS, ttS3MS *int
			format                                                           *string
			paceRank, paceParticipants, paceAvgMS, paceLaps                  *int
			paceSD                                                           *float64
			paceTyre                                                         *string
		)
		if err := rows.Scan(
			&profile.AccountID, &profile.Persona, &profile.AvatarURL,
			&profile.Summary.VerifiedRaces, &profile.Summary.ValidLaps, &profile.Summary.TrackFormats,
			&trackID, &format,
			&ttRank, &ttParticipants, &ttLapMS, &ttS1MS, &ttS2MS, &ttS3MS,
			&paceRank, &paceParticipants, &paceAvgMS, &paceLaps, &paceSD, &paceTyre,
		); err != nil {
			return nil, fmt.Errorf("platformsvc: scan driver profile: %w", err)
		}
		found = true
		if trackID == nil {
			continue
		}
		if format == nil || ttRank == nil || ttParticipants == nil || ttLapMS == nil || ttS1MS == nil || ttS2MS == nil || ttS3MS == nil {
			return nil, fmt.Errorf("platformsvc: incomplete driver profile track")
		}
		track := ProfileTrack{
			TrackID:    *trackID,
			TrackName:  tracks.TrackName(int8(*trackID)),
			GameFormat: *format,
			TimeTrial: ProfileTimeTrial{
				Rank: *ttRank, Participants: *ttParticipants, LapMS: *ttLapMS,
				S1MS: *ttS1MS, S2MS: *ttS2MS, S3MS: *ttS3MS,
			},
		}
		if paceRank != nil {
			if paceParticipants == nil || paceAvgMS == nil || paceLaps == nil || paceSD == nil || paceTyre == nil {
				return nil, fmt.Errorf("platformsvc: incomplete driver profile pace")
			}
			consistency := 0.0
			if *paceAvgMS > 0 {
				consistency = max(0, 1-*paceSD/float64(*paceAvgMS))
			}
			track.RacePace = &ProfileRacePace{
				Rank: *paceRank, Participants: *paceParticipants, AvgMS: *paceAvgMS, Laps: *paceLaps,
				Consistency: consistency, StddevMS: *paceSD, Tyre: *paceTyre,
			}
		}
		profile.Tracks = append(profile.Tracks, track)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("platformsvc: driver profile: %w", err)
	}
	if !found {
		return nil, ErrNotFound
	}
	return profile, nil
}
