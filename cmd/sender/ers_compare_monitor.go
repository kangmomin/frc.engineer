package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"frc.engineer/internal/dto"
)

type ersCompareMetrics struct {
	CurrentErrorPP    int     `json:"currentErrorPP"`
	CurrentErrorReady bool    `json:"currentErrorReady"`
	SessionMAEPP      float64 `json:"sessionMaePP"`
	SessionBiasPP     float64 `json:"sessionBiasPP"`
	Within10Rate      float64 `json:"within10Rate"`
	SampleCount       int     `json:"sampleCount"`
	ComparableDrivers int     `json:"comparableDrivers"`
	LogPath           string  `json:"logPath,omitempty"`
	UpdatedAt         int64   `json:"updatedAt"`
}

type ersCompareLogSample struct {
	TimestampMS          int64   `json:"timestampMs"`
	SessionUID           uint64  `json:"sessionUid"`
	SessionType          string  `json:"sessionType,omitempty"`
	TrackID              int8    `json:"trackId"`
	TrackName            string  `json:"trackName,omitempty"`
	TrackLength          int     `json:"trackLength"`
	PlayerIndex          int     `json:"playerIndex"`
	DriverIndex          int     `json:"driverIndex"`
	IsPlayer             bool    `json:"isPlayer"`
	DriverName           string  `json:"driverName,omitempty"`
	TeamID               int     `json:"teamId"`
	Position             int     `json:"position"`
	CurrentLapNum        int     `json:"currentLapNum"`
	CurrentSector        int     `json:"currentSector"`
	LapDistance          float32 `json:"lapDistance"`
	Speed                uint16  `json:"speed"`
	Throttle             float32 `json:"throttle"`
	Brake                float32 `json:"brake"`
	ERSDeployMode        int     `json:"ersDeployMode"`
	EstimatePct          int     `json:"estimatePct"`
	ActualPct            int     `json:"actualPct"`
	ErrorPP              int     `json:"errorPP"`
	AbsErrorPP           int     `json:"absErrorPP"`
	ERSStoreEnergyJ      float32 `json:"ersStoreEnergyJ"`
	ERSDeployedThisLapJ  float32 `json:"ersDeployedThisLapJ"`
	ERSHarvestedThisLapJ float32 `json:"ersHarvestedThisLapJ"`
}

type ersCompareMonitor struct {
	mu sync.Mutex

	rootDir string
	logger  *slog.Logger

	sessionUID        uint64
	sampleCount       int
	comparableDrivers int
	absErrorSum       float64
	errorSum          float64
	within10Count     int
	currentErrorPP    int
	currentErrorReady bool
	updatedAt         int64
	logPath           string

	file    *os.File
	writer  *bufio.Writer
	encoder *json.Encoder
}

func newERSCompareMonitor(rootDir string, logger *slog.Logger) *ersCompareMonitor {
	if logger == nil {
		logger = slog.Default()
	}
	return &ersCompareMonitor{
		rootDir: rootDir,
		logger:  logger,
	}
}

func (m *ersCompareMonitor) Observe(sessionUID uint64, capturedAt time.Time, state *dto.PitwallState) {
	if state == nil {
		return
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	if !state.ERSComparisonEnabled || sessionUID == 0 {
		m.resetLocked()
		return
	}

	if sessionUID != m.sessionUID || m.encoder == nil {
		if err := m.startSessionLocked(sessionUID, capturedAt, state); err != nil {
			m.logger.Error("failed to start ERS compare log", "error", err)
			m.resetLocked()
			return
		}
	}

	m.comparableDrivers = 0
	m.currentErrorReady = false
	m.updatedAt = capturedAt.UnixMilli()

	for i := range state.Drivers {
		driver := state.Drivers[i]
		if !driver.ERSActualReady || !driver.ERSEstimateReady {
			continue
		}

		errorPP := driver.ERSEstimatePct - driver.ERSActualPct
		absErrorPP := errorPP
		if absErrorPP < 0 {
			absErrorPP = -absErrorPP
		}

		m.sampleCount++
		m.comparableDrivers++
		m.absErrorSum += float64(absErrorPP)
		m.errorSum += float64(errorPP)
		if absErrorPP <= 10 {
			m.within10Count++
		}
		if driver.Index == state.PlayerIndex {
			m.currentErrorPP = errorPP
			m.currentErrorReady = true
		}

		if err := m.encoder.Encode(ersCompareLogSample{
			TimestampMS:          capturedAt.UnixMilli(),
			SessionUID:           sessionUID,
			SessionType:          sessionTypeFromState(state),
			TrackID:              trackIDFromState(state),
			TrackName:            trackNameFromState(state),
			TrackLength:          trackLengthFromState(state),
			PlayerIndex:          state.PlayerIndex,
			DriverIndex:          driver.Index,
			IsPlayer:             driver.Index == state.PlayerIndex,
			DriverName:           driver.Name,
			TeamID:               driver.TeamID,
			Position:             driver.Position,
			CurrentLapNum:        driver.CurrentLapNum,
			CurrentSector:        driver.CurrentSector,
			LapDistance:          driver.LapDistance,
			Speed:                driver.Speed,
			Throttle:             driver.Throttle,
			Brake:                driver.Brake,
			ERSDeployMode:        driver.ERSDeployMode,
			EstimatePct:          driver.ERSEstimatePct,
			ActualPct:            driver.ERSActualPct,
			ErrorPP:              errorPP,
			AbsErrorPP:           absErrorPP,
			ERSStoreEnergyJ:      driver.ERSStoreEnergy,
			ERSDeployedThisLapJ:  driver.ERSDeployedThisLap,
			ERSHarvestedThisLapJ: driver.ERSHarvestedThisLap,
		}); err != nil {
			m.logger.Error("failed to write ERS compare sample", "error", err, "path", m.logPath)
			break
		}
	}

	if m.writer != nil {
		if err := m.writer.Flush(); err != nil {
			m.logger.Error("failed to flush ERS compare log", "error", err, "path", m.logPath)
		}
	}
}

func (m *ersCompareMonitor) Snapshot() ersCompareMetrics {
	m.mu.Lock()
	defer m.mu.Unlock()

	metrics := ersCompareMetrics{
		CurrentErrorPP:    m.currentErrorPP,
		CurrentErrorReady: m.currentErrorReady,
		SampleCount:       m.sampleCount,
		ComparableDrivers: m.comparableDrivers,
		LogPath:           m.logPath,
		UpdatedAt:         m.updatedAt,
	}
	if m.sampleCount > 0 {
		metrics.SessionMAEPP = m.absErrorSum / float64(m.sampleCount)
		metrics.SessionBiasPP = m.errorSum / float64(m.sampleCount)
		metrics.Within10Rate = (float64(m.within10Count) / float64(m.sampleCount)) * 100
	}
	return metrics
}

func (m *ersCompareMonitor) Reset() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.resetLocked()
}

func (m *ersCompareMonitor) Close() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.resetLocked()
	m.logPath = ""
}

func (m *ersCompareMonitor) startSessionLocked(sessionUID uint64, capturedAt time.Time, state *dto.PitwallState) error {
	m.resetLocked()

	if err := os.MkdirAll(m.rootDir, 0755); err != nil {
		return fmt.Errorf("create ERS compare log dir: %w", err)
	}

	nameParts := []string{"ers_compare", fmt.Sprintf("%d", sessionUID)}
	if trackName := sanitizePathSegment(trackNameFromState(state)); trackName != "" {
		nameParts = append(nameParts, trackName)
	}
	nameParts = append(nameParts, capturedAt.Format("20060102_150405"), fmt.Sprintf("%03d", capturedAt.Nanosecond()/1_000_000))
	fileName := strings.Join(nameParts, "_") + ".jsonl"
	logPath := filepath.Join(m.rootDir, fileName)

	file, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return fmt.Errorf("open ERS compare log: %w", err)
	}

	m.sessionUID = sessionUID
	m.file = file
	m.writer = bufio.NewWriter(file)
	m.encoder = json.NewEncoder(m.writer)
	m.logPath = logPath
	m.updatedAt = capturedAt.UnixMilli()
	return nil
}

func (m *ersCompareMonitor) resetLocked() {
	if m.writer != nil {
		if err := m.writer.Flush(); err != nil {
			m.logger.Error("failed to flush ERS compare log during reset", "error", err, "path", m.logPath)
		}
	}
	if m.file != nil {
		if err := m.file.Close(); err != nil {
			m.logger.Error("failed to close ERS compare log", "error", err, "path", m.logPath)
		}
	}

	m.sessionUID = 0
	m.sampleCount = 0
	m.comparableDrivers = 0
	m.absErrorSum = 0
	m.errorSum = 0
	m.within10Count = 0
	m.currentErrorPP = 0
	m.currentErrorReady = false
	m.updatedAt = 0
	m.file = nil
	m.writer = nil
	m.encoder = nil
}

func sanitizePathSegment(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" {
		return ""
	}
	var b strings.Builder
	for _, r := range value {
		switch {
		case r >= 'a' && r <= 'z':
			b.WriteRune(r)
		case r >= '0' && r <= '9':
			b.WriteRune(r)
		default:
			b.WriteByte('_')
		}
	}
	return strings.Trim(b.String(), "_")
}

func sessionTypeFromState(state *dto.PitwallState) string {
	if state.Session == nil {
		return ""
	}
	return state.Session.SessionType
}

func trackIDFromState(state *dto.PitwallState) int8 {
	if state.Session == nil {
		return 0
	}
	return state.Session.TrackID
}

func trackNameFromState(state *dto.PitwallState) string {
	if state.Session == nil {
		return ""
	}
	return state.Session.TrackName
}

func trackLengthFromState(state *dto.PitwallState) int {
	if state.Session == nil {
		return 0
	}
	return state.Session.TrackLength
}
