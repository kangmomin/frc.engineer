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
	"strings"
	"testing"
	"time"

	"frc.engineer/internal/platformsvc"
	"frc.engineer/internal/rbac"
	"frc.engineer/internal/strategy"
	"frc.engineer/internal/strategy/strategytest"
)

func TestStrategyUploadToSimulationHTTP(t *testing.T) {
	dsn := os.Getenv("PLATFORM_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("PLATFORM_TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	store, err := platformsvc.Open(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(store.Close)
	if err := store.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	// This path deliberately uses Migrate directly, never testStore's grant
	// restoration. Run it against a fresh DB to verify the actual SQL seeds.
	roles, err := store.ListRoles(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, role := range roles {
		if role.Name == rbac.RoleUser && rbac.HasPermission(role.Permissions, rbac.PermStrategyRead) {
			t.Fatal("migration grants strategy access to ordinary users")
		}
	}
	s := &server{store: store, log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	mux := http.NewServeMux()
	registerStrategyRoutes(mux, s)
	mux.HandleFunc("POST /races", s.handleUpload)
	host := httptest.NewServer(mux)
	t.Cleanup(host.Close)
	call := func(method, path, token string, body any) (int, []byte) {
		t.Helper()
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		req, err := http.NewRequest(method, host.URL+path, bytes.NewReader(raw))
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Content-Type", "application/json")
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		res, err := host.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		data, err := io.ReadAll(res.Body)
		if err != nil {
			t.Fatal(err)
		}
		if path != "/races" && res.Header.Get("Cache-Control") != "no-store" {
			t.Fatal("strategy cache boundary missing")
		}
		return res.StatusCode, data
	}
	accounts, uploads := []string{}, []string{}
	steamBase := 70_000_000_000_000_000 + time.Now().UnixNano()%100_000_000_000_000
	for i := 0; i < 3; i++ {
		id, err := store.UpsertSteamAccount(ctx, fmt.Sprintf("%017d", steamBase+int64(i)), "Strategy Driver", "")
		if err != nil {
			t.Fatal(err)
		}
		accounts = append(accounts, id)
		upload, err := store.CreateSession(ctx, id, platformsvc.ScopeUpload, time.Minute)
		if err != nil {
			t.Fatal(err)
		}
		uploads = append(uploads, upload)
	}
	t.Cleanup(func() {
		for _, id := range accounts {
			_, err := store.Pool().Exec(context.Background(), `DELETE FROM platform.accounts WHERE id=$1`, id)
			if err != nil {
				t.Error(err)
			}
		}
	})
	web, err := store.CreateSession(ctx, accounts[0], platformsvc.ScopeWeb, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if code, _ := call("GET", "/strategies/contexts"+strategyQuery, "", nil); code != 401 {
		t.Fatalf("anonymous: %d", code)
	}
	if code, _ := call("GET", "/strategies/contexts"+strategyQuery, uploads[0], nil); code != 403 {
		t.Fatalf("upload token: %d", code)
	}
	if code, _ := call("GET", "/strategies/contexts"+strategyQuery, web, nil); code != 403 {
		t.Fatalf("ordinary user must lack strategy permission: %d", code)
	}
	if code, _ := call("POST", "/strategies/simulate"+strategyQuery, web, map[string]any{}); code != 403 {
		t.Fatalf("ordinary user calculation: %d", code)
	}
	// None of the uploaders have strategy read permission; race upload alone
	// is sufficient to contribute to the corpus.
	legacy := platformsvc.UploadRequest{SourceRaceID: "legacy-without-strategy", TrackID: 10, TrackName: "Monza", GameFormat: "F1 26", SessionType: "Race",
		Laps: []platformsvc.UploadLap{{LapNumber: 1, LapMs: 90000, S1Ms: 30000, S2Ms: 30000, S3Ms: 30000, Tyre: "Soft", Valid: true}}}
	if code, body := call("POST", "/races", uploads[0], legacy); code != 200 {
		t.Fatalf("legacy upload: %d %s", code, body)
	}
	for i, r := range strategytest.Records() {
		req := platformsvc.UploadRequest{SourceRaceID: r.RaceID, TrackID: 10, TrackName: "Monza", GameFormat: "F1 26", SessionType: "Race", Strategy: &r.Evidence}
		for _, l := range r.Evidence.Laps {
			ms := uint32(l.TimeMs)
			req.Laps = append(req.Laps, platformsvc.UploadLap{LapNumber: l.Number, LapMs: ms, S1Ms: ms / 3, S2Ms: ms / 3, S3Ms: ms - 2*(ms/3), Tyre: l.Tyre, Valid: true})
		}
		if code, body := call("POST", "/races", uploads[i%3], req); code != 200 {
			t.Fatalf("upload %d: %d %s", i, code, body)
		}
	}
	roleName := fmt.Sprintf("strat-test-%d", time.Now().UnixNano())
	if _, err := store.CreateRole(ctx, roleName, "Strategy test"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := store.DeleteRole(context.Background(), roleName); err != nil {
			t.Error(err)
		}
	})
	if err := store.SetRolePermissions(ctx, roleName, []string{rbac.PermStrategyRead}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.AssignRole(ctx, accounts[0], roleName); err != nil {
		t.Fatal(err)
	}
	code, body := call("GET", "/strategies/contexts"+strategyQuery, web, nil)
	var data struct {
		Contexts    []strategy.Context                  `json:"contexts"`
		Records     int                                 `json:"records"`
		Diagnostics strategy.Diagnostics                `json:"diagnostics"`
		Coverage    platformsvc.StrategyArchiveCoverage `json:"archiveCoverage"`
	}
	if err := json.Unmarshal(body, &data); err != nil || code != 200 || len(data.Contexts) != 1 {
		t.Fatalf("contexts: %d %s %v", code, body, err)
	}
	if data.Records != 12 || data.Coverage.UploadedRaces != 13 || data.Coverage.WithEvidence != 12 || data.Coverage.WithoutEvidence != 1 ||
		data.Diagnostics.CollectedLaps != 360 || data.Diagnostics.CleanLaps != data.Contexts[0].CleanLaps {
		t.Fatalf("legacy upload or usable lap counts disappeared from HTTP diagnostics: %s", body)
	}
	for _, id := range accounts {
		if strings.Contains(string(body), id) {
			t.Fatal("account identity leaked in collection diagnostics")
		}
	}
	req := strategy.Request{ContextID: data.Contexts[0].ID, MaxStops: 2, AvailableSets: map[string]int{"Soft": 1, "Hard": 1}, RequireTwoCompounds: true}
	code, body = call("POST", "/strategies/simulate"+strategyQuery, web, req)
	var result strategy.Result
	if err := json.Unmarshal(body, &result); err != nil || code != 200 || result.Status != "ready" || result.Context.Users != 3 || result.Context.Sessions != 12 || len(result.Plans) == 0 {
		t.Fatalf("calculation: %d %s %v", code, body, err)
	}
	for _, id := range accounts {
		if strings.Contains(string(body), id) {
			t.Fatal("account identity leaked in aggregate")
		}
	}
	// Permission inheritance and revocation take effect with the SAME session.
	for _, grant := range []string{"pithub.strategy", "pithub"} {
		if err := store.SetRolePermissions(ctx, roleName, []string{grant}); err != nil {
			t.Fatal(err)
		}
		if code, _ := call("GET", "/strategies/contexts"+strategyQuery, web, nil); code != 200 {
			t.Fatalf("ancestor %s: %d", grant, code)
		}
	}
	if err := store.SetRolePermissions(ctx, roleName, nil); err != nil {
		t.Fatal(err)
	}
	if code, _ := call("GET", "/strategies/contexts"+strategyQuery, web, nil); code != 403 {
		t.Fatalf("revoked contexts: %d", code)
	}
	if code, _ := call("POST", "/strategies/simulate"+strategyQuery, web, req); code != 403 {
		t.Fatalf("revoked calculation: %d", code)
	}

}
