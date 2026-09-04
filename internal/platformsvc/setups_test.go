package platformsvc

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

func intPtr(value int) *int { return &value }

func canonicalUTCTime(value time.Time) string { return value.UTC().Format(time.RFC3339) }

func optionalStringValue(value *string) string {
	if value == nil {
		return "<nil>"
	}
	return *value
}

func TestFormatOptionalTimeCanonicalUTC(t *testing.T) {
	value := time.Date(2026, time.September, 4, 19, 23, 45, 0, time.FixedZone("KST", 9*60*60))
	formatted := formatOptionalTime(&value)
	if formatted == nil || *formatted != "2026-09-04T10:23:45Z" {
		t.Fatalf("formatOptionalTime = %s, want 2026-09-04T10:23:45Z", optionalStringValue(formatted))
	}
	if formatOptionalTime(nil) != nil {
		t.Fatal("formatOptionalTime(nil) must remain nil")
	}
}

func TestValidateMySetupMetadataNameControlRules(t *testing.T) {
	allowed := UpdateMySetupRequest{Name: "Race\ttrim"}
	if err := validateMySetupMetadata(&allowed); err != nil {
		t.Fatalf("internal tab name rejected: %v", err)
	}
	if allowed.Name != "Race\ttrim" {
		t.Fatalf("internal tab name normalized to %q, want unchanged", allowed.Name)
	}

	for _, name := range []string{"Race\rtrim", "Race\ntrim", "Race\x00trim", "Race\u0085trim"} {
		req := UpdateMySetupRequest{Name: name}
		if err := validateMySetupMetadata(&req); !errors.Is(err, ErrBadUpload) {
			t.Fatalf("name %q validation error = %v, want ErrBadUpload", name, err)
		}
	}
}

func ingestMySetup(t *testing.T, store *Store, accountID, source string, trackID int, trackName, format string, setup *UploadSetup, recordedAt *time.Time, finishPosition *int) *UploadResult {
	t.Helper()
	req := UploadRequest{
		SourceRaceID: source,
		TrackID:      trackID,
		TrackName:    trackName,
		SessionType:  "Race",
		GameFormat:   format,
		Laps:         []UploadLap{vlap(1, 88000), vlap(2, 89000)},
		Setup:        setup,
		RecordedAt:   recordedAt,
	}
	if finishPosition != nil {
		req.FinishPosition = finishPosition
		req.SchemaVersion = 1
		req.Detail = &UploadDetail{FinalizeTrigger: "SEND"}
	}
	result, err := store.IngestRace(context.Background(), accountID, req)
	if err != nil {
		t.Fatalf("IngestRace(%s): %v", source, err)
	}
	return result
}

func TestMySetupsGroupHistoryMetadataAndOwnership(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	owner, _ := store.UpsertSteamAccount(ctx, steamA, "Owner", "")
	other, _ := store.UpsertSteamAccount(ctx, steamB, "Other", "")
	setup := setupFixture()
	first := time.Date(2026, time.September, 1, 8, 0, 0, 0, time.FixedZone("KST", 9*60*60))
	last := first.Add(2 * time.Hour)
	firstRace := ingestMySetup(t, store, owner, "same-setup-old", 10, "Monza", "F1 26", setup, &first, intPtr(3))
	lastRace := ingestMySetup(t, store, owner, "same-setup-new", 5, "Monaco", "F1 25", setup, &last, intPtr(2))
	// A different 23-value setup creates a separate group, even when all other
	// metadata is the same.
	otherSetup := *setup
	otherSetup.FrontWing++
	ingestMySetup(t, store, owner, "other-setup-legacy", 3, "Bahrain", "F1 26", &otherSetup, nil, nil)

	groups, err := store.ListMySetups(ctx, owner)
	if err != nil {
		t.Fatalf("ListMySetups: %v", err)
	}
	if len(groups) != 2 {
		t.Fatalf("groups = %#v, want two groups", groups)
	}
	group := groups[0]
	if group.UsageCount != 2 || group.LastTrackID != 5 || group.LastTrackName != "Monaco" || group.LastGameFormat != "F1 25" {
		t.Fatalf("group summary = %+v, want latest Monaco/F1 25 and usage 2", group)
	}
	if group.FirstRecordedAt == nil || *group.FirstRecordedAt != canonicalUTCTime(first) || group.LastRecordedAt == nil || *group.LastRecordedAt != canonicalUTCTime(last) {
		t.Fatalf("group timestamps = %s/%s, want %s/%s", optionalStringValue(group.FirstRecordedAt), optionalStringValue(group.LastRecordedAt), canonicalUTCTime(first), canonicalUTCTime(last))
	}
	if group.Params.FrontWing != setup.FrontWing || group.Params.FuelLoad != setup.FuelLoad {
		t.Fatalf("group params = %+v, want canonical owner params", group.Params)
	}
	if groups[1].FirstRecordedAt != nil || groups[1].LastRecordedAt != nil {
		t.Fatalf("legacy-only group timestamps = %v/%v, want nil/nil", groups[1].FirstRecordedAt, groups[1].LastRecordedAt)
	}
	if encoded, _ := json.Marshal(group); strings.Contains(string(encoded), "contentHash") || strings.Contains(string(encoded), "paramsCanonical") {
		t.Fatalf("owner response leaked grouping internals: %s", encoded)
	}

	detail, err := store.GetMySetup(ctx, owner, group.ID)
	if err != nil {
		t.Fatalf("GetMySetup: %v", err)
	}
	if len(detail.Races) != 2 || detail.Races[0].ID != lastRace.RaceID || detail.Races[1].ID != firstRace.RaceID {
		t.Fatalf("detail races = %+v, want newest-first same-setup history", detail.Races)
	}
	if detail.Races[0].RecordedAt == nil || *detail.Races[0].RecordedAt != canonicalUTCTime(last) ||
		detail.Races[0].FinishPosition == nil || *detail.Races[0].FinishPosition != 2 ||
		detail.Races[0].CompletedLaps == nil || *detail.Races[0].CompletedLaps != 2 ||
		detail.Races[0].BestLapMs == nil || *detail.Races[0].BestLapMs != 88000 {
		t.Fatalf("new race fields = %+v", detail.Races[0])
	}

	updated, err := store.UpdateMySetup(ctx, owner, group.ID, UpdateMySetupRequest{
		Name: "  Qualifying baseline  ", Rating: intPtr(5), Memo: "  stable through turn 8\n",
	})
	if err != nil {
		t.Fatalf("UpdateMySetup: %v", err)
	}
	updatedAt, err := time.Parse(time.RFC3339, updated.UpdatedAt)
	if updated.Name != "Qualifying baseline" || updated.Rating == nil || *updated.Rating != 5 || updated.Memo != "stable through turn 8" || err != nil || updated.UpdatedAt != canonicalUTCTime(updatedAt) {
		t.Fatalf("update result = %+v", updated)
	}
	if _, err := store.UpdateMySetup(ctx, other, group.ID, UpdateMySetupRequest{}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("foreign update = %v, want ErrNotFound", err)
	}
	if _, err := store.GetMySetup(ctx, other, group.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("foreign get = %v, want ErrNotFound", err)
	}
	if visible, err := store.HasMySetup(ctx, owner, group.ID); err != nil || !visible {
		t.Fatalf("owner setup visibility = %t/%v, want true/nil", visible, err)
	}
	if visible, err := store.HasMySetup(ctx, other, group.ID); err != nil || visible {
		t.Fatalf("foreign setup visibility = %t/%v, want false/nil", visible, err)
	}

	cleared, err := store.UpdateMySetup(ctx, owner, group.ID, UpdateMySetupRequest{Name: "", Rating: nil, Memo: ""})
	if err != nil || cleared.Name != "" || cleared.Rating != nil || cleared.Memo != "" {
		t.Fatalf("clear metadata = %+v/%v, want empty/null/empty", cleared, err)
	}
	for _, req := range []UpdateMySetupRequest{
		{Name: strings.Repeat("x", 81)},
		{Name: "bad\nname"},
		{Memo: "bad\x00memo"},
		{Rating: intPtr(6)},
	} {
		if _, err := store.UpdateMySetup(ctx, owner, group.ID, req); !errors.Is(err, ErrBadUpload) {
			t.Fatalf("invalid metadata %#v = %v, want ErrBadUpload", req, err)
		}
	}
}
