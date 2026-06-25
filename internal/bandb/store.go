package bandb

import (
	"context"
	"fmt"

	"frc.engineer/internal/banlist"
)

// Store is the persistence surface the signaling server depends on. Implemented
// by *DB; tests use an in-memory fake.
type Store interface {
	AddIP(ctx context.Context, ip, nickname, reason string) error
	ListIPs(ctx context.Context) ([]string, error)
	ListNicknames(ctx context.Context) ([]string, error)
}

// AddIP records an auto-banned IP. Idempotent via ON CONFLICT DO NOTHING.
// Parameterized query (no string interpolation) — safe from SQL injection even
// though ip/nickname originate from network input.
func (db *DB) AddIP(ctx context.Context, ip, nickname, reason string) error {
	if ip == "" {
		return nil
	}
	_, err := db.pool.Exec(ctx,
		`INSERT INTO pitwall.banned_ips (ip, nickname, reason) VALUES ($1, $2, $3)
		 ON CONFLICT (ip) DO NOTHING`,
		ip, nickname, reason)
	if err != nil {
		return fmt.Errorf("bandb: add ip: %w", err)
	}
	return nil
}

// ListIPs returns all banned IPs, normalized so cache keys match regardless of
// how a row was inserted (auto-ban or manual).
func (db *DB) ListIPs(ctx context.Context) ([]string, error) {
	rows, err := db.pool.Query(ctx, `SELECT ip FROM pitwall.banned_ips`)
	if err != nil {
		return nil, fmt.Errorf("bandb: list ips: %w", err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var ip string
		if err := rows.Scan(&ip); err != nil {
			return nil, fmt.Errorf("bandb: scan ip: %w", err)
		}
		if n := normalizeIP(ip); n != "" {
			out = append(out, n)
		}
	}
	return out, rows.Err()
}

// ListNicknames returns all banned nicknames, normalized (lower+trim) so a row
// inserted manually as "BadGuy" still matches the normalized player name.
func (db *DB) ListNicknames(ctx context.Context) ([]string, error) {
	rows, err := db.pool.Query(ctx, `SELECT nickname FROM pitwall.banned_nicknames`)
	if err != nil {
		return nil, fmt.Errorf("bandb: list nicknames: %w", err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err != nil {
			return nil, fmt.Errorf("bandb: scan nickname: %w", err)
		}
		if norm := banlist.Normalize(n); norm != "" {
			out = append(out, norm)
		}
	}
	return out, rows.Err()
}
