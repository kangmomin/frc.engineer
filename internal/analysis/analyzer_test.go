package analysis

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestListSessionsMarksComparisonAvailability(t *testing.T) {
	base := t.TempDir()

	readyDir := filepath.Join(base, "123_20260412_010101")
	if err := os.MkdirAll(readyDir, 0o755); err != nil {
		t.Fatalf("mkdir readyDir: %v", err)
	}
	for _, name := range []string{"lap_data.jsonl", "telemetry.jsonl", "motion.jsonl", "session.jsonl"} {
		if err := os.WriteFile(filepath.Join(readyDir, name), []byte("{}\n"), 0o644); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
	}

	incompleteDir := filepath.Join(base, "124_20260412_010102")
	if err := os.MkdirAll(incompleteDir, 0o755); err != nil {
		t.Fatalf("mkdir incompleteDir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(incompleteDir, "lap_data.jsonl"), []byte("{}\n"), 0o644); err != nil {
		t.Fatalf("write incomplete lap_data: %v", err)
	}

	sessions, err := ListSessions(base)
	if err != nil {
		t.Fatalf("ListSessions: %v", err)
	}
	if len(sessions) != 2 {
		t.Fatalf("len(sessions) = %d, want 2", len(sessions))
	}

	byDir := make(map[string]SessionInfo, len(sessions))
	for _, session := range sessions {
		byDir[session.Directory] = session
	}

	if !byDir["123_20260412_010101"].AnalysisAvailable {
		t.Fatalf("ready session should be analysisAvailable")
	}
	if byDir["124_20260412_010102"].AnalysisAvailable {
		t.Fatalf("incomplete session should not be analysisAvailable")
	}
}

func TestAnalyzeBuildsComparisonFromPacketLogs(t *testing.T) {
	dir := t.TempDir()

	writeJSONLFile(t, dir, "session.jsonl",
		map[string]any{
			"ts":          "2026-04-12T00:00:00Z",
			"frame":       1,
			"sessionTime": 10.0,
			"packetID":    1,
			"data": map[string]any{
				"TrackID":          7,
				"Weather":          0,
				"TrackTemperature": 34,
				"AirTemperature":   22,
				"TotalLaps":        18,
				"TrackLength":      5200,
				"SessionType":      15,
			},
		},
	)

	writeJSONLFile(t, dir, "lap_data.jsonl",
		map[string]any{
			"ts":          "2026-04-12T00:00:00Z",
			"frame":       1,
			"sessionTime": 10.0,
			"packetID":    2,
			"data": map[string]any{
				"Header": map[string]any{"PlayerCarIndex": 0},
				"LapData": []any{
					map[string]any{
						"LastLapTimeInMS":   0,
						"Sector1TimeInMS":   0,
						"Sector2TimeInMS":   0,
						"LapDistance":       120.0,
						"CurrentLapNum":     1,
						"CurrentLapInvalid": 0,
					},
				},
			},
		},
		map[string]any{
			"ts":          "2026-04-12T00:00:00Z",
			"frame":       2,
			"sessionTime": 20.0,
			"packetID":    2,
			"data": map[string]any{
				"Header": map[string]any{"PlayerCarIndex": 0},
				"LapData": []any{
					map[string]any{
						"LastLapTimeInMS":   0,
						"Sector1TimeInMS":   0,
						"Sector2TimeInMS":   0,
						"LapDistance":       420.0,
						"CurrentLapNum":     1,
						"CurrentLapInvalid": 0,
					},
				},
			},
		},
		map[string]any{
			"ts":          "2026-04-12T00:00:00Z",
			"frame":       3,
			"sessionTime": 90.0,
			"packetID":    2,
			"data": map[string]any{
				"Header": map[string]any{"PlayerCarIndex": 0},
				"LapData": []any{
					map[string]any{
						"LastLapTimeInMS":   90000,
						"Sector1TimeInMS":   30000,
						"Sector2TimeInMS":   30000,
						"LapDistance":       0.0,
						"CurrentLapNum":     2,
						"CurrentLapInvalid": 0,
					},
				},
			},
		},
	)

	writeJSONLFile(t, dir, "telemetry.jsonl",
		map[string]any{
			"ts":          "2026-04-12T00:00:00Z",
			"frame":       1,
			"sessionTime": 10.0,
			"packetID":    6,
			"data": map[string]any{
				"Header": map[string]any{"PlayerCarIndex": 0},
				"CarTelemetryData": []any{
					map[string]any{"Speed": 220, "Throttle": 0.92, "Steer": 0.24, "Brake": 0.00},
				},
			},
		},
		map[string]any{
			"ts":          "2026-04-12T00:00:00Z",
			"frame":       2,
			"sessionTime": 20.0,
			"packetID":    6,
			"data": map[string]any{
				"Header": map[string]any{"PlayerCarIndex": 0},
				"CarTelemetryData": []any{
					map[string]any{"Speed": 180, "Throttle": 0.48, "Steer": 0.30, "Brake": 0.35},
				},
			},
		},
	)

	writeJSONLFile(t, dir, "motion.jsonl",
		map[string]any{
			"ts":          "2026-04-12T00:00:00Z",
			"frame":       1,
			"sessionTime": 10.0,
			"packetID":    0,
			"data": map[string]any{
				"Header": map[string]any{"PlayerCarIndex": 0},
				"CarMotionData": []any{
					map[string]any{"WorldVelocityX": 0.0, "WorldVelocityZ": 120.0, "Yaw": 0.0},
				},
			},
		},
		map[string]any{
			"ts":          "2026-04-12T00:00:00Z",
			"frame":       2,
			"sessionTime": 20.0,
			"packetID":    0,
			"data": map[string]any{
				"Header": map[string]any{"PlayerCarIndex": 0},
				"CarMotionData": []any{
					map[string]any{"WorldVelocityX": 22.0, "WorldVelocityZ": 110.0, "Yaw": 0.0},
				},
			},
		},
	)

	writeJSONLFile(t, dir, "car_status.jsonl",
		map[string]any{
			"ts":          "2026-04-12T00:00:00Z",
			"frame":       1,
			"sessionTime": 10.0,
			"packetID":    7,
			"data": map[string]any{
				"Header": map[string]any{"PlayerCarIndex": 0},
				"CarStatusData": []any{
					map[string]any{"VisualTyreCompound": 16, "TyresAgeLaps": 1},
				},
			},
		},
	)

	result, err := Analyze(dir)
	if err != nil {
		t.Fatalf("Analyze: %v", err)
	}
	if result.Session == nil || result.Session.SessionType != "Race" {
		t.Fatalf("result.Session = %#v, want Race metadata", result.Session)
	}
	if result.Comparison == nil {
		t.Fatalf("result.Comparison = nil")
	}
	if len(result.Comparison.Laps) != 1 {
		t.Fatalf("len(result.Comparison.Laps) = %d, want 1", len(result.Comparison.Laps))
	}
	if result.Comparison.BestLapNum != 1 {
		t.Fatalf("BestLapNum = %d, want 1", result.Comparison.BestLapNum)
	}

	lap := result.Comparison.Laps[0]
	if lap.Trace.Speed[2] == nil {
		t.Fatalf("expected non-nil speed trace point")
	}
	if lap.UndersteerPct <= 0 || lap.OversteerPct <= 0 {
		t.Fatalf("unexpected dynamics summary: under=%.2f over=%.2f", lap.UndersteerPct, lap.OversteerPct)
	}
}

func writeJSONLFile(t *testing.T, dir, name string, entries ...map[string]any) {
	t.Helper()

	path := filepath.Join(dir, name)
	f, err := os.Create(path)
	if err != nil {
		t.Fatalf("create %s: %v", name, err)
	}
	defer f.Close()

	encoder := json.NewEncoder(f)
	for _, entry := range entries {
		if err := encoder.Encode(entry); err != nil {
			t.Fatalf("encode %s: %v", name, err)
		}
	}
}
