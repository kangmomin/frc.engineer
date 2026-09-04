package platformsvc

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func TestDriverProfileJSONContract(t *testing.T) {
	profile := DriverProfile{
		AccountID: "account-id",
		Persona:   "Driver",
		AvatarURL: "https://avatar.example/driver.png",
		Verified:  true,
		Summary:   ProfileSummary{},
		Tracks:    []ProfileTrack{},
	}
	data, err := json.Marshal(profile)
	if err != nil {
		t.Fatalf("marshal empty profile: %v", err)
	}
	if !strings.Contains(string(data), `"tracks":[]`) {
		t.Fatalf("empty tracks must serialize as [], got %s", data)
	}

	profile.Tracks = []ProfileTrack{{
		TrackID:    5,
		TrackName:  "Monaco",
		GameFormat: "F1 26",
		TimeTrial:  ProfileTimeTrial{Rank: 1, Participants: 1, LapMS: 70000, S1MS: 23000, S2MS: 23000, S3MS: 24000},
		RacePace:   nil,
	}}
	data, err = json.Marshal(profile)
	if err != nil {
		t.Fatalf("marshal profile: %v", err)
	}
	text := string(data)
	if !strings.Contains(text, `"racePace":null`) {
		t.Fatalf("missing pace must serialize as null, got %s", data)
	}
	for _, forbidden := range []string{"steamId", "raceId", "session", "source", "raceDetail", "track_name"} {
		if strings.Contains(strings.ToLower(text), strings.ToLower(forbidden)) {
			t.Fatalf("profile exposed forbidden field %q: %s", forbidden, data)
		}
	}
}

func TestDriverProfileCanonicalMetricsAndFullRanks(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	target, err := store.UpsertSteamAccount(ctx, steamA, "Target", "https://avatar.example/target.png")
	if err != nil {
		t.Fatalf("create target: %v", err)
	}
	if _, err := store.pool.Exec(ctx, `UPDATE platform.accounts SET verified_at = now() WHERE id = $1`, target); err != nil {
		t.Fatalf("verify target: %v", err)
	}

	var earlyRace, lateRace string
	if err := store.pool.QueryRow(ctx, `
		INSERT INTO platform.races (account_id, source_race_id, track_id, track_name, session_type, game_format, plausible, uploaded_at)
		VALUES ($1, 'target-early', 5, 'untrusted stored name', 'TT', 'F1 26', true, now() - interval '1 hour')
		RETURNING id`, target).Scan(&earlyRace); err != nil {
		t.Fatalf("insert early target race: %v", err)
	}
	if err := store.pool.QueryRow(ctx, `
		INSERT INTO platform.races (account_id, source_race_id, track_id, track_name, session_type, game_format, plausible, uploaded_at)
		VALUES ($1, 'target-late', 5, 'also untrusted', 'TT', 'F1 26', true, now())
		RETURNING id`, target).Scan(&lateRace); err != nil {
		t.Fatalf("insert late target race: %v", err)
	}
	if _, err := store.pool.Exec(ctx, `
		INSERT INTO platform.laps (race_id, lap_number, lap_ms, s1_ms, s2_ms, s3_ms, tyre, valid) VALUES
		($1, 1, 100000, 30000, 30000, 40000, 'Soft', true),
		($1, 2, 100000, 30000, 30000, 40000, 'Soft', true),
		($1, 3, 100000, 30000, 30000, 40000, 'Soft', true),
		($1, 4, 100000, 30000, 30000, 40000, 'Soft', true),
		($1, 5, 100000, 30000, 30000, 40000, 'Soft', true),
		($2, 1, 100000, 31000, 31000, 38000, 'Medium', true)`, earlyRace, lateRace); err != nil {
		t.Fatalf("insert target laps: %v", err)
	}

	// 201 faster competitors prove ranks/participants use the complete population,
	// rather than the public leaderboard's 200-row response cap.
	if _, err := store.pool.Exec(ctx, `
		WITH new_accounts AS (
			INSERT INTO platform.accounts (persona, kind, verified_at)
			SELECT 'Competitor' || n, 'user', now() FROM generate_series(1, 201) AS n
			RETURNING id, persona
		), new_races AS (
			INSERT INTO platform.races (account_id, source_race_id, track_id, track_name, session_type, game_format, plausible)
			SELECT id, 'bulk-' || persona, 5, 'ignored', 'Race', 'F1 26', true FROM new_accounts
			RETURNING id, account_id
		)
		INSERT INTO platform.laps (race_id, lap_number, lap_ms, s1_ms, s2_ms, s3_ms, tyre, valid)
		SELECT r.id, lap.n, 80000 + substring(a.persona from 11)::int,
		       26000, 26000, 28000 + substring(a.persona from 11)::int, 'Soft', true
		FROM new_races r
		JOIN new_accounts a ON a.id = r.account_id
		CROSS JOIN generate_series(1, 5) AS lap(n)`); err != nil {
		t.Fatalf("bulk insert competitors: %v", err)
	}
	// A faster banned account must not affect either population.
	var banned string
	if err := store.pool.QueryRow(ctx, `
		INSERT INTO platform.accounts (persona, kind, verified_at) VALUES ('Banned', 'user', now()) RETURNING id`).Scan(&banned); err != nil {
		t.Fatalf("insert banned account: %v", err)
	}
	var bannedRace string
	if err := store.pool.QueryRow(ctx, `
		INSERT INTO platform.races (account_id, source_race_id, track_id, track_name, session_type, game_format, plausible)
		VALUES ($1, 'banned-race', 5, 'ignored', 'Race', 'F1 26', true) RETURNING id`, banned).Scan(&bannedRace); err != nil {
		t.Fatalf("insert banned race: %v", err)
	}
	if _, err := store.pool.Exec(ctx, `INSERT INTO platform.account_bans (account_id, reason) VALUES ($1, 'test')`, banned); err != nil {
		t.Fatalf("ban competitor: %v", err)
	}
	if _, err := store.pool.Exec(ctx, `
		INSERT INTO platform.laps (race_id, lap_number, lap_ms, s1_ms, s2_ms, s3_ms, tyre, valid)
		SELECT $1, n, 70000, 23000, 23000, 24000, 'Soft', true FROM generate_series(1, 5) AS n`, bannedRace); err != nil {
		t.Fatalf("insert banned laps: %v", err)
	}

	profile, err := store.DriverProfile(ctx, target)
	if err != nil {
		t.Fatalf("DriverProfile: %v", err)
	}
	if profile.Persona != "Target" || profile.AvatarURL != "https://avatar.example/target.png" || !profile.Verified {
		t.Fatalf("identity = %+v", profile)
	}
	if got, want := profile.Summary, (ProfileSummary{VerifiedRaces: 2, ValidLaps: 6, TrackFormats: 1}); got != want {
		t.Fatalf("summary = %+v, want %+v", got, want)
	}
	if len(profile.Tracks) != 1 {
		t.Fatalf("tracks = %+v, want one canonical pair", profile.Tracks)
	}
	track := profile.Tracks[0]
	if track.TrackID != 5 || track.TrackName != "Monaco" || track.GameFormat != "F1 26" {
		t.Fatalf("track identity = %+v", track)
	}
	if got, want := track.TimeTrial, (ProfileTimeTrial{Rank: 202, Participants: 202, LapMS: 100000, S1MS: 30000, S2MS: 30000, S3MS: 40000}); got != want {
		t.Fatalf("time trial = %+v, want %+v", got, want)
	}
	if track.RacePace == nil {
		t.Fatal("target with six valid laps must have pace")
	}
	if track.RacePace.Rank != 202 || track.RacePace.Participants != 202 || track.RacePace.AvgMS != 100000 || track.RacePace.Laps != 6 || track.RacePace.Tyre != "Soft" {
		t.Fatalf("race pace = %+v", track.RacePace)
	}
}

func TestDriverProfileEligibilityAndEmptyData(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	empty, _ := store.UpsertSteamAccount(ctx, steamA, "Empty", "")
	if _, err := store.pool.Exec(ctx, `UPDATE platform.accounts SET verified_at = now() WHERE id = $1`, empty); err != nil {
		t.Fatalf("verify empty: %v", err)
	}
	profile, err := store.DriverProfile(ctx, empty)
	if err != nil {
		t.Fatalf("empty eligible profile: %v", err)
	}
	if profile.Summary != (ProfileSummary{}) || len(profile.Tracks) != 0 || profile.Tracks == nil {
		t.Fatalf("empty profile = %+v", profile)
	}

	unverified, _ := store.UpsertSteamAccount(ctx, steamB, "Unverified", "")
	if _, err := store.DriverProfile(ctx, unverified); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unverified profile err = %v, want ErrNotFound", err)
	}
	if _, err := store.pool.Exec(ctx, `INSERT INTO platform.account_bans (account_id, reason) VALUES ($1, 'test')`, empty); err != nil {
		t.Fatalf("ban empty: %v", err)
	}
	if _, err := store.DriverProfile(ctx, empty); !errors.Is(err, ErrNotFound) {
		t.Fatalf("banned profile err = %v, want ErrNotFound", err)
	}
}

func TestDriverProfileCanonicalPairsRemainFormatSpecific(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	target, err := store.UpsertSteamAccount(ctx, steamB, "Formats", "")
	if err != nil {
		t.Fatalf("create target: %v", err)
	}
	if _, err := store.pool.Exec(ctx, `UPDATE platform.accounts SET verified_at = now() WHERE id = $1`, target); err != nil {
		t.Fatalf("verify target: %v", err)
	}
	for _, race := range []struct {
		source string
		track  int
		format string
	}{
		{source: "monaco-25", track: 5, format: "F1 25"},
		{source: "monaco-26", track: 5, format: "F1 26"},
		{source: "unsupported", track: 39, format: "F1 25"},
	} {
		var raceID string
		if err := store.pool.QueryRow(ctx, `
			INSERT INTO platform.races (account_id, source_race_id, track_id, track_name, session_type, game_format, plausible)
			VALUES ($1, $2, $3, 'forged stored name', 'Race', $4, true)
			RETURNING id`, target, race.source, race.track, race.format).Scan(&raceID); err != nil {
			t.Fatalf("insert %s: %v", race.source, err)
		}
		if _, err := store.pool.Exec(ctx, `
			INSERT INTO platform.laps (race_id, lap_number, lap_ms, s1_ms, s2_ms, s3_ms, tyre, valid)
			VALUES ($1, 1, 90000, 30000, 30000, 30000, 'Soft', true)`, raceID); err != nil {
			t.Fatalf("insert %s lap: %v", race.source, err)
		}
	}

	profile, err := store.DriverProfile(ctx, target)
	if err != nil {
		t.Fatalf("DriverProfile: %v", err)
	}
	if !profile.Verified || profile.Summary != (ProfileSummary{VerifiedRaces: 2, ValidLaps: 2, TrackFormats: 2}) {
		t.Fatalf("profile = %+v", profile)
	}
	if len(profile.Tracks) != 2 {
		t.Fatalf("tracks = %+v, want two canonical Monaco formats", profile.Tracks)
	}
	for i, format := range []string{"F1 25", "F1 26"} {
		track := profile.Tracks[i]
		if track.TrackID != 5 || track.TrackName != "Monaco" || track.GameFormat != format || track.RacePace != nil {
			t.Fatalf("track[%d] = %+v", i, track)
		}
	}
}
