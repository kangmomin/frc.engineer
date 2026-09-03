package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestParseSearchQuery(t *testing.T) {
	for _, tt := range []struct {
		name string
		raw  string
		want string
		ok   bool
	}{
		{"trimmed", "  monaco  ", "monaco", true},
		{"unicode runes", " 세나 ", "세나", true},
		{"too short", "x", "", false},
		{"too long", strings.Repeat("a", 65), "", false},
		{"control", "mon\naco", "", false},
		{"invalid utf8", string([]byte{0xff, 'a'}), "", false},
	} {
		got, ok := parseSearchQuery(tt.raw)
		if got != tt.want || ok != tt.ok {
			t.Errorf("%s: parseSearchQuery(%q) = (%q, %v), want (%q, %v)", tt.name, tt.raw, got, ok, tt.want, tt.ok)
		}
	}
}

func TestHandleSearchRejectsMissingDuplicateAndWrongMethod(t *testing.T) {
	srv := &server{}
	for _, tt := range []struct {
		method string
		target string
		want   int
	}{
		{http.MethodGet, "/search", http.StatusBadRequest},
		{http.MethodGet, "/search?q=ab&q=cd", http.StatusBadRequest},
		{http.MethodGet, "/search?q=ab&bad=%zz", http.StatusBadRequest},
		{http.MethodPost, "/search?q=ab", http.StatusMethodNotAllowed},
	} {
		req := httptest.NewRequest(tt.method, tt.target, nil)
		rec := httptest.NewRecorder()
		srv.handleSearch(rec, req)
		if rec.Code != tt.want {
			t.Errorf("%s %s = %d, want %d", tt.method, tt.target, rec.Code, tt.want)
		}
	}
}
