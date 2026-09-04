package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"frc.engineer/internal/platformsvc"
	"frc.engineer/internal/rbac"
)

func TestViewAsHandlersAndAuthorizationMatrix(t *testing.T) {
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

	steamBase := 72_000_000_000_000_000 + time.Now().UnixNano()%100_000_000_000_000
	actor, err := store.UpsertSteamAccount(ctx, fmt.Sprintf("%017d", steamBase), "View As Operator", "")
	if err != nil {
		t.Fatalf("actor: %v", err)
	}
	subject, err := store.UpsertSteamAccount(ctx, fmt.Sprintf("%017d", steamBase+1), "View As Subject", "")
	if err != nil {
		t.Fatalf("subject: %v", err)
	}
	t.Cleanup(func() {
		for _, id := range []string{actor, subject} {
			if _, err := store.Pool().Exec(context.Background(), `DELETE FROM platform.accounts WHERE id = $1`, id); err != nil {
				t.Errorf("cleanup account %s: %v", id, err)
			}
		}
	})
	if err := store.SetAccountRoles(ctx, actor, []string{rbac.RoleAdmin}); err != nil {
		t.Fatalf("grant admin: %v", err)
	}
	parent, err := store.CreateSession(ctx, actor, platformsvc.ScopeWeb, time.Hour)
	if err != nil {
		t.Fatalf("parent session: %v", err)
	}

	var logs bytes.Buffer
	srv := &server{store: store, log: slog.New(slog.NewTextHandler(&logs, nil))}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /view-as", srv.handleViewAs)
	mux.HandleFunc("POST /view-as/exit", srv.handleViewAsExit)
	mux.HandleFunc("/auth/logout", srv.handleLogout)
	mux.HandleFunc("/me", srv.handleMe)
	mux.HandleFunc("GET /permissions", srv.handlePermissions)
	mux.HandleFunc("GET /wallet", srv.handleWallet)
	mux.HandleFunc("POST /feedback", srv.handleCreateFeedback)
	mux.HandleFunc("GET /rbac/accounts", srv.handleRBACSearchAccounts)
	mux.HandleFunc("GET /leaderboards/tt", srv.handleLeaderboardTT)

	request := func(method, target, token, body string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, target, strings.NewReader(body))
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		return rec
	}

	malformedSubject := "00000000-0000-4000-8000-000000000001"
	if rec := request(http.MethodPost, "/view-as", parent, `{"accountId":"`+malformedSubject+`","secret":"DO_NOT_LOG"}`); rec.Code != http.StatusBadRequest {
		t.Fatalf("malformed start = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
	deniedSubject := "00000000-0000-4000-8000-000000000002"
	if rec := request(http.MethodPost, "/view-as", parent, `{"accountId":"`+deniedSubject+`"}`); rec.Code != http.StatusNotFound {
		t.Fatalf("missing subject start = %d, want 404; body=%s", rec.Code, rec.Body.String())
	}
	start := request(http.MethodPost, "/view-as", parent, `{"accountId":"`+subject+`"}`)
	if start.Code != http.StatusCreated {
		t.Fatalf("start status = %d; body=%s", start.Code, start.Body.String())
	}
	if got := start.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("start Cache-Control = %q", got)
	}
	var created struct {
		Token     string         `json:"token"`
		SessionID string         `json:"sessionId"`
		ExpiresAt string         `json:"expiresAt"`
		Subject   map[string]any `json:"subject"`
	}
	if err := json.Unmarshal(start.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode start: %v", err)
	}
	if created.Token == "" || created.SessionID == "" || created.Subject["id"] != subject {
		t.Fatalf("start response = %+v", created)
	}
	for _, forbiddenField := range []string{"steamId64", "createdAt"} {
		if _, ok := created.Subject[forbiddenField]; ok {
			t.Fatalf("start subject exposed %s: %v", forbiddenField, created.Subject)
		}
	}

	me := request(http.MethodGet, "/me", created.Token, "")
	if me.Code != http.StatusOK || me.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("child me = %d cache=%q body=%s", me.Code, me.Header().Get("Cache-Control"), me.Body.String())
	}
	var meBody struct {
		ID          string   `json:"id"`
		Permissions []string `json:"permissions"`
		ViewAs      struct {
			SessionID string `json:"sessionId"`
			Actor     struct {
				ID string `json:"id"`
			} `json:"actor"`
		} `json:"viewAs"`
	}
	if err := json.Unmarshal(me.Body.Bytes(), &meBody); err != nil {
		t.Fatalf("decode me: %v", err)
	}
	if meBody.ID != subject || meBody.ViewAs.Actor.ID != actor || meBody.ViewAs.SessionID != created.SessionID {
		t.Fatalf("child me identity = %+v", meBody)
	}
	if !rbac.HasPermission(meBody.Permissions, rbac.PermWalletRead) || rbac.HasPermission(meBody.Permissions, rbac.PermViewAsCreate) {
		t.Fatalf("child permissions are not subject-only: %v", meBody.Permissions)
	}
	if rec := request(http.MethodGet, "/permissions", created.Token, ""); rec.Code != http.StatusOK {
		t.Fatalf("permissions status = %d; body=%s", rec.Code, rec.Body.String())
	}

	wallet := request(http.MethodHead, "/wallet", created.Token, "")
	if wallet.Code != http.StatusOK || wallet.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("wallet HEAD = %d cache=%q", wallet.Code, wallet.Header().Get("Cache-Control"))
	}
	var wallets, grants int
	if err := store.Pool().QueryRow(ctx, `SELECT count(*) FROM platform.wallets WHERE account_id = $1`, subject).Scan(&wallets); err != nil {
		t.Fatalf("count wallets: %v", err)
	}
	if err := store.Pool().QueryRow(ctx, `SELECT count(*) FROM platform.ledger_entries WHERE account_id = $1`, subject).Scan(&grants); err != nil {
		t.Fatalf("count grants: %v", err)
	}
	if wallets != 0 || grants != 0 {
		t.Fatalf("View As wallet read wrote wallet=%d ledger=%d", wallets, grants)
	}

	if rec := request(http.MethodPost, "/feedback", created.Token, `{"secret":"DO_NOT_LOG"}`); rec.Code != http.StatusForbidden || !strings.Contains(rec.Body.String(), "view-as is read-only") {
		t.Fatalf("mutation = %d body=%s", rec.Code, rec.Body.String())
	}
	var rateRows int
	if err := store.Pool().QueryRow(ctx, `SELECT count(*) FROM platform.rate_limits WHERE key = $1`, subject+":feedback").Scan(&rateRows); err != nil {
		t.Fatalf("count feedback rate rows: %v", err)
	}
	if rateRows != 0 {
		t.Fatalf("denied View As mutation consumed rate limit: rows=%d", rateRows)
	}
	if rec := request(http.MethodGet, "/rbac/accounts", created.Token, ""); rec.Code != http.StatusForbidden {
		t.Fatalf("global operator read = %d, want 403", rec.Code)
	}
	if rec := request(http.MethodPost, "/view-as", created.Token, `{"secret":"DO_NOT_LOG"}`); rec.Code != http.StatusForbidden {
		t.Fatalf("nested start = %d, want 403", rec.Code)
	}
	if rec := request(http.MethodGet, "/leaderboards/tt?track=1&format=F1+26", "invalid", ""); rec.Code != http.StatusUnauthorized {
		t.Fatalf("invalid strict viewer = %d, want 401", rec.Code)
	}

	if rec := request(http.MethodPost, "/view-as/exit", parent, ""); rec.Code != http.StatusNoContent {
		t.Fatalf("parent exit no-op = %d", rec.Code)
	}
	if _, err := store.LookupSession(ctx, parent); err != nil {
		t.Fatalf("parent exit no-op deleted parent: %v", err)
	}
	if rec := request(http.MethodPost, "/auth/logout", created.Token, ""); rec.Code != http.StatusNoContent {
		t.Fatalf("child logout = %d", rec.Code)
	}
	if _, err := store.LookupSession(ctx, parent); err != nil {
		t.Fatalf("child logout deleted parent: %v", err)
	}

	logText := logs.String()
	for _, secret := range []string{parent, created.Token, "DO_NOT_LOG"} {
		if strings.Contains(logText, secret) {
			t.Fatalf("audit log leaked secret %q: %s", secret, logText)
		}
	}
	if !strings.Contains(logText, "subject_account_id="+deniedSubject) {
		t.Fatalf("denied-start audit missing known subject id %s: %s", deniedSubject, logText)
	}
	if strings.Contains(logText, malformedSubject) {
		t.Fatalf("malformed-body audit recorded unknown subject id %s: %s", malformedSubject, logText)
	}
	for _, event := range []string{"view_as.start", "view_as.denied_read_or_mutation", "view_as.denied_start", "view_as.exit"} {
		if !strings.Contains(logText, event) {
			t.Fatalf("audit log missing %s: %s", event, logText)
		}
	}
}

func TestViewAsBodyValidationAndAnalysisMethodRegression(t *testing.T) {
	for _, body := range []string{
		`{`,
		`{"accountId":"not-a-uuid"}`,
		`{"accountId":"00000000-0000-4000-8000-000000000000","extra":true}`,
		`{"accountId":"00000000-0000-4000-8000-000000000000"} {}`,
	} {
		if _, err := decodeViewAsAccountID(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, "/view-as", strings.NewReader(body))); err == nil {
			t.Fatalf("decode %q succeeded, want error", body)
		}
	}
	valid := `{"accountId":"00000000-0000-4000-8000-000000000000"}`
	if got, err := decodeViewAsAccountID(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, "/view-as", strings.NewReader(valid))); err != nil || got != "00000000-0000-4000-8000-000000000000" {
		t.Fatalf("valid decode = (%q,%v)", got, err)
	}

	srv := &server{}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /analysis", srv.handleCreateAnalysis)
	for _, method := range []string{http.MethodPut, http.MethodPatch} {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(method, "/analysis", nil))
		if rec.Code != http.StatusMethodNotAllowed {
			t.Fatalf("%s /analysis = %d, want 405", method, rec.Code)
		}
	}
}

func TestStrictViewersRejectPresentMalformedAuthorization(t *testing.T) {
	srv := &server{}
	tests := []struct {
		name    string
		handler http.HandlerFunc
		viewer  func(context.Context, *http.Request) (string, error)
		target  string
	}{
		{"leaderboard", srv.handleLeaderboardTT, srv.optionalViewer, "/leaderboards/tt?track=1&format=F1+26"},
		{"listing", srv.handleGetListing, srv.viewerStrict, "/listings/not-a-uuid"},
	}
	for _, test := range tests {
		t.Run(test.name+"_absent_is_anonymous", func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, test.target, nil)
			viewer, err := test.viewer(request.Context(), request)
			if err != nil || viewer != "" {
				t.Fatalf("anonymous viewer = (%q,%v)", viewer, err)
			}
		})
		for _, header := range []string{"", "   ", "Bearer ", "Bearer    ", "Basic abc", "bearer abc"} {
			t.Run(test.name+"_"+fmt.Sprintf("%q", header), func(t *testing.T) {
				request := httptest.NewRequest(http.MethodGet, test.target, nil)
				request.Header["Authorization"] = []string{header}
				recorder := httptest.NewRecorder()
				test.handler(recorder, request)
				if recorder.Code != http.StatusUnauthorized {
					t.Fatalf("Authorization %q status = %d, want 401", header, recorder.Code)
				}
			})
		}
	}
}
