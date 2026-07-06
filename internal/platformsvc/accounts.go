package platformsvc

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// ErrNotFound is returned when a lookup matches no row.
var ErrNotFound = errors.New("platformsvc: not found")

// Account is a platform account. Kind is "user" for Steam players; system
// accounts ("treasury"/"fee_sink") back the closed-loop economy.
type Account struct {
	ID        string `json:"id"`
	SteamID64 string `json:"steamId64"`
	Persona   string `json:"persona"`
	AvatarURL string `json:"avatarUrl"`
	Kind      string `json:"kind"`
	Verified  bool   `json:"verified"` // verified_at IS NOT NULL (proof-of-play)
	Banned    bool   `json:"banned"`
	CreatedAt string `json:"createdAt"`
}

// UpsertSteamAccount inserts or updates a Steam user account keyed by
// SteamID64, refreshing the display fields (persona/avatar). It returns the
// account id. The caller must pass a validated 17-digit SteamID64.
func (s *Store) UpsertSteamAccount(ctx context.Context, steamID64, persona, avatarURL string) (string, error) {
	var id string
	err := s.pool.QueryRow(ctx, `
		INSERT INTO platform.accounts AS acc (steam_id64, persona, avatar_url, kind)
		VALUES ($1, $2, $3, 'user')
		ON CONFLICT (steam_id64) DO UPDATE
		    SET persona = COALESCE(NULLIF(EXCLUDED.persona, ''), acc.persona),
		        avatar_url = COALESCE(NULLIF(EXCLUDED.avatar_url, ''), acc.avatar_url)
		RETURNING id`,
		steamID64, persona, avatarURL,
	).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("platformsvc: upsert steam account: %w", err)
	}
	return id, nil
}

// GetAccount returns the account for id, with its banned/verified flags
// resolved. Returns ErrNotFound if no such account.
func (s *Store) GetAccount(ctx context.Context, id string) (*Account, error) {
	a := &Account{}
	var steamID64, persona, avatarURL *string
	var createdAt time.Time
	err := s.pool.QueryRow(ctx, `
		SELECT a.id,
		       a.steam_id64,
		       a.persona,
		       a.avatar_url,
		       a.kind,
		       (a.verified_at IS NOT NULL) AS verified,
		       (b.account_id IS NOT NULL) AS banned,
		       a.created_at
		FROM platform.accounts a
		LEFT JOIN platform.account_bans b ON b.account_id = a.id
		WHERE a.id = $1`,
		id,
	).Scan(&a.ID, &steamID64, &persona, &avatarURL, &a.Kind, &a.Verified, &a.Banned, &createdAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("platformsvc: get account: %w", err)
	}
	a.SteamID64 = deref(steamID64)
	a.Persona = deref(persona)
	a.AvatarURL = deref(avatarURL)
	a.CreatedAt = createdAt.Format(time.RFC3339)
	return a, nil
}

// IsBanned reports whether the account has an active moderation ban.
func (s *Store) IsBanned(ctx context.Context, accountID string) (bool, error) {
	var exists bool
	err := s.pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM platform.account_bans WHERE account_id = $1)`,
		accountID,
	).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("platformsvc: is banned: %w", err)
	}
	return exists, nil
}

func deref(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}
