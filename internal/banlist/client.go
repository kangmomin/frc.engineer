// Package banlist provides the shared nickname-ban primitives used by both the
// signaling server (which serves the list) and the sender (which fetches and
// matches against it). Keeping Normalize here guarantees both sides canonicalize
// names identically — otherwise entries would silently never match.
package banlist

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"
)

// Normalize canonicalizes a name for ban comparison: trimmed + lowercased.
// Both the server (emitting the list) and the sender (matching player names)
// MUST use this exact rule.
func Normalize(name string) string {
	return strings.ToLower(strings.TrimSpace(name))
}

// Store holds the current banned-nickname set, safe for concurrent access.
// The sender's processor reads it on every packet; the poller swaps it wholesale.
type Store struct {
	mu     sync.RWMutex
	banned map[string]struct{}
	loaded bool
}

// NewStore creates an empty Store. Until Replace succeeds, nobody is banned.
func NewStore() *Store {
	return &Store{banned: make(map[string]struct{})}
}

// IsBanned reports whether playerName matches the banned set. Empty or
// whitespace-only names are never banned — this covers the game-not-started and
// online-names-hidden cases where the player name is unavailable.
func (s *Store) IsBanned(playerName string) bool {
	n := Normalize(playerName)
	if n == "" {
		return false
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	_, ok := s.banned[n]
	return ok
}

// Replace swaps the banned set with the normalized form of names. Empty entries
// are dropped. Marks the store as loaded (at least one successful fetch).
func (s *Store) Replace(names []string) {
	set := make(map[string]struct{}, len(names))
	for _, name := range names {
		if n := Normalize(name); n != "" {
			set[n] = struct{}{}
		}
	}
	s.mu.Lock()
	s.banned = set
	s.loaded = true
	s.mu.Unlock()
}

// Loaded reports whether at least one successful Replace has happened. Useful to
// distinguish "nobody banned" from "never fetched".
func (s *Store) Loaded() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.loaded
}

// Count returns the number of banned entries (diagnostics/logging).
func (s *Store) Count() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.banned)
}

// bannedResponse is the wire shape of GET /api/banned-nicknames. Wrapped in an
// object (not a bare array) to leave room for future fields (updatedAt/version).
type bannedResponse struct {
	Nicknames []string `json:"nicknames"`
}

// Client fetches the banned-nickname list from the signaling server over HTTP.
// Modeled on internal/frcapi.Client.
type Client struct {
	httpBase string
	http     *http.Client
}

// NewClient creates a banlist Client. httpBase is the signaling HTTP origin
// (e.g. "https://host"), without the /api path.
func NewClient(httpBase string) *Client {
	return &Client{
		httpBase: strings.TrimRight(httpBase, "/"),
		http:     &http.Client{Timeout: 10 * time.Second},
	}
}

// Fetch retrieves the current banned-nickname list. Returns an error on
// network/non-200 failures so the caller can apply its fail-open policy.
func (c *Client) Fetch(ctx context.Context) ([]string, error) {
	endpoint := c.httpBase + "/api/banned-nicknames"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("banlist: build request: %w", err)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("banlist: request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("banlist: unexpected status %d", resp.StatusCode)
	}
	var out bannedResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, fmt.Errorf("banlist: decode response: %w", err)
	}
	return out.Nicknames, nil
}
