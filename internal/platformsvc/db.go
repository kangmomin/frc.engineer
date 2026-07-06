// Package platformsvc is the persistence + domain layer for the hosted Pitwall
// Cloud platform service (cmd/platform): Steam accounts, sessions, telemetry
// ingestion, leaderboards, marketplace, a closed-loop virtual credit economy,
// and reviews.
//
// Unlike internal/platform (a local single-tenant read-model over the desktop
// race store), this package talks to a shared Postgres instance and holds
// cross-user state. All tables live in the fixed "platform" schema; the schema
// name is a literal in migrations/*.sql (never parameterized) so raw migration
// SQL stays injection-free without identifier sanitization.
//
// One package, one pool: every domain shares a single *pgxpool.Pool so that
// money-touching operations (wallet + ledger + purchases) can run inside one
// transaction. Domain logic is split across files (accounts.go, sessions.go,
// steamauth.go, …) rather than sub-packages, which would force exposing the
// pool.
package platformsvc

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Schema is the fixed Postgres schema holding every platform table. It is also
// hardcoded as the "platform." prefix throughout migrations/*.sql; keep the two
// in sync.
const Schema = "platform"

// Store wraps a pgx connection pool for the platform service. It is safe for
// concurrent use.
type Store struct {
	pool *pgxpool.Pool
}

// Open connects to Postgres using dsn (DATABASE_URL) and verifies the
// connection. The caller must Close the returned Store. Callers should invoke
// Migrate before serving traffic.
func Open(ctx context.Context, dsn string) (*Store, error) {
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, fmt.Errorf("platformsvc: connect: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("platformsvc: ping: %w", err)
	}
	return &Store{pool: pool}, nil
}

// Pool exposes the underlying pool for advanced callers (e.g. tests). Domain
// code inside this package uses s.pool directly.
func (s *Store) Pool() *pgxpool.Pool { return s.pool }

// Close releases the connection pool.
func (s *Store) Close() { s.pool.Close() }
