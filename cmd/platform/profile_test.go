package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHandleProfileUnauthenticatedIsNoStore(t *testing.T) {
	srv := &server{}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /profiles/{id}", srv.handleProfile)

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/profiles/not-a-uuid", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
	if got := rec.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("Cache-Control = %q, want no-store", got)
	}
}
