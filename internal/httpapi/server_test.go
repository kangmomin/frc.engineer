package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"frc.engineer/internal/auth"
)

func TestRequireSessionRejectsMissingCookie(t *testing.T) {
	store := auth.NewInMemorySessionStore()
	s := &Server{
		sessions:          store,
		sessionCookieName: "frc_session",
	}

	handler := s.RequireSession(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/config", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
}

func TestRequireSessionAcceptsValidCookie(t *testing.T) {
	store := auth.NewInMemorySessionStore()
	session, err := store.Create(auth.User{ID: "u1"}, "token", time.Hour)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	s := &Server{
		sessions:          store,
		sessionCookieName: "frc_session",
	}

	handler := s.RequireSession(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/config", nil)
	req.AddCookie(&http.Cookie{
		Name:  "frc_session",
		Value: session.ID,
	})
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusNoContent)
	}
}

