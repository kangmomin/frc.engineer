package auth

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"sync"
	"time"
)

// Session holds per-client authenticated state.
type Session struct {
	ID          string
	User        User
	AccessToken string
	CreatedAt   time.Time
	ExpiresAt   time.Time
}

// SessionStore manages session lifecycle.
type SessionStore interface {
	Create(user User, accessToken string, ttl time.Duration) (*Session, error)
	Get(sessionID string) (*Session, bool)
	Delete(sessionID string)
	CleanupExpired(now time.Time) int
}

// InMemorySessionStore stores sessions in memory.
type InMemorySessionStore struct {
	mu       sync.RWMutex
	sessions map[string]Session
}

// NewInMemorySessionStore creates an in-memory session store.
func NewInMemorySessionStore() *InMemorySessionStore {
	return &InMemorySessionStore{
		sessions: make(map[string]Session),
	}
}

// Create inserts a new session with expiration.
func (s *InMemorySessionStore) Create(user User, accessToken string, ttl time.Duration) (*Session, error) {
	if ttl <= 0 {
		return nil, fmt.Errorf("session ttl must be positive")
	}
	id, err := newSessionID()
	if err != nil {
		return nil, err
	}

	now := time.Now().UTC()
	session := Session{
		ID:          id,
		User:        user,
		AccessToken: accessToken,
		CreatedAt:   now,
		ExpiresAt:   now.Add(ttl),
	}

	s.mu.Lock()
	s.sessions[id] = session
	s.mu.Unlock()

	copy := session
	return &copy, nil
}

// Get returns a valid session if present.
func (s *InMemorySessionStore) Get(sessionID string) (*Session, bool) {
	if sessionID == "" {
		return nil, false
	}

	s.mu.RLock()
	session, ok := s.sessions[sessionID]
	s.mu.RUnlock()
	if !ok {
		return nil, false
	}

	if time.Now().UTC().After(session.ExpiresAt) {
		s.Delete(sessionID)
		return nil, false
	}

	copy := session
	return &copy, true
}

// Delete removes a session by ID.
func (s *InMemorySessionStore) Delete(sessionID string) {
	if sessionID == "" {
		return
	}
	s.mu.Lock()
	delete(s.sessions, sessionID)
	s.mu.Unlock()
}

// CleanupExpired removes all expired sessions and returns the count.
func (s *InMemorySessionStore) CleanupExpired(now time.Time) int {
	s.mu.Lock()
	defer s.mu.Unlock()

	removed := 0
	for id, session := range s.sessions {
		if now.After(session.ExpiresAt) {
			delete(s.sessions, id)
			removed++
		}
	}
	return removed
}

func newSessionID() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("failed to generate session id: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

