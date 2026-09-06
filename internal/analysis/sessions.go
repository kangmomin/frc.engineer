package analysis

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"frc.engineer/internal/tracks"
)

// SessionMetadata describes the recorded session conditions used by the comparison UI.
type SessionMetadata struct {
	TrackID      int8   `json:"trackId"`
	TrackName    string `json:"trackName"`
	SessionType  string `json:"sessionType"`
	Weather      string `json:"weather"`
	TrackTemp    *int   `json:"trackTemp,omitempty"`
	AirTemp      *int   `json:"airTemp,omitempty"`
	TotalLaps    int    `json:"totalLaps,omitempty"`
	TrackLengthM int    `json:"trackLengthM,omitempty"`
}

// SessionInfo is returned by /api/sessions for picker UI state.
type SessionInfo struct {
	UID               string `json:"uid"`
	Timestamp         string `json:"timestamp"`
	Directory         string `json:"directory"`
	HasLapData        bool   `json:"hasLapData"`
	HasTelemetry      bool   `json:"hasTelemetry"`
	HasMotion         bool   `json:"hasMotion"`
	HasCarStatus      bool   `json:"hasCarStatus"`
	HasSession        bool   `json:"hasSession"`
	AnalysisAvailable bool   `json:"analysisAvailable"`
	TrackName         string `json:"trackName,omitempty"`
	SessionType       string `json:"sessionType,omitempty"`
	Weather           string `json:"weather,omitempty"`
	TrackTemp         *int   `json:"trackTemp,omitempty"`
}

type sessionFiles struct {
	hasLapData   bool
	hasTelemetry bool
	hasMotion    bool
	hasCarStatus bool
	hasSession   bool
}

func (f sessionFiles) comparisonReady() bool {
	return f.hasLapData && f.hasTelemetry && f.hasMotion && f.hasSession
}

// ListSessions returns directory names under packetsDir plus comparison readiness.
func ListSessions(packetsDir string) ([]SessionInfo, error) {
	entries, err := os.ReadDir(packetsDir)
	if err != nil {
		return nil, err
	}

	var sessions []SessionInfo
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}

		name := e.Name()
		parts := strings.SplitN(name, "_", 3)
		uid := ""
		ts := ""
		if len(parts) >= 1 {
			uid = parts[0]
		}
		if len(parts) >= 3 {
			ts = parts[1] + "_" + parts[2]
		} else if len(parts) == 2 {
			ts = parts[1]
		}

		dir := filepath.Join(packetsDir, name)
		files := inspectSessionFiles(dir)
		if !files.hasLapData {
			continue
		}

		info := SessionInfo{
			UID:               uid,
			Timestamp:         ts,
			Directory:         name,
			HasLapData:        files.hasLapData,
			HasTelemetry:      files.hasTelemetry,
			HasMotion:         files.hasMotion,
			HasCarStatus:      files.hasCarStatus,
			HasSession:        files.hasSession,
			AnalysisAvailable: files.comparisonReady(),
		}

		if meta, err := readSessionMetadata(dir); err == nil && meta != nil {
			info.TrackName = meta.TrackName
			info.SessionType = meta.SessionType
			info.Weather = meta.Weather
			info.TrackTemp = meta.TrackTemp
		}

		sessions = append(sessions, info)
	}

	sort.Slice(sessions, func(i, j int) bool {
		left, _ := time.Parse("20060102_150405", sessions[i].Timestamp)
		right, _ := time.Parse("20060102_150405", sessions[j].Timestamp)
		if !left.Equal(right) {
			return left.After(right)
		}
		return sessions[i].Directory > sessions[j].Directory
	})

	return sessions, nil
}

func inspectSessionFiles(dir string) sessionFiles {
	return sessionFiles{
		hasLapData:   fileExists(filepath.Join(dir, "lap_data.jsonl")),
		hasTelemetry: fileExists(filepath.Join(dir, "telemetry.jsonl")),
		hasMotion:    fileExists(filepath.Join(dir, "motion.jsonl")),
		hasCarStatus: fileExists(filepath.Join(dir, "car_status.jsonl")),
		hasSession:   fileExists(filepath.Join(dir, "session.jsonl")),
	}
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func readSessionMetadata(dir string) (*SessionMetadata, error) {
	f, err := os.Open(filepath.Join(dir, "session.jsonl"))
	if err != nil {
		return nil, err
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 1024*1024), 1024*1024)
	if !scanner.Scan() {
		return nil, scanner.Err()
	}

	var env packetEnvelope
	if err := json.Unmarshal(scanner.Bytes(), &env); err != nil {
		return nil, err
	}

	var pkt sessionPacket
	if err := json.Unmarshal(env.Data, &pkt); err != nil {
		return nil, err
	}

	trackTemp := int(pkt.TrackTemperature)
	airTemp := int(pkt.AirTemperature)
	return &SessionMetadata{
		TrackID:      pkt.TrackID,
		TrackName:    tracks.TrackName(pkt.TrackID),
		SessionType:  sessionTypeLabel(pkt.SessionType),
		Weather:      weatherLabel(pkt.Weather),
		TrackTemp:    &trackTemp,
		AirTemp:      &airTemp,
		TotalLaps:    int(pkt.TotalLaps),
		TrackLengthM: int(pkt.TrackLength),
	}, nil
}

type sessionPacket struct {
	TrackID          int8   `json:"TrackID"`
	Weather          uint8  `json:"Weather"`
	TrackTemperature int8   `json:"TrackTemperature"`
	AirTemperature   int8   `json:"AirTemperature"`
	TotalLaps        uint8  `json:"TotalLaps"`
	TrackLength      uint16 `json:"TrackLength"`
	SessionType      uint8  `json:"SessionType"`
}

func sessionTypeLabel(value uint8) string {
	switch value {
	case 1:
		return "P1"
	case 2:
		return "P2"
	case 3:
		return "P3"
	case 4:
		return "Short P"
	case 5:
		return "Q1"
	case 6:
		return "Q2"
	case 7:
		return "Q3"
	case 8:
		return "Short Q"
	case 9:
		return "OSQ"
	case 10:
		return "SS1"
	case 11:
		return "SS2"
	case 12:
		return "SS3"
	case 13:
		return "Short SS"
	case 14:
		return "OSS"
	case 15:
		return "Race"
	case 16:
		return "Race 2"
	case 17:
		return "Race 3"
	case 18:
		return "Time Trial"
	default:
		return "Unknown"
	}
}

func weatherLabel(value uint8) string {
	switch value {
	case 0:
		return "clear"
	case 1:
		return "light_cloud"
	case 2:
		return "overcast"
	case 3:
		return "light_rain"
	case 4:
		return "heavy_rain"
	case 5:
		return "storm"
	default:
		return "unknown"
	}
}
