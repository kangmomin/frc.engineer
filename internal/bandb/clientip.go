// Package bandb provides the signaling server's Postgres-backed ban store
// (banned nicknames + auto-banned IPs), an in-memory cache for hot-path lookups,
// and client-IP extraction. The sender does not import this package; it polls
// nicknames over HTTP and is matched server-side.
package bandb

import (
	"net"
	"net/http"
	"strings"
)

// ClientIP extracts the client IP from an HTTP request, trusting the platform
// edge proxy's X-Forwarded-For (Railway). Returns "" when no usable IP is found,
// which callers treat as "cannot identify" (never banned, fail-open).
//
// SECURITY: this assumes the edge proxy SETS/OVERWRITES X-Forwarded-For. If the
// edge merely appends, the left-most entry is client-controlled and spoofable.
// Verify the actual Railway header behavior before relying on this for blocking.
func ClientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		// "client, proxy1, proxy2" — the left-most entry is the original client.
		if ip := normalizeIP(strings.Split(xff, ",")[0]); ip != "" {
			return ip
		}
	}
	if ip := normalizeIP(r.Header.Get("X-Real-IP")); ip != "" {
		return ip
	}
	host := r.RemoteAddr
	if h, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		host = h
	}
	return normalizeIP(host)
}

// normalizeIP canonicalizes an IP string so cache keys and DB primary keys match
// regardless of representation (IPv4-mapped→IPv4, IPv6 zone/short-form unified).
// Returns "" if the input is not a valid IP.
func normalizeIP(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	if ip := net.ParseIP(s); ip != nil {
		return ip.String()
	}
	return ""
}
