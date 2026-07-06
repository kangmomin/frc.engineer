package platformsvc

import (
	"context"
	"fmt"
)

// claimNonce records an OpenID response_nonce, returning true if it was fresh
// (newly inserted) and false if it had already been seen (replay).
func (s *Store) claimNonce(ctx context.Context, nonce string) (bool, error) {
	tag, err := s.pool.Exec(ctx,
		`INSERT INTO platform.openid_nonces (response_nonce) VALUES ($1) ON CONFLICT DO NOTHING`,
		nonce,
	)
	if err != nil {
		return false, fmt.Errorf("platformsvc: claim nonce: %w", err)
	}
	return tag.RowsAffected() == 1, nil
}

// SweepExpired deletes rows past their usefulness: expired sessions, consumed or
// expired pairings, and stale OpenID nonces. Safe to run periodically; bounds
// table growth. Nonces are kept a short while past freshness so replays still
// hit a row rather than being re-inserted.
func (s *Store) SweepExpired(ctx context.Context) error {
	stmts := []string{
		`DELETE FROM platform.sessions WHERE expires_at <= now()`,
		`DELETE FROM platform.device_pairings WHERE expires_at <= now() OR consumed_at IS NOT NULL`,
		`DELETE FROM platform.openid_nonces WHERE created_at < now() - interval '1 hour'`,
		`DELETE FROM platform.rate_limits WHERE window_start < now() - interval '1 hour'`,
	}
	for _, stmt := range stmts {
		if _, err := s.pool.Exec(ctx, stmt); err != nil {
			return fmt.Errorf("platformsvc: sweep: %w", err)
		}
	}
	return nil
}
