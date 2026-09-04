package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"frc.engineer/internal/platformsvc"
)

func TestMySetupHandlersUnauthenticatedAreNoStore(t *testing.T) {
	srv := &server{}
	for _, handler := range []http.HandlerFunc{srv.handleMySetups, srv.handleMySetup, srv.handleUpdateMySetup} {
		rec := httptest.NewRecorder()
		handler(rec, httptest.NewRequest(http.MethodGet, "/me/setups/not-a-uuid", nil))
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
		}
		if got := rec.Header().Get("Cache-Control"); got != "no-store" {
			t.Fatalf("Cache-Control = %q, want no-store", got)
		}
	}
}

func TestDecodeMySetupUpdateBodyStrict(t *testing.T) {
	decode := func(body string) (platformsvc.UpdateMySetupRequest, error) {
		t.Helper()
		return decodeMySetupUpdateBody(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, "/me/setups/x", bytes.NewBufferString(body)))
	}
	valid, err := decode(`{"name":"Name","rating":null,"memo":"A\nB"}`)
	if err != nil || valid.Name != "Name" || valid.Rating != nil || valid.Memo != "A\nB" {
		t.Fatalf("valid decode = %+v/%v", valid, err)
	}
	for _, body := range []string{
		`null`,
		`[]`,
		`{"name":"x","rating":null}`,
		`{"name":null,"rating":null,"memo":"x"}`,
		`{"name":"x","rating":1.5,"memo":"x"}`,
		`{"name":"x","rating":null,"memo":"x","unknown":true}`,
		`{"name":"x","rating":null,"memo":"x"} {}`,
	} {
		if _, err := decode(body); err == nil {
			t.Fatalf("decode(%s) succeeded, want strict rejection", body)
		}
	}
}

func TestMySetupHandlersAuthorizationAndContract(t *testing.T) {
	dsn := os.Getenv("PLATFORM_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("PLATFORM_TEST_DATABASE_URL not set; skipping DB integration test")
	}
	ctx := context.Background()
	store, err := platformsvc.Open(ctx, dsn)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(store.Close)
	if err := store.Migrate(ctx); err != nil {
		t.Fatalf("Migrate: %v", err)
	}

	steamBase := 70_000_000_000_000_000 + time.Now().UnixNano()%100_000_000_000_000
	owner, err := store.UpsertSteamAccount(ctx, fmt.Sprintf("%017d", steamBase), "Setup Owner", "")
	if err != nil {
		t.Fatalf("owner: %v", err)
	}
	other, err := store.UpsertSteamAccount(ctx, fmt.Sprintf("%017d", steamBase+1), "Setup Other", "")
	if err != nil {
		t.Fatalf("other: %v", err)
	}
	t.Cleanup(func() {
		for _, id := range []string{owner, other} {
			if _, err := store.Pool().Exec(context.Background(), `DELETE FROM platform.accounts WHERE id = $1`, id); err != nil {
				t.Errorf("cleanup account %s: %v", id, err)
			}
		}
	})
	recordedAt := time.Date(2026, time.September, 4, 19, 23, 45, 0, time.FixedZone("KST", 9*60*60))
	wantRecordedAt := recordedAt.UTC().Format(time.RFC3339)
	finish := 1
	res, err := store.IngestRace(ctx, owner, platformsvc.UploadRequest{
		SourceRaceID: "handler-my-setup", TrackID: 10, TrackName: "Monza", SessionType: "Race", GameFormat: "F1 26",
		Laps:  []platformsvc.UploadLap{{LapNumber: 1, LapMs: 88000, S1Ms: 29333, S2Ms: 29333, S3Ms: 29334, Valid: true}},
		Setup: &platformsvc.UploadSetup{FrontWing: 5, FuelLoad: 10.5}, RecordedAt: &recordedAt,
		FinishPosition: &finish, SchemaVersion: 1, Detail: &platformsvc.UploadDetail{FinalizeTrigger: "SEND"},
	})
	if err != nil || res.RaceID == "" {
		t.Fatalf("IngestRace = %+v/%v", res, err)
	}
	ownerToken, _ := store.CreateSession(ctx, owner, platformsvc.ScopeWeb, time.Minute)
	otherToken, _ := store.CreateSession(ctx, other, platformsvc.ScopeWeb, time.Minute)
	uploadToken, _ := store.CreateSession(ctx, owner, platformsvc.ScopeUpload, time.Minute)

	srv := &server{store: store, log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /races", srv.handleUpload)
	mux.HandleFunc("GET /me/setups", srv.handleMySetups)
	mux.HandleFunc("GET /me/setups/{id}", srv.handleMySetup)
	mux.HandleFunc("POST /me/setups/{id}", srv.handleUpdateMySetup)
	request := func(method, target, token, body string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, target, bytes.NewBufferString(body))
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		if got := rec.Header().Get("Cache-Control"); got != "no-store" {
			t.Fatalf("%s %s Cache-Control = %q, want no-store", method, target, got)
		}
		return rec
	}
	uploadReq := httptest.NewRequest(http.MethodPost, "/races", bytes.NewBufferString(`{
		"sourceRaceId":"handler-legacy-upload","trackId":11,"trackName":"Bahrain","sessionType":"Race","gameFormat":"F1 26",
		"laps":[
			{"lapNumber":1,"lapMs":88000,"s1Ms":29333,"s2Ms":29333,"s3Ms":29334,"valid":true},
			{"lapNumber":2,"lapMs":89000,"s1Ms":29666,"s2Ms":29666,"s3Ms":29668,"valid":true}
		],"setup":{"frontWing":5,"fuelLoad":10.5}
	}`))
	uploadReq.Header.Set("Authorization", "Bearer "+uploadToken)
	legacyUpload := httptest.NewRecorder()
	mux.ServeHTTP(legacyUpload, uploadReq)
	if legacyUpload.Code != http.StatusOK {
		t.Fatalf("legacy upload status = %d; body=%s", legacyUpload.Code, legacyUpload.Body.String())
	}
	var legacyResult platformsvc.UploadResult
	if err := json.Unmarshal(legacyUpload.Body.Bytes(), &legacyResult); err != nil || legacyResult.RaceID == "" {
		t.Fatalf("legacy upload response = %+v/%v", legacyResult, err)
	}

	list := request(http.MethodGet, "/me/setups", ownerToken, "")
	if list.Code != http.StatusOK {
		t.Fatalf("list status = %d; body=%s", list.Code, list.Body.String())
	}
	var groups []platformsvc.PlatformMySetupSummary
	if err := json.Unmarshal(list.Body.Bytes(), &groups); err != nil || len(groups) != 1 {
		t.Fatalf("list decode = %#v/%v", groups, err)
	}
	if groups[0].FirstRecordedAt == nil || *groups[0].FirstRecordedAt != wantRecordedAt ||
		groups[0].LastRecordedAt == nil || *groups[0].LastRecordedAt != wantRecordedAt {
		t.Fatalf("list timestamps = %v/%v, want %s/%s", groups[0].FirstRecordedAt, groups[0].LastRecordedAt, wantRecordedAt, wantRecordedAt)
	}
	setupID := groups[0].ID
	detail := request(http.MethodGet, "/me/setups/"+setupID, ownerToken, "")
	if detail.Code != http.StatusOK {
		t.Fatalf("detail status = %d; body=%s", detail.Code, detail.Body.String())
	}
	var decoded platformsvc.PlatformMySetupDetail
	if err := json.Unmarshal(detail.Body.Bytes(), &decoded); err != nil || len(decoded.Races) != 2 || decoded.Races[0].RecordedAt == nil || *decoded.Races[0].RecordedAt != wantRecordedAt || decoded.Races[0].CompletedLaps == nil || *decoded.Races[0].CompletedLaps != 1 {
		t.Fatalf("detail decode = %+v/%v", decoded, err)
	}
	var legacyRace *platformsvc.PlatformMySetupRace
	for i := range decoded.Races {
		if decoded.Races[i].ID == legacyResult.RaceID {
			legacyRace = &decoded.Races[i]
			break
		}
	}
	if legacyRace == nil || legacyRace.RecordedAt != nil || legacyRace.FinishPosition != nil || legacyRace.CompletedLaps == nil || *legacyRace.CompletedLaps != 2 {
		t.Fatalf("legacy setup race = %+v, want null recordedAt/finishPosition and two completed laps", legacyRace)
	}

	updated := request(http.MethodPost, "/me/setups/"+setupID, ownerToken, `{"name":"Race trim","rating":4,"memo":"private"}`)
	if updated.Code != http.StatusOK {
		t.Fatalf("update status = %d; body=%s", updated.Code, updated.Body.String())
	}
	var updateResult platformsvc.UpdateMySetupResult
	if err := json.Unmarshal(updated.Body.Bytes(), &updateResult); err != nil {
		t.Fatalf("update decode: %v", err)
	}
	updatedAt, err := time.Parse(time.RFC3339, updateResult.UpdatedAt)
	if err != nil || updateResult.UpdatedAt != updatedAt.UTC().Format(time.RFC3339) {
		t.Fatalf("updatedAt = %q/%v, want canonical RFC3339 UTC", updateResult.UpdatedAt, err)
	}
	if foreign := request(http.MethodGet, "/me/setups/"+setupID, otherToken, ""); foreign.Code != http.StatusNotFound {
		t.Fatalf("foreign detail status = %d, want 404", foreign.Code)
	}
	if foreign := request(http.MethodPost, "/me/setups/"+setupID, otherToken, `{"name":"x","rating":null,"memo":"x","unknown":true}`); foreign.Code != http.StatusNotFound {
		t.Fatalf("foreign update with invalid body status = %d, want 404", foreign.Code)
	}
	if missing := request(http.MethodPost, "/me/setups/00000000-0000-4000-8000-000000000000", ownerToken, `{`); missing.Code != http.StatusNotFound {
		t.Fatalf("missing update with malformed body status = %d, want 404", missing.Code)
	}
	if malformed := request(http.MethodGet, "/me/setups/not-a-uuid", ownerToken, ""); malformed.Code != http.StatusNotFound {
		t.Fatalf("malformed id status = %d, want 404", malformed.Code)
	}
	if wrongScope := request(http.MethodGet, "/me/setups/not-a-uuid", uploadToken, ""); wrongScope.Code != http.StatusForbidden {
		t.Fatalf("upload scope status = %d, want 403", wrongScope.Code)
	}
	if badBody := request(http.MethodPost, "/me/setups/"+setupID, ownerToken, `{"name":"x","rating":null,"memo":"x","x":1}`); badBody.Code != http.StatusBadRequest {
		t.Fatalf("strict body status = %d, want 400", badBody.Code)
	}
}
