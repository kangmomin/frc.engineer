package telemetry

import (
	"bufio"
	"fmt"
	"log/slog"
	"math"
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
	sessionUID  uint64
	trackLength uint16
	trackID     int8
	lastLapNum  uint8
	buffer      []recordPoint
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
	sessionUID uint64, trackID int8, trackName string, trackLength uint16,
	lapDistance float32, currentLapNum uint8,
	worldX, worldY, worldZ float32,
	drs int, sector int,
) {
	r.mu.Lock()

	if !r.enabled {
		r.mu.Unlock()
		return
	}

	// The processor calls this synchronously in packet order. A new identity
	// or track always discards the previous partial lap before testing a wrap.
	invalid := sessionUID == 0 || trackID < 0 || trackLength == 0 || currentLapNum == 0 ||
		lapDistance < 0 || lapDistance > float32(trackLength)+saveLapEndThresholdM
	for _, value := range [...]float32{lapDistance, worldX, worldY, worldZ} {
		invalid = invalid || math.IsNaN(float64(value)) || math.IsInf(float64(value), 0)
	}
	if invalid || r.sessionUID != sessionUID || r.trackID != trackID || r.trackLength != trackLength {
		r.recording, r.buffer = false, nil
	}
	if invalid {
		r.mu.Unlock()
		return
	}
	if r.recording && currentLapNum != r.lastLapNum {
		complete := int(currentLapNum) == int(r.lastLapNum)+1 &&
			lapDistance < saveLapStartThresholdM && len(r.buffer) > 100 &&
			r.buffer[len(r.buffer)-1].Dist >= float32(trackLength)-saveLapEndThresholdM
		buffer := r.buffer
		r.recording, r.buffer = false, nil
		if complete {
			r.mu.Unlock()
			r.saveLap(trackID, trackName, trackLength, buffer)
			return
		}
	}
	if r.recording && len(r.buffer) > 0 && lapDistance < r.buffer[len(r.buffer)-1].Dist {
		r.recording, r.buffer = false, nil
	}
	if !r.recording {
		// Late attach and pit exits wait for the next observed start line.
		if lapDistance <= 1 || lapDistance >= saveLapStartThresholdM {
			r.mu.Unlock()
			return
		}
		r.recording = true
		r.sessionUID, r.trackID, r.trackLength = sessionUID, trackID, trackLength
		r.lastLapNum = currentLapNum
		r.logger.Info("track recording started", "trackID", trackID, "trackName", trackName, "lapNum", currentLapNum)
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

// saveLapStartThresholdM: 랩 시작점 근처에서 수집이 시작됐는지 판단하는 상한 (m).
// 부분 랩(피트 아웃/중간 시작)이 트랙맵으로 저장되는 것을 막는다.
const saveLapStartThresholdM = 50.0
const saveLapEndThresholdM = 50.0

func (r *TrackRecorder) saveLap(trackID int8, trackName string, trackLength uint16, buffer []recordPoint) {
	// 부분/혼합 랩 방어: 시작점이 랩 초반이어야 하고 Dist가 단조 비감소여야 한다
	// (플래시백/랩 혼합 시 Dist가 역행한다).
	if len(buffer) == 0 || trackLength == 0 || buffer[0].Dist >= saveLapStartThresholdM ||
		buffer[len(buffer)-1].Dist < float32(trackLength)-saveLapEndThresholdM {
		firstDist := float32(0)
		if len(buffer) > 0 {
			firstDist = buffer[0].Dist
		}
		r.logger.Warn("skipping partial lap save", "trackID", trackID, "firstDist", firstDist, "points", len(buffer))
		return
	}
	for i := 1; i < len(buffer); i++ {
		if buffer[i].Dist < buffer[i-1].Dist {
			r.logger.Warn("skipping non-monotonic lap save", "trackID", trackID, "index", i, "dist", buffer[i].Dist, "prevDist", buffer[i-1].Dist)
			return
		}
	}

	// 브로드캐스트 페이로드(256KB)와 동일 상한으로 저장 파일도 bound
	if stride := downsampleStride(len(buffer), maxTrackMapPoints); stride > 1 {
		ds := make([]recordPoint, 0, (len(buffer)+stride-1)/stride)
		for i := 0; i < len(buffer); i += stride {
			ds = append(ds, buffer[i])
		}
		buffer = ds
	}

	dir := r.dataDir
	if err := os.MkdirAll(dir, 0755); err != nil {
		r.logger.Error("failed to create tracks dir", "error", err)
		return
	}

	safeName := tracks.TrackStorageKey(trackID)
	if safeName == "unknown" {
		// Fall back to the current session label when a track ID mapping is unavailable.
		safeName = safeNameRe.ReplaceAllString(trackName, "_")
		safeName = tracks.NormalizeRecordedTrackName(safeName)
	}
	if safeName == "" || safeName == "unknown" {
		safeName = fmt.Sprintf("track_%d", trackID)
	}

	filename := fmt.Sprintf("%s_recorded.txt", safeName)
	path := filepath.Join(dir, filename)

	// 크래시/에러 시 부분 파일이 남지 않도록 tmp에 쓰고 rename으로 교체
	tmpPath := path + ".tmp"
	f, err := os.Create(tmpPath)
	if err != nil {
		r.logger.Error("failed to create track file", "error", err, "path", tmpPath)
		return
	}

	defer os.Remove(tmpPath)
	defer f.Close()
	writer := bufio.NewWriter(f)
	fmt.Fprintf(writer, "%s recorded track\n", safeName)
	fmt.Fprintln(writer, "dist,pos_z,pos_x,pos_y,drs,sector")
	for _, p := range buffer {
		fmt.Fprintf(writer, "%.2f,%.4f,%.4f,%.4f,%d,%d\n", p.Dist, p.Z, p.X, p.Y, p.DRS, p.Sector)
	}

	if err := writer.Flush(); err != nil {
		r.logger.Error("failed to write track file", "error", err, "path", tmpPath)
		return
	}
	if err := f.Close(); err != nil {
		r.logger.Error("failed to close track file", "error", err, "path", tmpPath)
		return
	}
	if err := os.Rename(tmpPath, path); err != nil {
		r.logger.Error("failed to finalize track file", "error", err, "path", path)
		return
	}

	r.logger.Info("track recorded", "trackID", trackID, "name", safeName, "points", len(buffer), "path", path)

	// Register with TrackStore for immediate use
	r.store.LoadSingle(trackID, path)
}
