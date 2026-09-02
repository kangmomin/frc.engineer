// Package turncredentials obtains short-lived ICE credentials without exposing
// the long-lived provider token outside the signaling service.
package turncredentials

import (
	"errors"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	DefaultTTLSeconds = 24 * 60 * 60
	MinTTLSeconds     = 1
	MaxTTLSeconds     = 48 * 60 * 60
)

var (
	// ErrIncompleteConfig deliberately does not identify which secret is absent.
	ErrIncompleteConfig = errors.New("TURN credential provider configuration is incomplete")
	ErrInvalidTTL       = errors.New("TURN credential provider TTL is invalid")
)

// Config contains the provider settings held only by the signaling process.
// Enabled is false when no provider settings are configured, which is a
// supported fail-open state: clients continue with their static/default ICE.
type Config struct {
	KeyID    string
	APIToken string
	TTL      time.Duration
	Enabled  bool
}

// LoadConfigFromEnv parses the signaling-only Cloudflare TURN configuration.
// A completely unset provider is not an error; a partial provider is invalid
// and callers should continue in fallback mode rather than starting partially
// configured.
func LoadConfigFromEnv() (Config, error) {
	return loadConfig(os.Getenv)
}

func loadConfig(getenv func(string) string) (Config, error) {
	config := Config{TTL: time.Duration(DefaultTTLSeconds) * time.Second}

	if rawTTL := strings.TrimSpace(getenv("CLOUDFLARE_TURN_TTL_SECONDS")); rawTTL != "" {
		seconds, err := strconv.Atoi(rawTTL)
		if err != nil || seconds < MinTTLSeconds || seconds > MaxTTLSeconds {
			return config, ErrInvalidTTL
		}
		config.TTL = time.Duration(seconds) * time.Second
	}

	config.KeyID = strings.TrimSpace(getenv("CLOUDFLARE_TURN_KEY_ID"))
	config.APIToken = strings.TrimSpace(getenv("CLOUDFLARE_TURN_API_TOKEN"))
	if config.KeyID == "" && config.APIToken == "" {
		return config, nil
	}
	if config.KeyID == "" || config.APIToken == "" {
		return config, ErrIncompleteConfig
	}
	config.Enabled = true
	return config, nil
}
