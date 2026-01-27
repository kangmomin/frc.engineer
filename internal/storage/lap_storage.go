package storage

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"frc.engineer/internal/telemetry"
)

// LapStorage defines the interface for persisting lap telemetry data
type LapStorage interface {
	SaveBestLap(trackID int8, lap *telemetry.LapTelemetry) error
	LoadBestLap(trackID int8) (*telemetry.LapTelemetry, error)
}

// FileLapStorage implements LapStorage using JSON files on disk
type FileLapStorage struct {
	baseDir string
	mu      sync.RWMutex
}

// NewFileLapStorage creates a new FileLapStorage instance
// baseDir is the directory where lap data files will be stored (e.g., "data/tracks")
func NewFileLapStorage(baseDir string) (*FileLapStorage, error) {
	// Create the directory structure if it doesn't exist
	if err := os.MkdirAll(baseDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create storage directory: %w", err)
	}

	return &FileLapStorage{
		baseDir: baseDir,
	}, nil
}

// filePath generates the file path for a given track ID
func (s *FileLapStorage) filePath(trackID int8) string {
	return filepath.Join(s.baseDir, fmt.Sprintf("track_%d_best_lap.json", trackID))
}

// SaveBestLap saves the best lap telemetry data to disk
// Uses atomic write (write to temp file, then rename) to prevent corruption
func (s *FileLapStorage) SaveBestLap(trackID int8, lap *telemetry.LapTelemetry) error {
	if lap == nil {
		return fmt.Errorf("lap data is nil")
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	// Marshal to JSON with indentation for readability
	data, err := json.MarshalIndent(lap, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal lap data: %w", err)
	}

	targetPath := s.filePath(trackID)

	// Atomic write: write to temp file first, then rename
	tempPath := targetPath + ".tmp"
	if err := os.WriteFile(tempPath, data, 0644); err != nil {
		return fmt.Errorf("failed to write temp file: %w", err)
	}

	// Rename is atomic on most file systems
	if err := os.Rename(tempPath, targetPath); err != nil {
		// Clean up temp file on rename failure
		os.Remove(tempPath)
		return fmt.Errorf("failed to rename temp file: %w", err)
	}

	return nil
}

// LoadBestLap loads the best lap telemetry data from disk
// Returns nil, nil if the file doesn't exist (no best lap recorded yet)
func (s *FileLapStorage) LoadBestLap(trackID int8) (*telemetry.LapTelemetry, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	filePath := s.filePath(trackID)

	data, err := os.ReadFile(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			// No best lap recorded yet for this track
			return nil, nil
		}
		return nil, fmt.Errorf("failed to read lap data file: %w", err)
	}

	var lap telemetry.LapTelemetry
	if err := json.Unmarshal(data, &lap); err != nil {
		return nil, fmt.Errorf("failed to unmarshal lap data: %w", err)
	}

	return &lap, nil
}

// ListTracks returns a list of track IDs that have saved best laps
func (s *FileLapStorage) ListTracks() ([]int8, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	entries, err := os.ReadDir(s.baseDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("failed to read storage directory: %w", err)
	}

	var trackIDs []int8
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		var trackID int8
		if _, err := fmt.Sscanf(entry.Name(), "track_%d_best_lap.json", &trackID); err == nil {
			trackIDs = append(trackIDs, trackID)
		}
	}

	return trackIDs, nil
}

// DeleteBestLap removes the best lap data for a track
func (s *FileLapStorage) DeleteBestLap(trackID int8) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	filePath := s.filePath(trackID)
	if err := os.Remove(filePath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to delete lap data file: %w", err)
	}
	return nil
}
