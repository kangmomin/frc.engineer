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

// ClientIP extracts the client IP from an HTTP request. X-Forwarded-For and
// X-Real-IP are honored ONLY when the request's direct peer (RemoteAddr) falls
// within one of the trusted proxy CIDRs; otherwise those headers are
// attacker-controlled and are ignored (H8). With no trusted proxies configured
// (the safe default), RemoteAddr is always returned. Returns "" when no usable
// IP is found, which callers treat as "cannot identify" (never banned, fail-open).
func ClientIP(r *http.Request, trustedProxies []*net.IPNet) string {
	remoteIP := normalizeIP(remoteAddrHost(r.RemoteAddr))

	// Forwarded headers are trustworthy only when the connection reached us
	// through a known proxy. A direct (untrusted) client can forge them freely.
	if remoteIP != "" && ipInCIDRs(remoteIP, trustedProxies) {
		if ip := forwardedClientIP(r, trustedProxies); ip != "" {
			return ip
		}
	}
	return remoteIP
}

// forwardedClientIP walks X-Forwarded-For right→left (closest hop first),
// skipping trusted-proxy hops, and returns the first untrusted address — the
// real client as observed by the outermost trusted proxy. Falls back to
// X-Real-IP. Returns "" when nothing usable is found.
func forwardedClientIP(r *http.Request, trustedProxies []*net.IPNet) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.Split(xff, ",")
		for i := len(parts) - 1; i >= 0; i-- {
			ip := normalizeIP(parts[i])
			if ip == "" {
				continue
			}
			if ipInCIDRs(ip, trustedProxies) {
				continue // 신뢰 프록시 홉 — 계속 왼쪽으로
			}
			return ip // 첫 비신뢰 주소 = 실제 클라이언트
		}
	}
	return normalizeIP(r.Header.Get("X-Real-IP"))
}

// remoteAddrHost strips the port from a RemoteAddr ("host:port" → "host"),
// tolerating values that carry no port.
func remoteAddrHost(remoteAddr string) string {
	if host, _, err := net.SplitHostPort(remoteAddr); err == nil {
		return host
	}
	return remoteAddr
}

// ipInCIDRs reports whether ip is inside any of the given networks.
func ipInCIDRs(ip string, cidrs []*net.IPNet) bool {
	if len(cidrs) == 0 {
		return false
	}
	parsed := net.ParseIP(ip)
	if parsed == nil {
		return false
	}
	for _, c := range cidrs {
		if c != nil && c.Contains(parsed) {
			return true
		}
	}
	return false
}

// ParseTrustedProxies parses a comma-separated list of CIDRs and/or bare IPs
// (env TRUSTED_PROXY_CIDRS) into networks for ClientIP's trusted-proxy set.
// Bare IPs become /32 (IPv4) or /128 (IPv6). Invalid entries are skipped.
// A blank input yields nil → forwarded headers are never trusted (safe default).
func ParseTrustedProxies(raw string) []*net.IPNet {
	var out []*net.IPNet
	for _, part := range strings.Split(raw, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		if _, ipnet, err := net.ParseCIDR(part); err == nil {
			out = append(out, ipnet)
			continue
		}
		if ip := net.ParseIP(part); ip != nil {
			bits := 32
			if ip.To4() == nil {
				bits = 128
			}
			out = append(out, &net.IPNet{IP: ip, Mask: net.CIDRMask(bits, bits)})
		}
	}
	return out
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
