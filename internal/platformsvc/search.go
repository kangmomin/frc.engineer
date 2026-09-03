package platformsvc

import (
	"context"
	"fmt"

	"frc.engineer/internal/tracks"
)

const searchLimit = 5

// DriverSearchHit is the public, latest eligible race context for an account.
// It intentionally contains no race, session, lap, or telemetry identifiers.
type DriverSearchHit struct {
	AccountID  string `json:"accountId"`
	Persona    string `json:"persona"`
	TrackID    int    `json:"trackId"`
	GameFormat string `json:"gameFormat"`
}

// SearchResult is the complete public /search response. Its slices are always
// initialized so JSON represents an empty result as [] rather than null.
type SearchResult struct {
	Setups  []ListingCard     `json:"setups"`
	Drivers []DriverSearchHit `json:"drivers"`
}

// Search returns matching public setup cards and verified driver contexts. The
// database applies visibility and canonical-track gates before the fixed cap.
func (s *Store) Search(ctx context.Context, query string) (SearchResult, error) {
	trackIDs, formats, searchTexts := searchTrackParams()
	query = likeEscape(query)

	setups, err := s.searchSetups(ctx, query, trackIDs, formats, searchTexts)
	if err != nil {
		return SearchResult{}, err
	}
	drivers, err := s.searchDrivers(ctx, query, trackIDs, formats, searchTexts)
	if err != nil {
		return SearchResult{}, err
	}
	return SearchResult{Setups: setups, Drivers: drivers}, nil
}

func (s *Store) searchSetups(ctx context.Context, query string, trackIDs []int, formats, searchTexts []string) ([]ListingCard, error) {
	rows, err := s.pool.Query(ctx, `
		WITH canonical_tracks AS (
			SELECT * FROM unnest($2::int[], $3::text[], $4::text[])
			AS t(track_id, game_format, search_text)
		)
		SELECT l.id, l.kind, l.title, a.persona, l.track_id, l.game_format,
		       l.price_credits, l.status, l.created_at,
		       coalesce(rv.rating, 0), coalesce(rv.review_count, 0)
		FROM platform.listings l
		JOIN platform.accounts a ON a.id = l.seller_id
		JOIN canonical_tracks ct ON ct.track_id = l.track_id AND ct.game_format = l.game_format`+reviewAggJoin+`
		WHERE l.kind = 'setup' AND l.status = 'active'
		  AND a.kind = 'user' AND a.verified_at IS NOT NULL
		  AND NOT EXISTS (SELECT 1 FROM platform.account_bans ban WHERE ban.account_id = a.id)
		  AND (l.title ILIKE '%' || $1 || '%' ESCAPE '\'
		       OR a.persona ILIKE '%' || $1 || '%' ESCAPE '\'
		       OR ct.search_text ILIKE '%' || $1 || '%' ESCAPE '\')
		ORDER BY l.created_at DESC, l.id
		LIMIT $5`,
		query, trackIDs, formats, searchTexts, searchLimit,
	)
	if err != nil {
		return nil, fmt.Errorf("platformsvc: search setups: %w", err)
	}
	cards, err := scanCards(rows)
	if err != nil {
		return nil, err
	}
	return cards, nil
}

func (s *Store) searchDrivers(ctx context.Context, query string, trackIDs []int, formats, searchTexts []string) ([]DriverSearchHit, error) {
	rows, err := s.pool.Query(ctx, `
		WITH canonical_tracks AS (
			SELECT * FROM unnest($2::int[], $3::text[], $4::text[])
			AS t(track_id, game_format, search_text)
		), latest AS (
			SELECT DISTINCT ON (r.account_id)
			       r.account_id, a.persona, r.track_id, r.game_format, r.uploaded_at, r.id
			FROM platform.races r
			JOIN platform.accounts a ON a.id = r.account_id
			JOIN canonical_tracks ct ON ct.track_id = r.track_id AND ct.game_format = r.game_format
			WHERE a.kind = 'user' AND a.verified_at IS NOT NULL AND r.plausible
			  AND EXISTS (SELECT 1 FROM platform.laps lap WHERE lap.race_id = r.id AND lap.valid)
			  AND NOT EXISTS (SELECT 1 FROM platform.account_bans ban WHERE ban.account_id = a.id)
			  AND a.persona ILIKE '%' || $1 || '%' ESCAPE '\'
			ORDER BY r.account_id, r.uploaded_at DESC, r.id DESC
		)
		SELECT account_id, persona, track_id, game_format
		FROM latest
		ORDER BY lower(persona), account_id
		LIMIT $5`,
		query, trackIDs, formats, searchTexts, searchLimit,
	)
	if err != nil {
		return nil, fmt.Errorf("platformsvc: search drivers: %w", err)
	}
	defer rows.Close()
	result := make([]DriverSearchHit, 0)
	for rows.Next() {
		var hit DriverSearchHit
		if err := rows.Scan(&hit.AccountID, &hit.Persona, &hit.TrackID, &hit.GameFormat); err != nil {
			return nil, fmt.Errorf("platformsvc: scan search driver: %w", err)
		}
		result = append(result, hit)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("platformsvc: search drivers: %w", err)
	}
	return result, nil
}

func searchTrackParams() ([]int, []string, []string) {
	pairs := tracks.SupportedTrackFormatPairs()
	trackIDs := make([]int, 0, len(pairs))
	formats := make([]string, 0, len(pairs))
	searchTexts := make([]string, 0, len(pairs))
	for _, pair := range pairs {
		trackIDs = append(trackIDs, pair.TrackID)
		formats = append(formats, pair.Format)
		searchTexts = append(searchTexts, pair.SearchText)
	}
	return trackIDs, formats, searchTexts
}
