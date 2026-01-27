package config

import (
	"os"
	"strconv"
)

// Config holds the server configuration
type Config struct {
	// UDP settings
	UDPPort       int // F1 25 telemetry UDP port (default: 20777)
	UDPBufferSize int // UDP receive channel buffer size (default: 128)

	// WebSocket settings
	WSPort            int // WebSocket server HTTP port (default: 8080)
	WSBroadcastBuffer int // WebSocket broadcast channel buffer size (default: 64)

	// Telemetry settings
	TelemetryUpdateHz int // Target update rate to clients in Hz (default: 30)

	// Storage settings
	DataDir string // Base directory for persistent data (default: "data/tracks")
}

// DefaultConfig returns a Config with default values
func DefaultConfig() *Config {
	return &Config{
		UDPPort:           20777,
		UDPBufferSize:     128,
		WSPort:            8080,
		WSBroadcastBuffer: 64,
		TelemetryUpdateHz: 30,
		DataDir:           "data/tracks",
	}
}

// LoadFromEnv loads configuration from environment variables
func LoadFromEnv() *Config {
	cfg := DefaultConfig()

	if v := os.Getenv("F1_UDP_PORT"); v != "" {
		if port, err := strconv.Atoi(v); err == nil {
			cfg.UDPPort = port
		}
	}

	if v := os.Getenv("F1_UDP_BUFFER_SIZE"); v != "" {
		if size, err := strconv.Atoi(v); err == nil {
			cfg.UDPBufferSize = size
		}
	}

	if v := os.Getenv("F1_WS_PORT"); v != "" {
		if port, err := strconv.Atoi(v); err == nil {
			cfg.WSPort = port
		}
	}

	if v := os.Getenv("F1_WS_BROADCAST_BUFFER"); v != "" {
		if size, err := strconv.Atoi(v); err == nil {
			cfg.WSBroadcastBuffer = size
		}
	}

	if v := os.Getenv("F1_TELEMETRY_UPDATE_HZ"); v != "" {
		if hz, err := strconv.Atoi(v); err == nil {
			cfg.TelemetryUpdateHz = hz
		}
	}

	if v := os.Getenv("F1_DATA_DIR"); v != "" {
		cfg.DataDir = v
	}

	return cfg
}
