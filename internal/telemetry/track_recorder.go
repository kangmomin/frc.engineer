package telemetry

import (
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"sync"

	"frc.engineer/internal/tracks"
)

var safeNameRe = regexp.MustCompile(`[^a-zA-Z0-9_-]`)

// TrackRecorder collects one lap of position data from the player car
// and saves it as a CSV file compatible with the TrackStore format.
type TrackRecorder struct {
	mu        sync.Mutex
	enabled   bool
	recording bool
	dataDir   string
	store     *tracks.TrackStore
	logger    *slog.Logger

	// Current recording state
	trackID    int8
	trackName  string
	lastLapNum uint8
	buffer     []recordPoint
}

type recordPoint struct {
	Dist   float32
	X      float32 // pos_x (WorldPositionX)
	Z      float32 // pos_z (WorldPositionZ)
	Y      float32 // pos_y (WorldPositionY)
	DRS    int
	Sector int
}

// NewTrackRecorder creates a new track recorder
func NewTrackRecorder(dataDir string, store *tracks.TrackStore, logger *slog.Logger) *TrackRecorder {
	return &TrackRecorder{
		dataDir: dataDir,
		store:   store,
		logger:  logger,
	}
}

// SetEnabled turns recording on or off
func (r *TrackRecorder) SetEnabled(enabled bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.enabled = enabled
	r.logger.Info("track recorder", "enabled", enabled)
	if !enabled {
		r.recording = false
		r.buffer = nil
	}
}

// IsEnabled returns whether recording is enabled
func (r *TrackRecorder) IsEnabled() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.enabled
}

// IsRecording returns whether actively recording a lap
func (r *TrackRecorder) IsRecording() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.recording
}

// RecordPoint is called per motion packet with player car data.
// It collects positions for one full lap then saves to CSV.
func (r *TrackRecorder) RecordPoint(
	trackID int8, trackName string,
	lapDistance float32, currentLapNum uint8,
	worldX, worldY, worldZ float32,
	drs int, sector int,
) {
	r.mu.Lock()

	if !r.enabled {
		r.mu.Unlock()
		return
	}

	// Start recording when lap distance becomes positive (car is on track)
	if !r.recording {
		if lapDistance > 1.0 {
			r.recording = true
			r.trackID = trackID
			r.trackName = trackName
			r.lastLapNum = currentLapNum
			r.buffer = nil
			r.logger.Info("track recording started", "trackID", trackID, "trackName", trackName, "lapNum", currentLapNum, "lapDist", lapDistance)
		} else {
			r.mu.Unlock()
			return
		}
	}

	// Log buffer size periodically for debugging
	if len(r.buffer)%500 == 0 && len(r.buffer) > 0 {
		r.logger.Info("track recording progress", "points", len(r.buffer), "lapNum", currentLapNum, "lastLapNum", r.lastLapNum, "lapDist", lapDistance)
	}

	// Lap changed → one lap complete: capture and save outside lock
	if currentLapNum != r.lastLapNum {
		r.logger.Info("track recording lap change detected", "from", r.lastLapNum, "to", currentLapNum, "bufferSize", len(r.buffer))
	}
	if currentLapNum != r.lastLapNum && len(r.buffer) > 100 {
		buf := make([]recordPoint, len(r.buffer))
		copy(buf, r.buffer)
		tid := r.trackID
		tname := r.trackName
		r.recording = false
		r.buffer = nil
		r.mu.Unlock()
		r.saveLap(tid, tname, buf)
		return
	}

	r.buffer = append(r.buffer, recordPoint{
		Dist:   lapDistance,
		X:      worldX,
		Z:      worldZ,
		Y:      worldY,
		DRS:    drs,
		Sector: sector,
	})
	r.mu.Unlock()
}

func (r *TrackRecorder) saveLap(trackID int8, trackName string, buffer []recordPoint) {
	dir := r.dataDir
	if err := os.MkdirAll(dir, 0755); err != nil {
		r.logger.Error("failed to create tracks dir", "error", err)
		return
	}

	// Sanitize track name to prevent path traversal
	safeName := safeNameRe.ReplaceAllString(trackName, "_")
	safeName = tracks.NormalizeRecordedTrackName(safeName)
	if safeName == "" {
		safeName = fmt.Sprintf("track_%d", trackID)
	}

	filename := fmt.Sprintf("%s_recorded.txt", safeName)
	path := filepath.Join(dir, filename)

	f, err := os.Create(path)
	if err != nil {
		r.logger.Error("failed to create track file", "error", err, "path", path)
		return
	}
	defer f.Close()

	fmt.Fprintf(f, "%s recorded track\n", safeName)
	fmt.Fprintln(f, "dist,pos_z,pos_x,pos_y,drs,sector")
	for _, p := range buffer {
		fmt.Fprintf(f, "%.2f,%.4f,%.4f,%.4f,%d,%d\n", p.Dist, p.Z, p.X, p.Y, p.DRS, p.Sector)
	}

	r.logger.Info("track recorded", "trackID", trackID, "name", safeName, "points", len(buffer), "path", path)

	// Register with TrackStore for immediate use
	r.store.LoadSingle(trackID, path)
}
