package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"frc.engineer/internal/bandb"
)

func TestHandleBannedNicknamesGET(t *testing.T) {
	cache := bandb.NewCache()
	cache.ReplaceNicks([]string{"a", "b"})
	h := handleBannedNicknames(cache)
	rr := httptest.NewRecorder()
	h(rr, httptest.NewRequest(http.MethodGet, "/api/banned-nicknames", nil))

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
	var body struct {
		Nicknames []string `json:"nicknames"`
	}
	if err := json.NewDecoder(rr.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(body.Nicknames) != 2 {
		t.Fatalf("got %d nicknames, want 2: %v", len(body.Nicknames), body.Nicknames)
	}
	// Order is not guaranteed (map-backed cache); check membership.
	got := map[string]bool{}
	for _, n := range body.Nicknames {
		got[n] = true
	}
	if !got["a"] || !got["b"] {
		t.Errorf("missing entries: %v", body.Nicknames)
	}
}

func TestHandleBannedNicknamesNilCacheIsArray(t *testing.T) {
	h := handleBannedNicknames(nil) // ban features disabled
	rr := httptest.NewRecorder()
	h(rr, httptest.NewRequest(http.MethodGet, "/api/banned-nicknames", nil))
	// nil cache must serialize as [] (not null).
	if got, want := rr.Body.String(), "{\"nicknames\":[]}\n"; got != want {
		t.Errorf("nil-cache body = %q, want %q", got, want)
	}
}

func TestHandleBannedNicknamesOptions(t *testing.T) {
	h := handleBannedNicknames(nil)
	rr := httptest.NewRecorder()
	h(rr, httptest.NewRequest(http.MethodOptions, "/api/banned-nicknames", nil))
	if rr.Code != http.StatusNoContent {
		t.Errorf("OPTIONS status = %d, want 204", rr.Code)
	}
}

func TestHandleBannedNicknamesMethodNotAllowed(t *testing.T) {
	h := handleBannedNicknames(nil)
	rr := httptest.NewRecorder()
	h(rr, httptest.NewRequest(http.MethodPost, "/api/banned-nicknames", nil))
	if rr.Code != http.StatusMethodNotAllowed {
		t.Errorf("POST status = %d, want 405", rr.Code)
	}
}
