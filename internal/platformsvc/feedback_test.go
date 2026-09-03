package platformsvc

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"
)

func TestFeedbackInputValidation(t *testing.T) {
	bad := []CreateFeedbackRequest{
		{Category: "bug", Body: ""},
		{Category: "bug", Body: "   "},
		{Category: "bug", Body: strings.Repeat("가", maxFeedbackLen+1)},
		{Category: "bug", Body: "a\x00b"},
		{Category: "", Body: "ok"},
		{Category: "Bug", Body: "ok"},
		{Category: "spam", Body: "ok"},
	}
	for i, req := range bad {
		if err := req.validate(); !errors.Is(err, ErrBadUpload) {
			t.Fatalf("bad feedback %d err = %v, want ErrBadUpload", i, err)
		}
	}

	for _, category := range []string{"bug", "suggestion", "other"} {
		ok := CreateFeedbackRequest{Category: category, Body: "the setup picker is confusing"}
		if err := ok.validate(); err != nil {
			t.Fatalf("category %q rejected: %v", category, err)
		}
	}

	exact := CreateFeedbackRequest{Category: "bug", Body: strings.Repeat("x", maxFeedbackLen)}
	if err := exact.validate(); err != nil {
		t.Fatalf("exact-length body rejected: %v", err)
	}

	multiline := CreateFeedbackRequest{Category: "suggestion", Body: "줄1\n줄2"}
	if err := multiline.validate(); err != nil {
		t.Fatalf("multi-line body rejected: %v", err)
	}

	trimmed := CreateFeedbackRequest{Category: "other", Body: "  x  "}
	if err := trimmed.validate(); err != nil {
		t.Fatalf("trim-normalized body rejected: %v", err)
	}
	if trimmed.Body != "x" {
		t.Fatalf("trimmed body = %q, want %q", trimmed.Body, "x")
	}
}

func TestFeedbackSubmitAndList(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	accountA, _ := buyerAccount(t, store, steamA)
	accountB, _ := buyerAccount(t, store, steamB)

	id1, err := store.SubmitFeedback(ctx, accountA, CreateFeedbackRequest{Category: "bug", Body: "leaderboard is stale"})
	if err != nil {
		t.Fatalf("submit bug: %v", err)
	}
	if id1 == "" {
		t.Fatal("submit bug returned empty id")
	}
	id2, err := store.SubmitFeedback(ctx, accountA, CreateFeedbackRequest{Category: "suggestion", Body: "add dark mode"})
	if err != nil {
		t.Fatalf("submit suggestion: %v", err)
	}
	if id2 == "" {
		t.Fatal("submit suggestion returned empty id")
	}
	if _, err := store.SubmitFeedback(ctx, accountB, CreateFeedbackRequest{Category: "other", Body: "thanks!"}); err != nil {
		t.Fatalf("submit other: %v", err)
	}

	entriesA, err := store.ListMyFeedback(ctx, accountA)
	if err != nil {
		t.Fatalf("ListMyFeedback(A): %v", err)
	}
	if len(entriesA) != 2 {
		t.Fatalf("entriesA = %+v, want 2", entriesA)
	}
	// Newest first: the suggestion (submitted second) must come before the bug.
	if entriesA[0].ID != id2 || entriesA[1].ID != id1 {
		t.Fatalf("entriesA order = %+v, want newest-first [%s, %s]", entriesA, id2, id1)
	}
	for _, e := range entriesA {
		if e.Status != "open" {
			t.Fatalf("entry status = %q, want %q", e.Status, "open")
		}
		if _, err := time.Parse(time.RFC3339, e.CreatedAt); err != nil {
			t.Fatalf("createdAt %q not RFC3339: %v", e.CreatedAt, err)
		}
	}

	entriesB, err := store.ListMyFeedback(ctx, accountB)
	if err != nil {
		t.Fatalf("ListMyFeedback(B): %v", err)
	}
	if len(entriesB) != 1 {
		t.Fatalf("entriesB = %+v, want 1", entriesB)
	}

	freshAccount, _ := buyerAccount(t, store, steamC)
	entriesFresh, err := store.ListMyFeedback(ctx, freshAccount)
	if err != nil {
		t.Fatalf("ListMyFeedback(fresh): %v", err)
	}
	if entriesFresh == nil || len(entriesFresh) != 0 {
		t.Fatalf("entriesFresh = %+v, want empty non-nil slice", entriesFresh)
	}

	if _, err := store.SubmitFeedback(ctx, accountA, CreateFeedbackRequest{Category: "spam", Body: "x"}); !errors.Is(err, ErrBadUpload) {
		t.Fatalf("invalid submit err = %v, want ErrBadUpload", err)
	}
}

func TestListFeedbackGlobalDeterministicLimitAndPrivacy(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	accountA, err := store.UpsertSteamAccount(ctx, "76561197960288901", "Inbox Alice", "https://avatar.invalid/alice")
	if err != nil {
		t.Fatalf("upsert account A: %v", err)
	}
	accountB, err := store.UpsertSteamAccount(ctx, "76561197960288902", "Inbox Bob", "https://avatar.invalid/bob")
	if err != nil {
		t.Fatalf("upsert account B: %v", err)
	}

	// Give every row the same timestamp so id DESC is the observable tie-breaker.
	created := time.Date(2026, time.September, 3, 12, 34, 56, 0, time.UTC)
	statuses := []string{"open", "in_progress", "resolved", "dismissed"}
	for i := 1; i <= feedbackInboxLimit+2; i++ {
		accountID := accountA
		if i%2 == 0 {
			accountID = accountB
		}
		id := fmt.Sprintf("00000000-0000-0000-0000-%012x", i)
		if _, err := store.pool.Exec(ctx, `
			INSERT INTO platform.feedback (id, account_id, category, body, status, created_at)
			VALUES ($1, $2, 'bug', $3, $4, $5)`,
			id, accountID, fmt.Sprintf("inbox entry %03d", i), statuses[i%len(statuses)], created,
		); err != nil {
			t.Fatalf("insert feedback %d: %v", i, err)
		}
	}

	entries, err := store.ListFeedback(ctx)
	if err != nil {
		t.Fatalf("ListFeedback: %v", err)
	}
	if len(entries) != feedbackInboxLimit {
		t.Fatalf("entries has %d rows, want %d", len(entries), feedbackInboxLimit)
	}
	seenOdd, seenEven := false, false
	for i, entry := range entries {
		wantN := feedbackInboxLimit + 2 - i
		wantID := fmt.Sprintf("00000000-0000-0000-0000-%012x", wantN)
		if entry.ID != wantID {
			t.Fatalf("entry %d id = %q, want %q", i, entry.ID, wantID)
		}
		gotCreated, err := time.Parse(time.RFC3339, entry.CreatedAt)
		if err != nil || !gotCreated.Equal(created) {
			t.Fatalf("entry %d createdAt = %q (%v), want instant %s", i, entry.CreatedAt, err, created.Format(time.RFC3339))
		}
		seenOdd = seenOdd || wantN%2 == 1
		seenEven = seenEven || wantN%2 == 0
	}
	if !seenOdd || !seenEven {
		t.Fatalf("global result did not include feedback from both accounts: odd=%v even=%v", seenOdd, seenEven)
	}

	payload, err := json.Marshal(entries)
	if err != nil {
		t.Fatalf("marshal entries: %v", err)
	}
	for _, privateValue := range []string{accountA, accountB, "Inbox Alice", "Inbox Bob", "76561197960288901", "76561197960288902", "avatar.invalid"} {
		if strings.Contains(string(payload), privateValue) {
			t.Errorf("response contains submitter identity %q", privateValue)
		}
	}
	var wire []map[string]any
	if err := json.Unmarshal(payload, &wire); err != nil {
		t.Fatalf("unmarshal response shape: %v", err)
	}
	wantKeys := map[string]bool{"id": true, "category": true, "body": true, "status": true, "createdAt": true}
	for i, item := range wire {
		if len(item) != len(wantKeys) {
			t.Fatalf("entry %d keys = %v, want exactly %v", i, item, wantKeys)
		}
		for key := range item {
			if !wantKeys[key] {
				t.Fatalf("entry %d contains unexpected field %q", i, key)
			}
		}
	}
}
