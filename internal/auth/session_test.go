package auth

import (
	"testing"
	"time"
)

func TestInMemorySessionStoreCreateAndGet(t *testing.T) {
	store := NewInMemorySessionStore()
	user := User{ID: "u1", Email: "test@example.com"}

	session, err := store.Create(user, "token-1", time.Hour)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if session.ID == "" {
		t.Fatalf("Create() returned empty session ID")
	}

	got, ok := store.Get(session.ID)
	if !ok {
		t.Fatalf("Get() returned ok=false")
	}
	if got.User.ID != user.ID {
		t.Fatalf("Get().User.ID = %q, want %q", got.User.ID, user.ID)
	}
	if got.AccessToken != "token-1" {
		t.Fatalf("Get().AccessToken = %q, want token-1", got.AccessToken)
	}
}

func TestInMemorySessionStoreGetExpiredSession(t *testing.T) {
	store := NewInMemorySessionStore()
	session, err := store.Create(User{ID: "u1"}, "token", 10*time.Millisecond)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	time.Sleep(20 * time.Millisecond)
	if _, ok := store.Get(session.ID); ok {
		t.Fatalf("Get() returned expired session")
	}
}

func TestInMemorySessionStoreCleanupExpired(t *testing.T) {
	store := NewInMemorySessionStore()

	s1, err := store.Create(User{ID: "u1"}, "token-1", time.Hour)
	if err != nil {
		t.Fatalf("Create(s1) error = %v", err)
	}
	_, err = store.Create(User{ID: "u2"}, "token-2", time.Hour)
	if err != nil {
		t.Fatalf("Create(s2) error = %v", err)
	}

	store.mu.Lock()
	expired := store.sessions[s1.ID]
	expired.ExpiresAt = time.Now().Add(-time.Minute)
	store.sessions[s1.ID] = expired
	store.mu.Unlock()

	removed := store.CleanupExpired(time.Now())
	if removed != 1 {
		t.Fatalf("CleanupExpired() removed %d sessions, want 1", removed)
	}
	if _, ok := store.Get(s1.ID); ok {
		t.Fatalf("expired session still exists after CleanupExpired")
	}
}

func TestInMemorySessionStoreDelete(t *testing.T) {
	store := NewInMemorySessionStore()
	session, err := store.Create(User{ID: "u1"}, "token", time.Hour)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	store.Delete(session.ID)
	if _, ok := store.Get(session.ID); ok {
		t.Fatalf("Delete() did not remove session")
	}
}

