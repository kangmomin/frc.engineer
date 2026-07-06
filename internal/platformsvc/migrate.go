package platformsvc

import (
	"context"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"fmt"
	"io/fs"
	"sort"

	"github.com/jackc/pgx/v5"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

// migrationLockKey is a fixed advisory-lock key (arbitrary constant). The
// migration runner holds this session-level lock for the whole run so that two
// instances booting concurrently (rolling redeploy) serialize instead of racing
// each other's DDL.
const migrationLockKey int64 = 0x706c6174666f726d // "platform"

type migration struct {
	name     string // filename, e.g. "001_init.sql"
	body     string
	checksum string // sha256 hex of body
}

// loadMigrations reads and sorts the embedded migration files. Files apply in
// lexicographic filename order (001_, 002_, …).
func loadMigrations() ([]migration, error) {
	entries, err := fs.ReadDir(migrationsFS, "migrations")
	if err != nil {
		return nil, fmt.Errorf("platformsvc: read migrations dir: %w", err)
	}
	var out []migration
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		body, err := migrationsFS.ReadFile("migrations/" + e.Name())
		if err != nil {
			return nil, fmt.Errorf("platformsvc: read migration %s: %w", e.Name(), err)
		}
		sum := sha256.Sum256(body)
		out = append(out, migration{
			name:     e.Name(),
			body:     string(body),
			checksum: hex.EncodeToString(sum[:]),
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].name < out[j].name })
	return out, nil
}

// Migrate applies all pending embedded migrations. It is safe to call on every
// boot and safe to run concurrently across instances (serialized by an advisory
// lock). Each migration runs in its own transaction together with its
// schema_migrations bookkeeping row, so a failure leaves the DB at a clean
// version boundary. Editing an already-applied migration is detected via
// checksum and hard-fails.
//
// v1 migrations must be transaction-safe DDL only (no CREATE INDEX
// CONCURRENTLY).
func (s *Store) Migrate(ctx context.Context) error {
	migs, err := loadMigrations()
	if err != nil {
		return err
	}

	// Dedicated connection: pg_advisory_lock is session-scoped, so the lock must
	// live on the same connection across every per-migration transaction.
	conn, err := s.pool.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("platformsvc: migrate acquire conn: %w", err)
	}
	defer conn.Release()

	if _, err := conn.Exec(ctx, `SELECT pg_advisory_lock($1)`, migrationLockKey); err != nil {
		return fmt.Errorf("platformsvc: migrate lock: %w", err)
	}
	defer func() {
		// Best-effort unlock; the lock also auto-releases when the conn closes.
		_, _ = conn.Exec(context.Background(), `SELECT pg_advisory_unlock($1)`, migrationLockKey)
	}()

	// Bootstrap the schema and the bookkeeping table (idempotent, outside the
	// numbered migrations so version 001 can already assume they exist).
	if _, err := conn.Exec(ctx, `CREATE SCHEMA IF NOT EXISTS `+Schema); err != nil {
		return fmt.Errorf("platformsvc: create schema: %w", err)
	}
	if _, err := conn.Exec(ctx, `CREATE TABLE IF NOT EXISTS `+Schema+`.schema_migrations (
	name        TEXT PRIMARY KEY,
	checksum    TEXT NOT NULL,
	applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
)`); err != nil {
		return fmt.Errorf("platformsvc: create schema_migrations: %w", err)
	}

	// Load the record of applied migrations for checksum verification.
	applied := map[string]string{}
	rows, err := conn.Query(ctx, `SELECT name, checksum FROM `+Schema+`.schema_migrations`)
	if err != nil {
		return fmt.Errorf("platformsvc: read schema_migrations: %w", err)
	}
	for rows.Next() {
		var name, sum string
		if err := rows.Scan(&name, &sum); err != nil {
			rows.Close()
			return fmt.Errorf("platformsvc: scan schema_migrations: %w", err)
		}
		applied[name] = sum
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return fmt.Errorf("platformsvc: iterate schema_migrations: %w", err)
	}

	for _, m := range migs {
		if prev, ok := applied[m.name]; ok {
			if prev != m.checksum {
				return fmt.Errorf("platformsvc: migration %s was edited after being applied (checksum mismatch)", m.name)
			}
			continue // already applied, unchanged
		}
		if err := applyMigration(ctx, conn.Conn(), m); err != nil {
			return err
		}
	}
	return nil
}

// applyMigration runs a single migration and records it in schema_migrations
// inside one transaction.
func applyMigration(ctx context.Context, conn *pgx.Conn, m migration) error {
	tx, err := conn.Begin(ctx)
	if err != nil {
		return fmt.Errorf("platformsvc: begin migration %s: %w", m.name, err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // no-op after successful Commit

	if _, err := tx.Exec(ctx, m.body); err != nil {
		return fmt.Errorf("platformsvc: apply migration %s: %w", m.name, err)
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO `+Schema+`.schema_migrations (name, checksum) VALUES ($1, $2)`,
		m.name, m.checksum,
	); err != nil {
		return fmt.Errorf("platformsvc: record migration %s: %w", m.name, err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("platformsvc: commit migration %s: %w", m.name, err)
	}
	return nil
}
