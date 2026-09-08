package main

import (
	"context"
	"encoding/base64"
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
)

func TestLeaderboardRecordsRejectsMethodQueryAndAuth(t *testing.T) {
	srv := &server{authenticateForTest: func(context.Context, *http.Request) (platformsvc.Principal, error) {
		return platformsvc.Principal{}, platformsvc.ErrInvalidSession
	}}
	for _, tc := range []struct {
		method, query, auth string
		status              int
	}{
		{"POST", "track=5&format=F1+26", "", 405}, {"HEAD", "track=5&format=F1+26", "", 405},
		{"GET", "track=2147483648&format=x", "", 400}, {"GET", "track=5", "", 400},
		{"GET", "track=5&format=x&limit=no", "", 400}, {"GET", "track=5&format=x&limit=0", "", 400}, {"GET", "track=5&format=x&limit=201", "", 400},
		{"GET", "track=5&format=x&board=bogus", "", 400}, {"GET", "track=5&format=x&cursor=bad", "", 400}, {"GET", "track=5&format=x&around=bad", "", 400},
		{"GET", "track=5&format=x&around=me", "", 401}, {"GET", "track=5&format=x", "Bearer invalid", 401},
	} {
		req := httptest.NewRequest(tc.method, "/leaderboards/records?"+tc.query, nil)
		if tc.auth != "" {
			req.Header.Set("Authorization", tc.auth)
		}
		rec := httptest.NewRecorder()
		srv.handleLeaderboardRecords(rec, req)
		if rec.Code != tc.status {
			t.Fatalf("%+v -> %d %s", tc, rec.Code, rec.Body.String())
		}
		if tc.status == 405 && rec.Header().Get("Allow") != "GET" {
			t.Fatal("missing Allow GET")
		}
		if rec.Header().Get("Vary") != "Authorization" || !strings.HasPrefix(rec.Header().Get("Content-Type"), "text/plain") {
			t.Fatalf("headers: %v", rec.Header())
		}
	}
}

func TestLeaderboardRecordsHTTPContract(t *testing.T) {
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
	var ids []string
	t.Cleanup(func() {
		for _, id := range ids {
			if _, err := store.Pool().Exec(ctx, `DELETE FROM platform.accounts WHERE id=$1`, id); err != nil {
				t.Error(err)
			}
		}
	})
	format := fmt.Sprintf("HTTP-%d", time.Now().UnixNano())
	for i := 0; i < 3; i++ {
		var id string
		if err := store.Pool().QueryRow(ctx, `INSERT INTO platform.accounts(persona,kind,verified_at) VALUES($1,'user',now()) RETURNING id`, fmt.Sprint("Records", i)).Scan(&id); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, id)
		_, err := store.Pool().Exec(ctx, `WITH r AS (INSERT INTO platform.races(account_id,source_race_id,track_id,game_format,session_type,plausible) VALUES($1,'records',5,$2,'Time Trial',true) RETURNING id) INSERT INTO platform.laps(race_id,lap_number,lap_ms,s1_ms,s2_ms,s3_ms,valid) SELECT id,1,$3,30000,30000,$3::int-60000,true FROM r`, id, format, 90000+i*1000)
		if err != nil {
			t.Fatal(err)
		}
	}
	token, err := store.CreateSession(ctx, ids[2], platformsvc.ScopeWeb, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	srv := &server{store: store, log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	request := func(query, token string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest("GET", "/leaderboards/records?track=5&format="+format+query, nil)
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		rec := httptest.NewRecorder()
		srv.handleLeaderboardRecords(rec, req)
		return rec
	}
	decode := func(rec *httptest.ResponseRecorder) platformsvc.LeaderboardRecords {
		t.Helper()
		if rec.Code != 200 {
			t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
		}
		if rec.Header().Get("Vary") != "Authorization" || rec.Header().Get("Cache-Control") != marketCacheControl {
			t.Fatalf("cache: %v", rec.Header())
		}
		var result platformsvc.LeaderboardRecords
		if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		return result
	}
	first := decode(request("&limit=1", token))
	if first.Board != "pb" || first.Total != 3 || first.Viewer == nil || first.Viewer.AccountID != ids[2] || first.Viewer.Rank != 3 || first.Rows[0].You || first.NextCursor == nil {
		t.Fatalf("first: %+v", first)
	}
	around := decode(request("&around="+ids[0]+"&limit=1", token))
	if !around.AnchorFound || around.Rows[0].AccountID != ids[0] || around.Rows[0].You || around.Viewer.AccountID != ids[2] {
		t.Fatalf("around/viewer: %+v", around)
	}
	own := decode(request("&around=me&limit=1", token))
	if !own.AnchorFound || !own.Rows[0].You || own.Rows[0].Rank != 3 {
		t.Fatalf("own: %+v", own)
	}
	public := decode(request("&around="+ids[1]+"&limit=1", ""))
	if public.Viewer != nil || public.Rows[0].You || !public.AnchorFound {
		t.Fatalf("public: %+v", public)
	}
	next := decode(request("&limit=1&cursor="+*first.NextCursor, token))
	if next.Rows[0].Rank != 2 || next.PreviousCursor == nil {
		t.Fatalf("next: %+v", next)
	}
	// UUID spellings accepted by validation must reach SQL in canonical form.
	// In particular PostgreSQL rejects a URN passed directly as a uuid parameter.
	cursorJSON, err := base64.RawURLEncoding.DecodeString(*first.NextCursor)
	if err != nil {
		t.Fatal(err)
	}
	var cursor map[string]any
	if err := json.Unmarshal(cursorJSON, &cursor); err != nil {
		t.Fatal(err)
	}
	for _, accountID := range []string{"urn:uuid:" + ids[0], "{" + ids[0] + "}"} {
		cursor["accountId"] = accountID
		data, err := json.Marshal(cursor)
		if err != nil {
			t.Fatal(err)
		}
		page := decode(request("&limit=1&cursor="+base64.RawURLEncoding.EncodeToString(data), token))
		if len(page.Rows) != 1 || page.Rows[0].AccountID != next.Rows[0].AccountID || page.Rows[0].Rank != 2 {
			t.Fatalf("UUID %q changed page boundary: %+v", accountID, page)
		}
	}
	if rec := request("&limit=2&cursor="+*first.NextCursor, token); rec.Code != 400 {
		t.Fatalf("scope status: %d", rec.Code)
	}
	for _, field := range []string{"steamId", "raceId", "sessionId", "sourceRaceId", "setup"} {
		if strings.Contains(request("", token).Body.String(), field) {
			t.Fatalf("private field %s", field)
		}
	}
	// Storage failure is an error, not an empty leaderboard response.
	failed, err := platformsvc.Open(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	failed.Close()
	srv.store = failed
	if rec := request("", ""); rec.Code != 500 || !strings.Contains(rec.Body.String(), "internal error") {
		t.Fatalf("failure %d %s", rec.Code, rec.Body.String())
	}
}
