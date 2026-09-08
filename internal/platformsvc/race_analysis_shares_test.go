package platformsvc

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestRaceAnalysisShareLifecycleAndSetupPrivacy(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	owner, err := store.UpsertSteamAccount(ctx, steamA, "Owner", "")
	if err != nil {
		t.Fatal(err)
	}
	other, err := store.UpsertSteamAccount(ctx, steamB, "Other", "")
	if err != nil {
		t.Fatal(err)
	}
	_, request := readRaceAnalysisV2Fixture(t)
	request.Setup = &UploadSetup{FrontWing: 7, FrontCamber: -2.7345, FuelLoad: 13.25}
	result, err := store.IngestRace(ctx, owner, request)
	if err != nil {
		t.Fatal(err)
	}
	if share, err := store.GetMyRaceAnalysisShare(ctx, owner, result.RaceID); err != nil || share != nil {
		t.Fatalf("unshared race: %+v / %v", share, err)
	}
	if _, err := store.GetMyRaceAnalysisShare(ctx, other, result.RaceID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("foreign read: %v", err)
	}
	if _, err := store.SetMyRaceAnalysisShare(ctx, other, result.RaceID, true); !errors.Is(err, ErrNotFound) {
		t.Fatalf("foreign publish: %v", err)
	}
	if err := store.DeleteMyRaceAnalysisShare(ctx, other, result.RaceID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("foreign revoke: %v", err)
	}

	share, err := store.SetMyRaceAnalysisShare(ctx, owner, result.RaceID, false)
	if err != nil {
		t.Fatal(err)
	}
	assertPublic := func(wantSetup bool) {
		t.Helper()
		shared, err := store.GetSharedRaceAnalysis(ctx, share.Token)
		if err != nil {
			t.Fatal(err)
		}
		if shared.IncludeSetup != wantSetup || (shared.Setup != nil) != wantSetup || len(shared.Detail.Laps) != 1 {
			t.Fatalf("shared analysis: %+v", shared)
		}
		if wantSetup && shared.Setup.FrontWing != 7 {
			t.Fatalf("wrong setup: %+v", shared.Setup)
		}
		body, err := json.Marshal(shared)
		if err != nil {
			t.Fatal(err)
		}
		for _, key := range []string{`"playerSetup"`, `"content_hash"`, `"contentHash"`, `"params_canonical"`, `"payload"`, `"memo"`, `"rating"`, `"accountId"`, `"steamId64"`, `"sourceRaceId"`, `"frames"`} {
			if strings.Contains(string(body), key) {
				t.Fatalf("public detail leaked %s", key)
			}
		}
		if !wantSetup && (strings.Contains(string(body), `"setup"`) || strings.Contains(string(body), `"frontWing"`)) {
			t.Fatal("hidden setup leaked")
		}
		incident, err := store.GetSharedRaceAnalysisIncident(ctx, share.Token, 0)
		if err != nil || len(incident.Frames) != 2 {
			t.Fatalf("public replay: %+v / %v", incident, err)
		}
		body, _ = json.Marshal(incident)
		if strings.Contains(string(body), "frontWing") || strings.Contains(string(body), "playerSetup") {
			t.Fatal("setup leaked through replay")
		}
	}
	assertPublic(false)
	for _, visible := range []bool{true, false} {
		updated, err := store.SetMyRaceAnalysisShare(ctx, owner, result.RaceID, visible)
		if err != nil || updated.Token != share.Token {
			t.Fatalf("share update: %+v / %v", updated, err)
		}
		assertPublic(visible)
	}
	if err := store.DeleteMyRaceAnalysisShare(ctx, owner, result.RaceID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.GetSharedRaceAnalysis(ctx, share.Token); !errors.Is(err, ErrNotFound) {
		t.Fatalf("revoked detail: %v", err)
	}
	if _, err := store.GetSharedRaceAnalysisIncident(ctx, share.Token, 0); !errors.Is(err, ErrNotFound) {
		t.Fatalf("revoked replay: %v", err)
	}
	fresh, err := store.SetMyRaceAnalysisShare(ctx, owner, result.RaceID, false)
	if err != nil || fresh.Token == share.Token {
		t.Fatalf("recreated link reused token: %+v / %v", fresh, err)
	}
	if _, err := store.GetSharedRaceAnalysis(ctx, share.Token); !errors.Is(err, ErrNotFound) {
		t.Fatalf("old link resurrected: %v", err)
	}
	if _, err := store.GetSharedRaceAnalysisIncident(ctx, fresh.Token, 19); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing incident: %v", err)
	}
	if _, err := store.pool.Exec(ctx, `DELETE FROM platform.races WHERE id=$1`, result.RaceID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.GetSharedRaceAnalysis(ctx, fresh.Token); !errors.Is(err, ErrNotFound) {
		t.Fatalf("deleted race link: %v", err)
	}
}

func TestRaceAnalysisFiltersApplyBeforePagination(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	owner, err := store.UpsertSteamAccount(ctx, steamA, "Owner", "")
	if err != nil {
		t.Fatal(err)
	}
	other, err := store.UpsertSteamAccount(ctx, steamB, "Other", "")
	if err != nil {
		t.Fatal(err)
	}
	from := time.Date(2026, 9, 4, 0, 0, 0, 0, time.FixedZone("KST", 9*3600))
	before := from.Add(24 * time.Hour)
	insert := func(account, source, track, game, session string, at *time.Time, uploaded time.Time) string {
		t.Helper()
		var id string
		err := store.pool.QueryRow(ctx, `INSERT INTO platform.races (account_id, source_race_id, track_name, track_id, game_format, session_type, recorded_at, uploaded_at) VALUES ($1,$2,$3,10,$4,$5,$6,$7) RETURNING id::text`, account, source, track, game, session, at, uploaded).Scan(&id)
		if err != nil {
			t.Fatal(err)
		}
		return id
	}
	insert(owner, "newest", "Bahrain", "F1 26", "Race", &before, before)
	first := insert(owner, "start", "Monza", "F1 26", "Race", &from, from)
	last := before.Add(-time.Second)
	second := insert(owner, "end", "Monza", "F1 26", "Race", &last, last)
	insert(owner, "older", "Monza", "F1 25", "Race", &from, from)
	insert(owner, "qualy", "Monza", "F1 26", "Qualifying", &from, from)
	insert(other, "foreign", "Monza", "F1 26", "Race", &from, from)
	legacy := insert(owner, "legacy", "Monza", "F1 26", "Race", nil, from)
	filter := RaceAnalysisFilters{Search: "mOn", GameFormat: "F1 26", SessionType: "Race", From: &from, Before: &before}
	for offset, wantID := range []string{second, first, legacy} {
		page, err := store.ListMyRaceAnalyses(ctx, owner, 1, offset, filter)
		if err != nil || len(page.Items) != 1 || page.Items[0].ID != wantID {
			t.Fatalf("page %d: %+v / %v", offset, page, err)
		}
		if (page.NextOffset != nil) != (offset < 2) {
			t.Fatalf("page %d next offset: %v", offset, page.NextOffset)
		}
	}
	filter.Search = "%"
	page, err := store.ListMyRaceAnalyses(ctx, owner, 50, 0, filter)
	if err != nil || len(page.Items) != 0 {
		t.Fatalf("literal search: %+v / %v", page, err)
	}
}
