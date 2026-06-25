package bandb

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// All ban tables live in the dedicated "pitwall" schema. Statements are
// schema-qualified (rather than relying on search_path) so they resolve
// correctly even through a connection pooler that drops startup parameters.
//
// Schema statements are issued individually (pgx's extended protocol does not
// support multi-statement Exec).
const (
	createSchema = `CREATE SCHEMA IF NOT EXISTS pitwall`

	createNicknamesTable = `CREATE TABLE IF NOT EXISTS pitwall.banned_nicknames (
	nickname   TEXT PRIMARY KEY,
	reason     TEXT NOT NULL DEFAULT '',
	created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`
	createIPsTable = `CREATE TABLE IF NOT EXISTS pitwall.banned_ips (
	ip         TEXT PRIMARY KEY,
	nickname   TEXT NOT NULL DEFAULT '',
	reason     TEXT NOT NULL DEFAULT '',
	created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`
)

// DB wraps a pgx connection pool for the ban store.
type DB struct {
	pool *pgxpool.Pool
}

// Open connects to Postgres using dsn (DATABASE_URL) and verifies the
// connection. The caller must Close the returned DB.
func Open(ctx context.Context, dsn string) (*DB, error) {
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, fmt.Errorf("bandb: connect: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("bandb: ping: %w", err)
	}
	return &DB{pool: pool}, nil
}

// EnsureSchema creates the pitwall schema and ban tables if they do not exist
// (idempotent; replaces a migration tool for this single fixed schema). The DB
// role needs CREATE privilege on the database for the initial schema creation.
func (db *DB) EnsureSchema(ctx context.Context) error {
	for _, stmt := range []string{createSchema, createNicknamesTable, createIPsTable} {
		if _, err := db.pool.Exec(ctx, stmt); err != nil {
			return fmt.Errorf("bandb: ensure schema: %w", err)
		}
	}
	return nil
}

// Close releases the connection pool.
func (db *DB) Close() {
	db.pool.Close()
}
