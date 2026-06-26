package bandb

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// DefaultSchema holds the ban tables when no schema is configured. All ban
// tables live in a dedicated schema; statements are schema-qualified (rather
// than relying on search_path) so they resolve correctly even through a
// connection pooler that drops startup parameters.
const DefaultSchema = "pitwall"

// DB wraps a pgx connection pool for the ban store.
type DB struct {
	pool   *pgxpool.Pool
	schema string // configured schema name, e.g. "pitwall"
}

// table returns the schema-qualified, safely-quoted identifier for a ban table
// (e.g. `"pitwall"."banned_ips"`). pgx.Identifier.Sanitize keeps the
// configurable schema name safe from SQL injection.
func (db *DB) table(name string) string {
	return pgx.Identifier{db.schema, name}.Sanitize()
}

// Open connects to Postgres using dsn (DATABASE_URL) and verifies the
// connection. schema selects the Postgres schema that holds the ban tables; an
// empty schema falls back to DefaultSchema. The caller must Close the returned
// DB.
func Open(ctx context.Context, dsn, schema string) (*DB, error) {
	if schema == "" {
		schema = DefaultSchema
	}
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, fmt.Errorf("bandb: connect: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("bandb: ping: %w", err)
	}
	return &DB{pool: pool, schema: schema}, nil
}

// EnsureSchema creates the configured schema and ban tables if they do not
// exist (idempotent; replaces a migration tool for this single fixed schema).
// The DB role needs CREATE privilege on the database for the initial schema
// creation — point the schema at an existing one to skip that.
func (db *DB) EnsureSchema(ctx context.Context) error {
	stmts := []string{
		fmt.Sprintf(`CREATE SCHEMA IF NOT EXISTS %s`, pgx.Identifier{db.schema}.Sanitize()),
		fmt.Sprintf(`CREATE TABLE IF NOT EXISTS %s (
	nickname   TEXT PRIMARY KEY,
	reason     TEXT NOT NULL DEFAULT '',
	created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`, db.table("banned_nicknames")),
		fmt.Sprintf(`CREATE TABLE IF NOT EXISTS %s (
	ip         TEXT PRIMARY KEY,
	nickname   TEXT NOT NULL DEFAULT '',
	reason     TEXT NOT NULL DEFAULT '',
	created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`, db.table("banned_ips")),
	}
	for _, stmt := range stmts {
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
