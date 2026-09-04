package platformsvc

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"frc.engineer/internal/rbac"
)

// TestMySetupsMigrationUpgrade exercises 011 on an explicitly separate,
// disposable database. It never falls back to PLATFORM_TEST_DATABASE_URL: the
// test drops the platform schema to reproduce an actual 001→011 upgrade and
// must therefore be enabled only with a clearly named upgrade database.
func TestMySetupsMigrationUpgrade(t *testing.T) {
	dsn := os.Getenv("PLATFORM_UPGRADE_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("PLATFORM_UPGRADE_TEST_DATABASE_URL not set; skipping destructive upgrade test")
	}
	config, err := pgx.ParseConfig(dsn)
	if err != nil {
		t.Fatalf("parse upgrade DSN: %v", err)
	}
	if !strings.Contains(strings.ToLower(config.Database), "upgrade") {
		t.Fatalf("refusing destructive upgrade test on database %q; name must contain upgrade", config.Database)
	}

	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatalf("connect upgrade DB: %v", err)
	}
	t.Cleanup(func() { conn.Close(context.Background()) })
	// Register schema cleanup before Store cleanup below so pooled connections
	// close first (Cleanup is LIFO) and cannot retain locks during DROP.
	t.Cleanup(func() {
		if _, err := conn.Exec(context.Background(), `DROP SCHEMA IF EXISTS platform CASCADE`); err != nil {
			t.Errorf("cleanup upgrade schema: %v", err)
		}
	})
	if _, err := conn.Exec(ctx, `DROP SCHEMA IF EXISTS platform CASCADE`); err != nil {
		t.Fatalf("reset upgrade schema: %v", err)
	}
	if _, err := conn.Exec(ctx, `CREATE SCHEMA platform`); err != nil {
		t.Fatalf("create upgrade schema: %v", err)
	}
	if _, err := conn.Exec(ctx, `CREATE TABLE platform.schema_migrations (
		name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`); err != nil {
		t.Fatalf("create upgrade bookkeeping: %v", err)
	}

	migrations, err := loadMigrations()
	if err != nil {
		t.Fatalf("load migrations: %v", err)
	}
	for _, migration := range migrations {
		if migration.name >= "011_my_setups.sql" {
			break
		}
		if err := applyMigration(ctx, conn, migration); err != nil {
			t.Fatalf("apply legacy migration %s: %v", migration.name, err)
		}
	}

	store, err := Open(ctx, dsn)
	if err != nil {
		t.Fatalf("open upgraded store: %v", err)
	}
	t.Cleanup(store.Close)
	owner, err := store.UpsertSteamAccount(ctx, "76561197960287930", "Upgrade Owner", "")
	if err != nil {
		t.Fatalf("create legacy owner: %v", err)
	}
	setup := UploadSetup{FrontWing: 5, RearWing: 7, FuelLoad: 10.5}
	canonical, hash, err := canonicalizeSetup(setup)
	if err != nil {
		t.Fatalf("canonicalize setup: %v", err)
	}
	committedSetup := setup
	committedSetup.FrontWing += 2
	committedCanonical, committedHash, err := canonicalizeSetup(committedSetup)
	if err != nil {
		t.Fatalf("canonicalize committed legacy setup: %v", err)
	}
	committedRaceID := insertLegacyRace(t, ctx, store.pool, owner, "upgrade-committed-legacy", 1, "Bahrain", "F1 26")
	if _, err := store.pool.Exec(ctx,
		`INSERT INTO platform.race_setup (race_id, params_canonical, content_hash) VALUES ($1, $2, $3)`,
		committedRaceID, committedCanonical, committedHash); err != nil {
		t.Fatalf("committed legacy setup insert: %v", err)
	}

	// This transaction is an old binary: it writes exactly the pre-011 race and
	// three-column race_setup lists, then remains uncommitted while migration
	// asks for ACCESS EXCLUSIVE on races.
	writer, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatalf("connect old writer: %v", err)
	}
	defer writer.Close(context.Background())
	writerTx, err := writer.Begin(ctx)
	if err != nil {
		t.Fatalf("begin old writer: %v", err)
	}
	writerCommitted := false
	defer func() {
		if !writerCommitted {
			_ = writerTx.Rollback(context.Background())
		}
	}()
	legacyRaceID := insertLegacyRace(t, ctx, writerTx, owner, "upgrade-old-writer", 10, "Monza", "F1 26")
	if _, err := writerTx.Exec(ctx,
		`INSERT INTO platform.race_setup (race_id, params_canonical, content_hash) VALUES ($1, $2, $3)`,
		legacyRaceID, canonical, hash); err != nil {
		t.Fatalf("old writer setup insert: %v", err)
	}
	var beforeRows int
	if err := conn.QueryRow(ctx, `SELECT count(*) FROM platform.race_setup`).Scan(&beforeRows); err != nil {
		t.Fatalf("read-only legacy race_setup count: %v", err)
	}
	if beforeRows != 1 {
		t.Fatalf("pre-011 committed race_setup rows = %d, want 1", beforeRows)
	}
	t.Logf("pre-011 committed race_setup rows: %d", beforeRows)

	migrationCtx, cancelMigration := context.WithTimeout(ctx, 60*time.Second)
	defer cancelMigration()
	migrationDone := make(chan error, 1)
	started := time.Now()
	go func() { migrationDone <- store.Migrate(migrationCtx) }()

	if !waitForMigrationRaceLock(ctx, conn, 3*time.Second) {
		// Commit before failing so the migration goroutine cannot be stranded on
		// the deliberately held old-writer lock.
		if err := writerTx.Commit(ctx); err != nil {
			t.Fatalf("commit old writer after lock observation failure: %v", err)
		}
		writerCommitted = true
		if err := <-migrationDone; err != nil {
			t.Fatalf("migration after lock observation failure: %v", err)
		}
		t.Fatal("011 did not visibly wait for ACCESS EXCLUSIVE races lock")
	}
	if err := writerTx.Commit(ctx); err != nil {
		t.Fatalf("commit old writer: %v", err)
	}
	writerCommitted = true
	if err := <-migrationDone; err != nil {
		t.Fatalf("apply 011 through Store.Migrate: %v", err)
	}
	if elapsed := time.Since(started); elapsed >= 60*time.Second {
		t.Fatalf("011 upgrade took %s, exceeds platform's 60s migration timeout", elapsed)
	} else {
		t.Logf("011 upgrade duration: %s", elapsed)
	}

	var groupCount int
	if err := store.pool.QueryRow(ctx, `
		SELECT count(*) FROM platform.setup_groups
		WHERE account_id = $1 AND content_hash = $2 AND params_canonical = $3`, owner, hash, canonical,
	).Scan(&groupCount); err != nil || groupCount != 1 {
		t.Fatalf("backfilled old writer group = %d/%v, want 1/nil", groupCount, err)
	}
	if err := store.pool.QueryRow(ctx, `
		SELECT count(*) FROM platform.setup_groups
		WHERE account_id = $1 AND content_hash = $2 AND params_canonical = $3`, owner, committedHash, committedCanonical,
	).Scan(&groupCount); err != nil || groupCount != 1 {
		t.Fatalf("backfilled committed legacy group = %d/%v, want 1/nil", groupCount, err)
	}
	var legacyRecordedAt *time.Time
	var legacyFinish, legacyLaps *int
	if err := store.pool.QueryRow(ctx, `
		SELECT recorded_at, finish_position, completed_laps FROM platform.races WHERE id = $1`, legacyRaceID,
	).Scan(&legacyRecordedAt, &legacyFinish, &legacyLaps); err != nil || legacyRecordedAt != nil || legacyFinish != nil || legacyLaps != nil {
		t.Fatalf("legacy nullable fields = %v/%v/%v/%v, want nil/nil/nil/nil", legacyRecordedAt, legacyFinish, legacyLaps, err)
	}

	// A post-migration old-format writer has no knowledge of setup_groups; the
	// AFTER INSERT trigger must create the distinct canonical group itself.
	secondSetup := setup
	secondSetup.FrontWing++
	secondCanonical, secondHash, err := canonicalizeSetup(secondSetup)
	if err != nil {
		t.Fatalf("canonicalize second setup: %v", err)
	}
	postRaceID := insertLegacyRace(t, ctx, store.pool, owner, "upgrade-post-trigger", 5, "Monaco", "F1 26")
	if _, err := store.pool.Exec(ctx,
		`INSERT INTO platform.race_setup (race_id, params_canonical, content_hash) VALUES ($1, $2, $3)`,
		postRaceID, secondCanonical, secondHash); err != nil {
		t.Fatalf("post-upgrade three-column setup insert: %v", err)
	}
	if err := store.pool.QueryRow(ctx, `
		SELECT count(*) FROM platform.setup_groups
		WHERE account_id = $1 AND content_hash = $2 AND params_canonical = $3`, owner, secondHash, secondCanonical,
	).Scan(&groupCount); err != nil || groupCount != 1 {
		t.Fatalf("trigger-created group = %d/%v, want 1/nil", groupCount, err)
	}

	if _, err := store.CreateRole(ctx, "upgrade-helper", ""); err != nil {
		t.Fatalf("create helper role: %v", err)
	}
	if err := store.SetRolePermissions(ctx, "upgrade-helper", []string{rbac.PermRaceUpdate}); err != nil {
		t.Fatalf("grant pithub.race.update: %v", err)
	}
	if err := store.SetRolePermissions(ctx, "upgrade-helper", []string{"pithub.race.delete"}); !errors.Is(err, ErrBadUpload) {
		t.Fatalf("unknown pithub.race.delete = %v, want ErrBadUpload", err)
	}

	// New uploads derive completed_laps server-side and establish the recorded
	// timestamp MIN/MAX independently of the legacy NULL row above.
	first := time.Date(2026, time.September, 1, 9, 0, 0, 0, time.UTC)
	last := first.Add(time.Hour)
	finish := 2
	for _, tc := range []struct {
		source   string
		recorded time.Time
	}{
		{"upgrade-recorded-first", first},
		{"upgrade-recorded-last", last},
	} {
		if _, err := store.IngestRace(ctx, owner, UploadRequest{
			SourceRaceID: tc.source, TrackID: 10, TrackName: "Monza", SessionType: "Race", GameFormat: "F1 26",
			Laps: []UploadLap{vlap(1, 88000), vlap(2, 89000)}, Setup: &setup, RecordedAt: &tc.recorded,
			FinishPosition: &finish, SchemaVersion: 1, Detail: &UploadDetail{FinalizeTrigger: "SEND"},
		}); err != nil {
			t.Fatalf("ingest %s: %v", tc.source, err)
		}
	}
	groups, err := store.ListMySetups(ctx, owner)
	if err != nil {
		t.Fatalf("list upgraded groups: %v", err)
	}
	var primary *PlatformMySetupSummary
	for i := range groups {
		if groups[i].Params.FrontWing == setup.FrontWing {
			primary = &groups[i]
			break
		}
	}
	if primary == nil || primary.FirstRecordedAt == nil || primary.LastRecordedAt == nil ||
		*primary.FirstRecordedAt != canonicalUTCTime(first) || *primary.LastRecordedAt != canonicalUTCTime(last) {
		t.Fatalf("recorded timestamp min/max = %+v, want %s/%s", primary, canonicalUTCTime(first), canonicalUTCTime(last))
	}
	other, err := store.UpsertSteamAccount(ctx, "76561197960287931", "Upgrade Other", "")
	if err != nil {
		t.Fatalf("create other owner: %v", err)
	}
	if _, err := store.GetMySetup(ctx, other, primary.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-owner setup detail = %v, want ErrNotFound", err)
	}
	if _, err := store.pool.Exec(ctx, `UPDATE platform.races SET finish_position = 25 WHERE id = $1`, postRaceID); err == nil {
		t.Fatal("finish_position CHECK accepted 25")
	}
	if _, err := store.pool.Exec(ctx, `UPDATE platform.races SET completed_laps = 0 WHERE id = $1`, postRaceID); err == nil {
		t.Fatal("completed_laps CHECK accepted zero")
	}
}

type legacyRaceInserter interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

func insertLegacyRace(t *testing.T, ctx context.Context, querier legacyRaceInserter, accountID, source string, trackID int, trackName, format string) string {
	t.Helper()
	var id string
	if err := querier.QueryRow(ctx, `
		INSERT INTO platform.races
		    (account_id, source_race_id, track_id, track_name, session_type, game_format, plausible)
		VALUES ($1, $2, $3, $4, 'Race', $5, true)
		RETURNING id`, accountID, source, trackID, trackName, format,
	).Scan(&id); err != nil {
		t.Fatalf("insert legacy race %s: %v", source, err)
	}
	return id
}

func waitForMigrationRaceLock(ctx context.Context, conn *pgx.Conn, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		var waiting bool
		err := conn.QueryRow(ctx, `
			SELECT EXISTS (
				SELECT 1
				FROM pg_locks l
				JOIN pg_class c ON c.oid = l.relation
				JOIN pg_namespace n ON n.oid = c.relnamespace
				WHERE n.nspname = 'platform' AND c.relname = 'races'
				  AND l.mode = 'AccessExclusiveLock' AND NOT l.granted
			)`).Scan(&waiting)
		if err == nil && waiting {
			return true
		}
		time.Sleep(10 * time.Millisecond)
	}
	return false
}
