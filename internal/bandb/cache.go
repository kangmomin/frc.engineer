package bandb

import "sync"

// Cache holds the banned IP set and banned nickname set in memory so the
// signaling hot paths (WS upgrade gate, nickname matcher) never touch the DB.
// A poller refreshes it from Postgres periodically; auto-bans add to it
// synchronously for immediate effect.
type Cache struct {
	mu          sync.RWMutex
	ips         map[string]struct{}
	nicks       map[string]struct{}
	ipsLoaded   bool
	nicksLoaded bool
}

// NewCache returns an empty cache (nothing banned until a Replace runs).
func NewCache() *Cache {
	return &Cache{ips: make(map[string]struct{}), nicks: make(map[string]struct{})}
}

// HasIP reports whether ip (already normalized via ClientIP) is banned.
func (c *Cache) HasIP(ip string) bool {
	if ip == "" {
		return false
	}
	c.mu.RLock()
	defer c.mu.RUnlock()
	_, ok := c.ips[ip]
	return ok
}

// AddIP adds a single IP for immediate effect (used right after an auto-ban
// INSERT, so the next connection from that IP is blocked without waiting for the
// next poll).
func (c *Cache) AddIP(ip string) {
	if ip == "" {
		return
	}
	c.mu.Lock()
	c.ips[ip] = struct{}{}
	c.mu.Unlock()
}

// ReplaceIPs swaps the IP set wholesale (periodic DB→cache sync; also reflects
// manual DELETEs).
func (c *Cache) ReplaceIPs(ips []string) {
	set := make(map[string]struct{}, len(ips))
	for _, ip := range ips {
		if ip != "" {
			set[ip] = struct{}{}
		}
	}
	c.mu.Lock()
	c.ips = set
	c.ipsLoaded = true
	c.mu.Unlock()
}

// HasNick reports whether the given ALREADY-NORMALIZED nickname is banned.
// Callers must pass banlist.Normalize(name).
func (c *Cache) HasNick(normalizedNick string) bool {
	if normalizedNick == "" {
		return false
	}
	c.mu.RLock()
	defer c.mu.RUnlock()
	_, ok := c.nicks[normalizedNick]
	return ok
}

// ReplaceNicks swaps the nickname set wholesale. Entries are expected to be
// already normalized (the store normalizes on read/write).
func (c *Cache) ReplaceNicks(nicks []string) {
	set := make(map[string]struct{}, len(nicks))
	for _, n := range nicks {
		if n != "" {
			set[n] = struct{}{}
		}
	}
	c.mu.Lock()
	c.nicks = set
	c.nicksLoaded = true
	c.mu.Unlock()
}

// Nicknames returns the current banned nickname list (served to senders via
// GET /api/banned-nicknames).
func (c *Cache) Nicknames() []string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	out := make([]string, 0, len(c.nicks))
	for n := range c.nicks {
		out = append(out, n)
	}
	return out
}

// IPCount / NickCount are for diagnostics/logging.
func (c *Cache) IPCount() int {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return len(c.ips)
}

func (c *Cache) NickCount() int {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return len(c.nicks)
}
