package tracks

import (
	"encoding/csv"
	"fmt"
	"io"
	"log/slog"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

// TrackPoint represents a single point on the racing line
type TrackPoint struct {
	X      float32 `json:"x"`
	Z      float32 `json:"z"`
	Sector int     `json:"sector"`
	DRS    int     `json:"drs"`
}

// TrackMapData holds parsed track data with bounding box
type TrackMapData struct {
	Points []TrackPoint `json:"points"`
	MinX   float64      `json:"minX"`
	MaxX   float64      `json:"maxX"`
	MinZ   float64      `json:"minZ"`
	MaxZ   float64      `json:"maxZ"`
}

// TrackStore maps trackID to parsed track data
type TrackStore struct {
	tracks  map[int8]*TrackMapData
	dataDir string
}

// NewTrackStore loads all CSV racing line files from dataDir
func NewTrackStore(dataDir string) *TrackStore {
	ts := &TrackStore{tracks: make(map[int8]*TrackMapData), dataDir: dataDir}

	for _, desc := range trackDescriptors {
		id := desc.id
		patterns := make([]string, 0, 8)
		for _, key := range trackFileKeys(id) {
			patterns = append(patterns,
				filepath.Join(dataDir, key+"_2020_racingline.txt"),
				filepath.Join(dataDir, key+"_racingline.txt"),
				filepath.Join(dataDir, key+recordedFileSuffix),
				filepath.Join(dataDir, key+legacyRecordedFileSuffix),
			)
		}

		var loaded bool
		for _, path := range patterns {
			data, err := loadCSV(path)
			if err != nil {
				continue
			}
			ts.tracks[id] = data
			slog.Info("loaded track", "id", id, "name", desc.displayName, "points", len(data.Points))
			loaded = true
			break
		}
		if !loaded {
			slog.Warn("track file not found", "id", id, "name", desc.displayName)
		}
	}

	slog.Info("track store initialized", "loaded", len(ts.tracks))
	return ts
}

// Get returns track data for a given trackID, or nil if not found
func (ts *TrackStore) Get(trackID int8) *TrackMapData {
	return ts.tracks[trackID]
}

// LoadSingle loads (or replaces) a single track from a CSV file
func (ts *TrackStore) LoadSingle(trackID int8, path string) {
	data, err := loadCSV(path)
	if err != nil {
		slog.Warn("failed to load recorded track", "trackID", trackID, "path", path, "error", err)
		return
	}
	ts.tracks[trackID] = data
	slog.Info("loaded recorded track", "trackID", trackID, "points", len(data.Points))
}

// ListLoaded returns info about all loaded tracks
func (ts *TrackStore) ListLoaded() []TrackInfo {
	var result []TrackInfo
	for _, desc := range trackDescriptors {
		info := TrackInfo{ID: int(desc.id), Name: desc.displayName, HasData: ts.tracks[desc.id] != nil}
		result = append(result, info)
	}
	return result
}

// TrackInfo describes a known track and whether data is loaded
type TrackInfo struct {
	ID      int    `json:"id"`
	Name    string `json:"name"`
	HasData bool   `json:"hasData"`
}

// RecordedFileInfo describes a saved track file on disk
type RecordedFileInfo struct {
	Name     string `json:"name"`
	Filename string `json:"filename"`
}

// RecordedTrackPreview describes a saved track file plus its parsed map data.
type RecordedTrackPreview struct {
	Name     string        `json:"name"`
	Filename string        `json:"filename"`
	TrackMap *TrackMapData `json:"trackMap"`
}

const (
	recordedFileSuffix       = "_recorded.txt"
	legacyRecordedFileSuffix = "_record.txt"
)

// NormalizeRecordedTrackName removes legacy recording suffixes from a track base name.
// Examples:
// - "losail_recorded" -> "losail"
// - "losail_record"   -> "losail"
// - "losail"          -> "losail"
func NormalizeRecordedTrackName(name string) string {
	normalized := normalizeTrackKey(name)
	for {
		changed := false
		if strings.HasSuffix(normalized, "_recorded") {
			normalized = strings.TrimSuffix(normalized, "_recorded")
			changed = true
		}
		if strings.HasSuffix(normalized, "_record") {
			normalized = strings.TrimSuffix(normalized, "_record")
			changed = true
		}
		normalized = strings.Trim(normalized, "_")
		if !changed {
			break
		}
	}
	if normalized == "record" || normalized == "recorded" {
		return "unknown"
	}
	if normalized == "" {
		return "unknown"
	}
	return normalized
}

func recordedFileCandidates(name string) []string {
	var candidates []string
	for _, key := range recordedFileKeysForName(name) {
		candidates = append(candidates,
			key+recordedFileSuffix,
			key+legacyRecordedFileSuffix,
		)
	}
	return candidates
}

// FindRecordedFile returns the first matching recorded file for a track name.
func (ts *TrackStore) FindRecordedFile(trackName string) (RecordedFileInfo, string, bool) {
	for _, candidate := range recordedFileCandidates(trackName) {
		path := filepath.Join(ts.dataDir, candidate)
		info, err := os.Stat(path)
		if err != nil || info.IsDir() {
			continue
		}
		return RecordedFileInfo{
			Name:     TrackDisplayName(trackName),
			Filename: candidate,
		}, path, true
	}
	return RecordedFileInfo{}, "", false
}

// LoadRecordedPreview returns parsed track data for a recorded file matching trackName.
func (ts *TrackStore) LoadRecordedPreview(trackName string) (*RecordedTrackPreview, error) {
	info, path, ok := ts.FindRecordedFile(trackName)
	if !ok {
		return nil, os.ErrNotExist
	}
	data, err := loadCSV(path)
	if err != nil {
		return nil, err
	}
	return &RecordedTrackPreview{
		Name:     info.Name,
		Filename: info.Filename,
		TrackMap: data,
	}, nil
}

// ListRecordedFiles scans the data directory for recorded track files.
// Supports both current (*_recorded.txt) and legacy (*_record.txt) naming.
func (ts *TrackStore) ListRecordedFiles() []RecordedFileInfo {
	var result []RecordedFileInfo

	patterns := []string{
		filepath.Join(ts.dataDir, "*"+recordedFileSuffix),
		filepath.Join(ts.dataDir, "*"+legacyRecordedFileSuffix),
	}

	seen := make(map[string]struct{})
	for _, pattern := range patterns {
		matches, err := filepath.Glob(pattern)
		if err != nil {
			continue
		}
		for _, path := range matches {
			base := filepath.Base(path)
			if _, ok := seen[base]; ok {
				continue
			}
			seen[base] = struct{}{}

			name := base
			switch {
			case strings.HasSuffix(base, recordedFileSuffix):
				name = strings.TrimSuffix(base, recordedFileSuffix)
			case strings.HasSuffix(base, legacyRecordedFileSuffix):
				name = strings.TrimSuffix(base, legacyRecordedFileSuffix)
			default:
				name = strings.TrimSuffix(base, filepath.Ext(base))
			}
			name = TrackDisplayName(name)

			result = append(result, RecordedFileInfo{
				Name:     name,
				Filename: base,
			})
		}
	}

	sort.Slice(result, func(i, j int) bool {
		if result[i].Name == result[j].Name {
			return result[i].Filename < result[j].Filename
		}
		return result[i].Name < result[j].Name
	})

	return result
}

func normalizeTrackKey(name string) string {
	trimmed := strings.ToLower(strings.TrimSpace(name))
	if trimmed == "" {
		return ""
	}

	var b strings.Builder
	lastUnderscore := false
	for _, r := range trimmed {
		isAlphaNum := (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9')
		if isAlphaNum {
			b.WriteRune(r)
			lastUnderscore = false
			continue
		}
		if !lastUnderscore {
			b.WriteByte('_')
			lastUnderscore = true
		}
	}

	return strings.Trim(b.String(), "_")
}

// loadCSV parses a racing line CSV file
// Format: line 1 = metadata, line 2 = header (dist,pos_z,pos_x,pos_y,drs,sector), line 3+ = data
func loadCSV(path string) (*TrackMapData, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	reader := csv.NewReader(f)
	reader.FieldsPerRecord = -1 // allow variable field counts
	// Skip metadata line
	if _, err := reader.Read(); err != nil {
		return nil, fmt.Errorf("skip metadata: %w", err)
	}
	// Skip header line
	if _, err := reader.Read(); err != nil {
		return nil, fmt.Errorf("skip header: %w", err)
	}

	minX, minZ := math.MaxFloat64, math.MaxFloat64
	maxX, maxZ := -math.MaxFloat64, -math.MaxFloat64

	var points []TrackPoint
	for {
		record, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("read row: %w", err)
		}
		if len(record) < 6 {
			continue
		}

		// CSV columns: dist, pos_z, pos_x, pos_y, drs, sector
		posZ, err1 := strconv.ParseFloat(strings.TrimSpace(record[1]), 32)
		posX, err2 := strconv.ParseFloat(strings.TrimSpace(record[2]), 32)
		drs, err3 := strconv.Atoi(strings.TrimSpace(record[4]))
		sector, err4 := strconv.Atoi(strings.TrimSpace(record[5]))
		if err1 != nil || err2 != nil || err3 != nil || err4 != nil {
			continue
		}

		points = append(points, TrackPoint{
			X:      float32(posX),
			Z:      float32(posZ),
			Sector: sector,
			DRS:    drs,
		})

		if posX < minX {
			minX = posX
		}
		if posX > maxX {
			maxX = posX
		}
		if posZ < minZ {
			minZ = posZ
		}
		if posZ > maxZ {
			maxZ = posZ
		}
	}

	if len(points) == 0 {
		return nil, fmt.Errorf("no valid points in %s", path)
	}

	return &TrackMapData{
		Points: points,
		MinX:   minX,
		MaxX:   maxX,
		MinZ:   minZ,
		MaxZ:   maxZ,
	}, nil
}
