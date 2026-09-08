package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"frc.engineer/internal/platformsvc"
	"frc.engineer/internal/rbac"
)

func TestUpdateLogsGateMatrix(t *testing.T) {
	for _, route := range []string{"list", "create", "seen"} {
		for _, identity := range []string{"anonymous", "upload", "banned", "user", "view-as"} {
			t.Run(route+"/"+identity, func(t *testing.T) {
				p := platformsvc.Principal{AccountID: "subject", Scope: platformsvc.ScopeWeb}
				srv := &server{}
				switch identity {
				case "upload":
					p.Scope = platformsvc.ScopeUpload
				case "banned":
					p.Banned = true
				case "view-as":
					p.ViewAs = true
					p.Permissions = []string{"pithub"}
				}
				if identity != "anonymous" {
					srv.authenticateForTest = func(context.Context, *http.Request) (platformsvc.Principal, error) { return p, nil }
				}
				if (identity == "user" && route != "create") || (identity == "view-as" && route == "list") {
					return
				}
				rec := httptest.NewRecorder()
				req := httptest.NewRequest(http.MethodPost, "/update-logs", strings.NewReader("invalid"))
				switch route {
				case "list":
					srv.handleUpdateLogs(rec, req)
				case "create":
					srv.handleCreateUpdateLog(rec, req)
				case "seen":
					srv.handleUpdateLogsSeen(rec, req)
				}
				want := http.StatusForbidden
				if identity == "anonymous" {
					want = http.StatusUnauthorized
				}
				if rec.Code != want || rec.Header().Get("Cache-Control") != "no-store" {
					t.Fatalf("got %d/%q, want %d/no-store", rec.Code, rec.Header().Get("Cache-Control"), want)
				}
			})
		}
	}
}

func TestUpdateLogsHTTPPublicationAndAcknowledgment(t *testing.T) {
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
	account, err := store.UpsertSteamAccount(ctx, fmt.Sprintf("%017d", 70_000_000_000_000_000+time.Now().UnixNano()%1_000_000_000_000_000), "Updates Operator", "")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = store.Pool().Exec(ctx, `DELETE FROM platform.accounts WHERE id = $1`, account) })
	if err := store.SetAccountRoles(ctx, account, []string{rbac.RoleAdmin}); err != nil {
		t.Fatal(err)
	}
	token, err := store.CreateSession(ctx, account, platformsvc.ScopeWeb, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	srv := &server{store: store}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /update-logs", srv.handleUpdateLogs)
	mux.HandleFunc("POST /update-logs", srv.handleCreateUpdateLog)
	mux.HandleFunc("POST /me/update-logs/seen", srv.handleUpdateLogsSeen)
	request := func(method, path, body string, want int) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		if rec.Code != want || rec.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("%s %s: %d %s", method, path, rec.Code, rec.Body)
		}
		return rec
	}
	for _, body := range []string{`null`, `{}`, `{"title":"x","body":" "}`, `{"title":"x","body":"y","extra":true}`, `{"title":"x","body":"y"} {}`} {
		request("POST", "/update-logs", body, 400)
	}
	rec := request("POST", "/update-logs", `{"title":"새 업데이트","body":"개선 사항\n두 번째 줄"}`, 201)
	var entry platformsvc.UpdateLog
	if err := json.Unmarshal(rec.Body.Bytes(), &entry); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = store.Pool().Exec(ctx, `DELETE FROM platform.update_logs WHERE id = $1`, entry.ID) })
	getPage := func() platformsvc.UpdateLogPage {
		t.Helper()
		var page platformsvc.UpdateLogPage
		if err := json.Unmarshal(request("GET", "/update-logs", "", 200).Body.Bytes(), &page); err != nil {
			t.Fatal(err)
		}
		return page
	}
	page := getPage()
	if !page.HasUnseen || page.LatestRevision != entry.ID || page.Items[0].Title != "새 업데이트" {
		t.Fatalf("page = %+v", page)
	}
	for _, query := range []string{"?before=-1", "?before=0", "?before=1&before=2", "?before=abc", "?unknown=1"} {
		request("GET", "/update-logs"+query, "", 400)
	}
	for _, body := range []string{`{"revision":1}`, `{"revision":"9999999999"}`, `{"revision":"0"}`, `{"revision":"1","accountId":"other"}`} {
		request("POST", "/me/update-logs/seen", body, 400)
	}
	request("POST", "/me/update-logs/seen", fmt.Sprintf(`{"revision":%q}`, page.LatestRevision), 204)
	if getPage().HasUnseen {
		t.Fatal("seen update still unseen on next visit")
	}
	if err := store.SetAccountRoles(ctx, account, []string{rbac.RoleUser}); err != nil {
		t.Fatal(err)
	}
	request("POST", "/update-logs", `{"title":"forbidden","body":"body"}`, 403)
	request("GET", "/update-logs", "", 200)
}
