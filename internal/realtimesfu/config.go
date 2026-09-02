package realtimesfu

import (
	"fmt"
	"os"
	"strings"
)

const (
	EnvAppID     = "CLOUDFLARE_SFU_APP_ID"
	EnvAppSecret = "CLOUDFLARE_SFU_APP_SECRET"
)

type Config struct {
	AppID     string
	AppSecret string
	Enabled   bool
}

func LoadConfigFromEnv() (Config, error) {
	appID := strings.TrimSpace(os.Getenv(EnvAppID))
	secret := strings.TrimSpace(os.Getenv(EnvAppSecret))
	if appID == "" && secret == "" {
		return Config{}, nil
	}
	if appID == "" || secret == "" {
		return Config{}, fmt.Errorf("incomplete realtime SFU configuration")
	}
	if !validIdentifier(appID, 128) || !validIdentifier(secret, 512) {
		return Config{}, fmt.Errorf("invalid realtime SFU configuration")
	}
	return Config{AppID: appID, AppSecret: secret, Enabled: true}, nil
}

func validIdentifier(value string, max int) bool {
	if value == "" || len(value) > max {
		return false
	}
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' || r == '.' {
			continue
		}
		return false
	}
	return true
}
