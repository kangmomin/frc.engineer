package tracks

import (
	"encoding/csv"
	"fmt"
	"io"
	"log/slog"
	"math"
	"os"
	"path/filepath"
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
	tracks map[int8]*TrackMapData
}

// trackID → file name prefix mapping (F1 25 track IDs)
// F1 25 track IDs
var trackFileMap = map[int8]string{
	0:  "melbourne",
	2:  "shanghai",
	3:  "sakhir",
	4:  "catalunya",
	5:  "monaco",
	6:  "montreal",
	7:  "silverstone",
	8:  "hungaroring",
	9:  "spa",
	10: "monza",
	11: "singapore",
	12: "suzuka",
	13: "abu_dhabi",
	14: "texas",
	16: "brazil",
	17: "austria",
	19: "mexico",
	20: "baku",
	23: "zandvoort",
	24: "imola",
	25: "jeddah",
	26: "miami",
	27: "losail",
	28: "las_vegas",
}

// TrackName returns the name for a given trackID, or "unknown"
func TrackName(trackID int8) string {
	if name, ok := trackFileMap[trackID]; ok {
		return name
	}
	return "unknown"
}

// NewTrackStore loads all CSV racing line files from dataDir
func NewTrackStore(dataDir string) *TrackStore {
	ts := &TrackStore{tracks: make(map[int8]*TrackMapData)}

	for id, name := range trackFileMap {
		// Try both naming patterns
		patterns := []string{
			filepath.Join(dataDir, name+"_2020_racingline.txt"),
			filepath.Join(dataDir, name+"_racingline.txt"),
		}

		var loaded bool
		for _, path := range patterns {
			data, err := loadCSV(path)
			if err != nil {
				continue
			}
			ts.tracks[id] = data
			slog.Info("loaded track", "id", id, "name", name, "points", len(data.Points))
			loaded = true
			break
		}
		if !loaded {
			slog.Warn("track file not found", "id", id, "name", name)
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
	for id, name := range trackFileMap {
		info := TrackInfo{ID: int(id), Name: name, HasData: ts.tracks[id] != nil}
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
