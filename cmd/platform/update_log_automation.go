package main

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"net"
	"net/http"
	"net/netip"
	"strconv"
	"strings"
	"time"

	"frc.engineer/internal/platformsvc"
)

type updateLogAutomationConfig struct {
	keyHash        [sha256.Size]byte
	trustedProxies []netip.Prefix
}

func parseUpdateLogAutomationConfig(rawHash, rawProxies string) (*updateLogAutomationConfig, error) {
	rawHash = strings.TrimSpace(rawHash)
	if rawHash == "" {
		return nil, nil // opt in; manual Steam-authenticated publication is unaffected
	}
	digest, err := hex.DecodeString(rawHash)
	if err != nil || len(digest) != sha256.Size {
		return nil, errors.New("PLATFORM_UPDATE_LOG_API_KEY_SHA256 must contain a 64-character SHA-256 hex digest")
	}
	config := &updateLogAutomationConfig{}
	copy(config.keyHash[:], digest)
	if strings.TrimSpace(rawProxies) != "" {
		for _, raw := range strings.Split(rawProxies, ",") {
			prefix, err := netip.ParsePrefix(strings.TrimSpace(raw))
			if err != nil || prefix.Bits() == 0 || prefix.Addr().Is4In6() {
				return nil, errors.New("PLATFORM_UPDATE_LOG_TRUSTED_PROXY_CIDRS must contain explicit trusted CIDRs (use IPv4 notation for mapped IPv4)")
			}
			config.trustedProxies = append(config.trustedProxies, prefix.Masked())
		}
	}
	return config, nil
}

func (c *updateLogAutomationConfig) validKey(r *http.Request) bool {
	values := r.Header.Values("Authorization")
	if len(values) != 1 || !strings.HasPrefix(values[0], "Bearer ") {
		return false
	}
	token := strings.TrimPrefix(values[0], "Bearer ")
	if len(token) != 43 {
		return false
	}
	decoded, err := base64.RawURLEncoding.Strict().DecodeString(token)
	if err != nil || len(decoded) != 32 {
		return false
	}
	digest := sha256.Sum256([]byte(token))
	return subtle.ConstantTimeCompare(digest[:], c.keyHash[:]) == 1
}

// Only the explicit proxy list can vouch for forwarding headers. Private and
// loopback addresses receive no implicit trust on this machine-auth endpoint.
func (c *updateLogAutomationConfig) clientIP(r *http.Request) (netip.Addr, error) {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	peer, err := netip.ParseAddr(host)
	if err != nil {
		return netip.Addr{}, errors.New("invalid client address")
	}
	peer = peer.Unmap().WithZone("")
	trusted := func(ip netip.Addr) bool {
		for _, prefix := range c.trustedProxies {
			if prefix.Contains(ip) {
				return true
			}
		}
		return false
	}
	headers := r.Header.Values("X-Forwarded-For")
	if !trusted(peer) || len(headers) != 1 {
		return peer, nil
	}
	client := peer
	chain := strings.Split(headers[0], ",")
	for i := len(chain) - 1; i >= 0; i-- {
		if !trusted(client) {
			break
		}
		hop, err := netip.ParseAddr(strings.TrimSpace(chain[i]))
		if err != nil {
			return peer, nil
		}
		client = hop.Unmap().WithZone("")
	}
	return client, nil
}

func (s *server) handleAutomationUpdateLog(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	config := s.updateLogAutomation
	if config == nil {
		http.NotFound(w, r)
		return
	}
	client, err := config.clientIP(r)
	if err != nil {
		http.Error(w, "invalid client address", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	valid := config.validKey(r)
	clientHash := sha256.Sum256([]byte(client.String()))
	retry, err := s.store.CheckUpdateLogAutomationRate(ctx, hex.EncodeToString(clientHash[:]), valid)
	if err != nil {
		s.updateLogError(w, err)
		return
	}
	if retry > 0 {
		w.Header().Set("Retry-After", strconv.Itoa(retry))
		http.Error(w, "too many requests", http.StatusTooManyRequests)
		return
	}
	if !valid {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if r.URL.RawQuery != "" {
		http.Error(w, "query parameters are not supported", http.StatusBadRequest)
		return
	}
	var req platformsvc.PublishUpdateLogRequest
	if !decodeUpdateLogBody(w, r, 128<<10, &req) {
		return
	}
	result, err := s.store.PublishUpdateLog(ctx, req)
	if errors.Is(err, platformsvc.ErrConflict) {
		http.Error(w, "releaseKey already published with different content", http.StatusConflict)
		return
	}
	if err != nil {
		s.updateLogError(w, err)
		return
	}
	status := http.StatusCreated
	if result.Replayed {
		status = http.StatusOK
	}
	if s.log != nil {
		s.log.Info("update log automation published", "id", result.Entry.ID, "replayed", result.Replayed)
	}
	writeJSON(w, status, result)
}
