package main

import (
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
	"frc.engineer/internal/rbac"
)

func TestFeedbackInboxUnauthenticatedIsNoStore(t *testing.T) {
	srv := &server{}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/feedback-inbox", nil)

	srv.handleFeedbackInbox(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
	if got := rec.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("Cache-Control = %q, want %q", got, "no-store")
	}
}

func TestFeedbackInboxAuthorizationAndStorage(t *testing.T) {
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

	steamID := fmt.Sprintf("%017d", 70_000_000_000_000_000+time.Now().UnixNano()%1_000_000_000_000_000)
	accountID, err := store.UpsertSteamAccount(ctx, steamID, "Private Inbox Operator", "https://avatar.invalid/operator")
	if err != nil {
		t.Fatalf("UpsertSteamAccount: %v", err)
	}
	t.Cleanup(func() {
		cleanupCtx := context.Background()
		if _, err := store.Pool().Exec(cleanupCtx, `DELETE FROM platform.feedback WHERE account_id = $1`, accountID); err != nil {
			t.Errorf("cleanup feedback: %v", err)
			return
		}
		if _, err := store.Pool().Exec(cleanupCtx, `DELETE FROM platform.accounts WHERE id = $1`, accountID); err != nil {
			t.Errorf("cleanup account: %v", err)
		}
	})
	webToken, err := store.CreateSession(ctx, accountID, platformsvc.ScopeWeb, time.Minute)
	if err != nil {
		t.Fatalf("CreateSession(web): %v", err)
	}

	srv := &server{store: store, log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	request := func(requestCtx context.Context, token string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(http.MethodGet, "/feedback-inbox", nil).WithContext(requestCtx)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		srv.handleFeedbackInbox(rec, req)
		if got := rec.Header().Get("Cache-Control"); got != "no-store" {
			t.Fatalf("Cache-Control = %q, want %q", got, "no-store")
		}
		return rec
	}

	if rec := request(ctx, webToken); rec.Code != http.StatusForbidden {
		t.Fatalf("default user status = %d, want %d", rec.Code, http.StatusForbidden)
	}
	if err := store.SetAccountRoles(ctx, accountID, []string{rbac.RoleAdmin}); err != nil {
		t.Fatalf("SetAccountRoles(admin): %v", err)
	}
	uploadToken, err := store.CreateSession(ctx, accountID, platformsvc.ScopeUpload, time.Minute)
	if err != nil {
		t.Fatalf("CreateSession(upload): %v", err)
	}
	if rec := request(ctx, uploadToken); rec.Code != http.StatusForbidden {
		t.Fatalf("upload token status = %d, want %d", rec.Code, http.StatusForbidden)
	}

	feedbackID, err := store.SubmitFeedback(ctx, accountID, platformsvc.CreateFeedbackRequest{Category: "other", Body: "operator-visible feedback"})
	if err != nil {
		t.Fatalf("SubmitFeedback: %v", err)
	}
	rec := request(ctx, webToken)
	if rec.Code != http.StatusOK {
		t.Fatalf("authorized status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	var entries []platformsvc.FeedbackEntry
	if err := json.Unmarshal(rec.Body.Bytes(), &entries); err != nil {
		t.Fatalf("decode success response: %v", err)
	}
	found := false
	for _, entry := range entries {
		found = found || entry.ID == feedbackID
	}
	if !found {
		t.Fatalf("success response does not contain submitted feedback %q", feedbackID)
	}

	if _, err := store.Pool().Exec(ctx, `INSERT INTO platform.account_bans (account_id, reason) VALUES ($1, 'test')`, accountID); err != nil {
		t.Fatalf("ban account: %v", err)
	}
	if rec := request(ctx, webToken); rec.Code != http.StatusForbidden {
		t.Fatalf("banned account status = %d, want %d", rec.Code, http.StatusForbidden)
	}
	if _, err := store.Pool().Exec(ctx, `DELETE FROM platform.account_bans WHERE account_id = $1`, accountID); err != nil {
		t.Fatalf("unban account: %v", err)
	}

	lockConn, err := store.Pool().Acquire(ctx)
	if err != nil {
		t.Fatalf("acquire lock connection: %v", err)
	}
	defer lockConn.Release()
	tx, err := lockConn.Begin(ctx)
	if err != nil {
		t.Fatalf("begin lock transaction: %v", err)
	}
	defer tx.Rollback(context.Background()) //nolint:errcheck
	if _, err := tx.Exec(ctx, `LOCK TABLE platform.feedback IN ACCESS EXCLUSIVE MODE`); err != nil {
		t.Fatalf("lock feedback table: %v", err)
	}
	timedCtx, cancel := context.WithTimeout(ctx, 100*time.Millisecond)
	defer cancel()
	if rec := request(timedCtx, webToken); rec.Code != http.StatusInternalServerError {
		t.Fatalf("storage failure status = %d, want %d; body=%s", rec.Code, http.StatusInternalServerError, rec.Body.String())
	}
}
