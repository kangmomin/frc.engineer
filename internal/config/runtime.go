package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
)

// DataStorageMode controls what race data is persisted.
type DataStorageMode string

const (
	// DataStorageModeResultOnly keeps current minimal race-result summary storage.
	DataStorageModeResultOnly DataStorageMode = "resultOnly"
	// DataStorageModeSummary stores dashboard-visible state snapshots for replay.
	DataStorageModeSummary DataStorageMode = "summary"
	// DataStorageModeAdvanced stores full UDP packet logs plus summary snapshots.
	DataStorageModeAdvanced DataStorageMode = "advanced"
)

// NormalizeDataStorageMode returns a safe, known mode.
func NormalizeDataStorageMode(mode DataStorageMode) DataStorageMode {
	switch mode {
	case DataStorageModeSummary, DataStorageModeAdvanced:
		return mode
	default:
		return DataStorageModeResultOnly
	}
}

// ForwardTarget represents a UDP forwarding destination
type ForwardTarget struct {
	Host    string `json:"host"`
	Port    int    `json:"port"`
	Enabled bool   `json:"enabled"`
}

// RuntimeConfig holds runtime-changeable settings
type RuntimeConfig struct {
	UDPPort              int             `json:"udpPort"`
	BackendPort          int             `json:"backendPort"`
	ForwardTargets       []ForwardTarget `json:"forwardTargets"`
	TrackRecording       bool            `json:"trackRecording"`
	PacketLogging        bool            `json:"packetLogging"`
	RaceSummaryRecording bool            `json:"raceSummaryRecording"`
	DataStorageMode      DataStorageMode `json:"dataStorageMode"`
}

// RuntimeConfigManager manages persistent runtime configuration
type RuntimeConfigManager struct {
	mu       sync.RWMutex
	config   RuntimeConfig
	filePath string
}

// NewRuntimeConfigManager creates a manager, loading from file if it exists
func NewRuntimeConfigManager(configFilePath string, defaultUDPPort, defaultBackendPort int) *RuntimeConfigManager {
	m := &RuntimeConfigManager{
		filePath: configFilePath,
		config: RuntimeConfig{
			UDPPort:              defaultUDPPort,
			BackendPort:          defaultBackendPort,
			RaceSummaryRecording: true,
			DataStorageMode:      DataStorageModeResultOnly,
		},
	}
	m.load()
	return m
}

// Get returns a copy of the current config
func (m *RuntimeConfigManager) Get() RuntimeConfig {
	m.mu.RLock()
	defer m.mu.RUnlock()
	cfg := m.config
	// Return a copy of the slice
	if m.config.ForwardTargets != nil {
		cfg.ForwardTargets = make([]ForwardTarget, len(m.config.ForwardTargets))
		copy(cfg.ForwardTargets, m.config.ForwardTargets)
	}
	return cfg
}

// Update replaces the config and persists it
func (m *RuntimeConfigManager) Update(cfg RuntimeConfig) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	cfg.DataStorageMode = NormalizeDataStorageMode(cfg.DataStorageMode)
	m.config = cfg
	return m.save()
}

func (m *RuntimeConfigManager) load() {
	data, err := os.ReadFile(m.filePath)
	if err != nil {
		return // File doesn't exist yet, use defaults
	}
	_ = json.Unmarshal(data, &m.config)
	m.config.DataStorageMode = NormalizeDataStorageMode(m.config.DataStorageMode)
}

func (m *RuntimeConfigManager) save() error {
	dir := filepath.Dir(m.filePath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(m.config, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(m.filePath, data, 0644)
}
