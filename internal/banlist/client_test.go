package banlist

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestNormalize(t *testing.T) {
	cases := map[string]string{
		"  Hello  ":  "hello",
		"WORLD":      "world",
		"":           "",
		"   ":        "",
		"MixEd Case": "mixed case",
	}
	for in, want := range cases {
		if got := Normalize(in); got != want {
			t.Errorf("Normalize(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestStoreIsBanned(t *testing.T) {
	s := NewStore()
	if s.IsBanned("anyone") {
		t.Fatal("empty store should ban nobody")
	}
	s.Replace([]string{"  BadGuy ", "spammer", ""})

	if !s.IsBanned("badguy") {
		t.Error("normalized stored entry should match")
	}
	if !s.IsBanned("  BADGUY  ") {
		t.Error("input should be normalized before matching")
	}
	if !s.IsBanned("spammer") {
		t.Error("spammer should be banned")
	}
	if s.IsBanned("gooduser") {
		t.Error("unlisted user should not be banned")
	}
	if s.IsBanned("") {
		t.Error("empty name should never be banned")
	}
	if s.IsBanned("   ") {
		t.Error("whitespace-only name should never be banned")
	}
}

func TestStoreReplaceSwaps(t *testing.T) {
	s := NewStore()
	s.Replace([]string{"a", "b"})
	if s.Count() != 2 {
		t.Errorf("Count = %d, want 2", s.Count())
	}
	// Replace must swap wholesale, not merge.
	s.Replace([]string{"c"})
	if s.IsBanned("a") {
		t.Error("old entries should be cleared on Replace")
	}
	if !s.IsBanned("c") {
		t.Error("new entry should be present after Replace")
	}
	if !s.Loaded() {
		t.Error("Loaded should be true after a successful Replace")
	}
}

func TestClientFetchSuccess(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/banned-nicknames" {
			http.NotFound(w, r)
			return
		}
		_ = json.NewEncoder(w).Encode(bannedResponse{Nicknames: []string{"nick1", "nick2"}})
	}))
	defer srv.Close()

	names, err := NewClient(srv.URL).Fetch(context.Background())
	if err != nil {
		t.Fatalf("Fetch error: %v", err)
	}
	if len(names) != 2 || names[0] != "nick1" || names[1] != "nick2" {
		t.Errorf("unexpected names: %v", names)
	}
}

func TestClientFetchNon200(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	if _, err := NewClient(srv.URL).Fetch(context.Background()); err == nil {
		t.Error("expected error on 500 status (caller applies fail-open)")
	}
}

func TestClientFetchBadJSON(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("not json"))
	}))
	defer srv.Close()

	if _, err := NewClient(srv.URL).Fetch(context.Background()); err == nil {
		t.Error("expected decode error on malformed JSON")
	}
}
