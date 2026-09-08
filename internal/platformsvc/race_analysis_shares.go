package platformsvc

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

type RaceAnalysisShare struct {
	Token        string `json:"token"`
	IncludeSetup bool   `json:"includeSetup"`
}

// SharedRaceAnalysis deliberately reuses the allowlisted analysis projection,
// not the upload detail (which also contains playerSetup and private metadata).
type SharedRaceAnalysis struct {
	Detail       *RaceAnalysisDetail `json:"detail"`
	IncludeSetup bool                `json:"includeSetup"`
	Setup        *UploadSetup        `json:"setup,omitempty"`
}

func (s *Store) GetMyRaceAnalysisShare(ctx context.Context, accountID, raceID string) (*RaceAnalysisShare, error) {
	var token *string
	var includeSetup *bool
	err := s.pool.QueryRow(ctx, `
		SELECT sh.token::text, sh.include_setup
		FROM platform.races r
		LEFT JOIN platform.race_analysis_shares sh ON sh.race_id = r.id
		WHERE r.id = $1 AND r.account_id = $2`, raceID, accountID).Scan(&token, &includeSetup)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("platformsvc: read race share: %w", err)
	}
	if token == nil {
		return nil, nil
	}
	return &RaceAnalysisShare{Token: *token, IncludeSetup: *includeSetup}, nil
}

func (s *Store) SetMyRaceAnalysisShare(ctx context.Context, accountID, raceID string, includeSetup bool) (*RaceAnalysisShare, error) {
	var share RaceAnalysisShare
	err := s.pool.QueryRow(ctx, `
		INSERT INTO platform.race_analysis_shares (race_id, include_setup)
		SELECT id, $3 FROM platform.races WHERE id = $1 AND account_id = $2
		ON CONFLICT (race_id) DO UPDATE SET include_setup = EXCLUDED.include_setup
		RETURNING token::text, include_setup`, raceID, accountID, includeSetup).Scan(&share.Token, &share.IncludeSetup)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("platformsvc: set race share: %w", err)
	}
	return &share, nil
}

func (s *Store) DeleteMyRaceAnalysisShare(ctx context.Context, accountID, raceID string) error {
	// Check the owner even when no share exists; never reveal a foreign race.
	if _, err := s.GetMyRaceAnalysisShare(ctx, accountID, raceID); err != nil {
		return err
	}
	_, err := s.pool.Exec(ctx, `DELETE FROM platform.race_analysis_shares sh USING platform.races r
		WHERE sh.race_id = r.id AND r.id = $1 AND r.account_id = $2`, raceID, accountID)
	if err != nil {
		return fmt.Errorf("platformsvc: delete race share: %w", err)
	}
	return nil
}

func (s *Store) sharedRace(ctx context.Context, token string) (accountID, raceID string, includeSetup bool, err error) {
	err = s.pool.QueryRow(ctx, `
		SELECT r.account_id::text, r.id::text, sh.include_setup
		FROM platform.race_analysis_shares sh JOIN platform.races r ON r.id = sh.race_id
		WHERE sh.token = $1`, token).Scan(&accountID, &raceID, &includeSetup)
	if errors.Is(err, pgx.ErrNoRows) {
		err = ErrNotFound
	}
	return
}

func (s *Store) GetSharedRaceAnalysis(ctx context.Context, token string) (*SharedRaceAnalysis, error) {
	accountID, raceID, includeSetup, err := s.sharedRace(ctx, token)
	if err != nil {
		return nil, err
	}
	detail, err := s.GetMyRaceAnalysis(ctx, accountID, raceID)
	if err != nil {
		return nil, err
	}
	result := &SharedRaceAnalysis{Detail: detail, IncludeSetup: includeSetup}
	if includeSetup {
		var canonical []byte
		// Recheck the current token and flag at the setup read itself, so a
		// concurrent hide/revoke cannot accidentally disclose a stale setup.
		err := s.pool.QueryRow(ctx, `
			SELECT rs.params_canonical FROM platform.race_setup rs
			JOIN platform.race_analysis_shares sh ON sh.race_id = rs.race_id
			WHERE sh.token = $1 AND sh.include_setup`, token).Scan(&canonical)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("platformsvc: shared setup: %w", err)
		}
		if err == nil {
			var setup UploadSetup
			if err := json.Unmarshal(canonical, &setup); err != nil {
				return nil, fmt.Errorf("platformsvc: decode shared setup: %w", err)
			}
			result.Setup = &setup
		}
	}
	return result, nil
}

func (s *Store) GetSharedRaceAnalysisIncident(ctx context.Context, token string, index int) (*RaceAnalysisIncidentReplay, error) {
	accountID, raceID, _, err := s.sharedRace(ctx, token)
	if err != nil {
		return nil, err
	}
	return s.GetMyRaceAnalysisIncident(ctx, accountID, raceID, index)
}
