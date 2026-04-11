package main

import (
	"io"
	"log/slog"
	"os"
	"strings"
	"testing"
	"time"

	"frc.engineer/internal/dto"
)

func TestERSCompareMonitorAggregatesAndLogsSamples(t *testing.T) {
	monitor := newERSCompareMonitor(t.TempDir(), slog.New(slog.NewTextHandler(io.Discard, nil)))
	capturedAt := time.Unix(0, 0).Add(1500 * time.Millisecond)

	monitor.Observe(101, capturedAt, &dto.PitwallState{
		PlayerIndex:          0,
		ERSComparisonEnabled: true,
		Session: &dto.SessionInfo{
			SessionType: "Race",
			TrackID:     5,
			TrackName:   "Bahrain International Circuit",
			TrackLength: 5412,
		},
		Drivers: []dto.DriverInfo{
			{
				Index:               0,
				Name:                "PLAYER",
				TeamID:              1,
				Position:            1,
				CurrentLapNum:       12,
				CurrentSector:       2,
				LapDistance:         1500.5,
				Speed:               301,
				Throttle:            1.0,
				Brake:               0,
				ERSDeployMode:       3,
				ERSEstimatePct:      52,
				ERSEstimateReady:    true,
				ERSActualPct:        32,
				ERSActualReady:      true,
				ERSStoreEnergy:      1_280_000,
				ERSDeployedThisLap:  150_000,
				ERSHarvestedThisLap: 60_000,
			},
			{
				Index:               1,
				Name:                "NOR",
				TeamID:              3,
				Position:            2,
				CurrentLapNum:       12,
				CurrentSector:       2,
				LapDistance:         1490.2,
				Speed:               298,
				Throttle:            0.92,
				Brake:               0.05,
				ERSDeployMode:       2,
				ERSEstimatePct:      44,
				ERSEstimateReady:    true,
				ERSActualPct:        46,
				ERSActualReady:      true,
				ERSStoreEnergy:      1_840_000,
				ERSDeployedThisLap:  110_000,
				ERSHarvestedThisLap: 75_000,
			},
		},
	})

	snapshot := monitor.Snapshot()
	if !snapshot.CurrentErrorReady {
		t.Fatal("current error should be ready")
	}
	if snapshot.CurrentErrorPP != 20 {
		t.Fatalf("current error = %d, want 20", snapshot.CurrentErrorPP)
	}
	if snapshot.SampleCount != 2 {
		t.Fatalf("sample count = %d, want 2", snapshot.SampleCount)
	}
	if snapshot.ComparableDrivers != 2 {
		t.Fatalf("comparable drivers = %d, want 2", snapshot.ComparableDrivers)
	}
	if snapshot.SessionMAEPP != 11 {
		t.Fatalf("session mae = %.2f, want 11", snapshot.SessionMAEPP)
	}
	if snapshot.SessionBiasPP != 9 {
		t.Fatalf("session bias = %.2f, want 9", snapshot.SessionBiasPP)
	}
	if snapshot.Within10Rate != 50 {
		t.Fatalf("within10 rate = %.2f, want 50", snapshot.Within10Rate)
	}
	if snapshot.LogPath == "" {
		t.Fatal("log path should not be empty")
	}

	logPath := snapshot.LogPath
	monitor.Close()

	data, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatalf("read log: %v", err)
	}
	lines := strings.Split(strings.TrimSpace(string(data)), "\n")
	if len(lines) != 2 {
		t.Fatalf("log line count = %d, want 2", len(lines))
	}
	if !strings.Contains(lines[0], "\"errorPP\":20") {
		t.Fatalf("first line missing expected error payload: %s", lines[0])
	}
}

func TestERSCompareMonitorResetsOnDisableAndNewSession(t *testing.T) {
	monitor := newERSCompareMonitor(t.TempDir(), slog.New(slog.NewTextHandler(io.Discard, nil)))
	t.Cleanup(monitor.Close)

	monitor.Observe(101, time.Unix(0, 0).Add(2*time.Second), buildERSCompareState(8, 12))
	first := monitor.Snapshot()
	if first.SampleCount != 1 {
		t.Fatalf("first sample count = %d, want 1", first.SampleCount)
	}
	firstLogPath := first.LogPath
	if firstLogPath == "" {
		t.Fatal("first log path should not be empty")
	}

	monitor.Observe(101, time.Unix(0, 0).Add(2250*time.Millisecond), &dto.PitwallState{ERSComparisonEnabled: false})
	disabled := monitor.Snapshot()
	if disabled.SampleCount != 0 {
		t.Fatalf("disabled sample count = %d, want 0", disabled.SampleCount)
	}
	if disabled.CurrentErrorReady {
		t.Fatal("current error should reset when compare is disabled")
	}
	if disabled.LogPath != firstLogPath {
		t.Fatalf("disabled log path = %q, want %q", disabled.LogPath, firstLogPath)
	}

	monitor.Observe(202, time.Unix(0, 0).Add(3*time.Second), buildERSCompareState(32, 28))
	second := monitor.Snapshot()
	if second.SampleCount != 1 {
		t.Fatalf("second sample count = %d, want 1", second.SampleCount)
	}
	if second.CurrentErrorPP != 4 {
		t.Fatalf("second current error = %d, want 4", second.CurrentErrorPP)
	}
	if second.SessionMAEPP != 4 {
		t.Fatalf("second session mae = %.2f, want 4", second.SessionMAEPP)
	}
	if second.SessionBiasPP != 4 {
		t.Fatalf("second session bias = %.2f, want 4", second.SessionBiasPP)
	}
	if second.LogPath == "" || second.LogPath == firstLogPath {
		t.Fatalf("second log path = %q, want new path", second.LogPath)
	}
}

func buildERSCompareState(estimatePct, actualPct int) *dto.PitwallState {
	return &dto.PitwallState{
		PlayerIndex:          0,
		ERSComparisonEnabled: true,
		Session: &dto.SessionInfo{
			SessionType: "Race",
			TrackID:     6,
			TrackName:   "Jeddah Corniche Circuit",
			TrackLength: 6174,
		},
		Drivers: []dto.DriverInfo{
			{
				Index:               0,
				Name:                "PLAYER",
				TeamID:              1,
				Position:            4,
				CurrentLapNum:       18,
				CurrentSector:       3,
				LapDistance:         4200.0,
				Speed:               324,
				Throttle:            1.0,
				Brake:               0,
				ERSDeployMode:       3,
				ERSEstimatePct:      estimatePct,
				ERSEstimateReady:    true,
				ERSActualPct:        actualPct,
				ERSActualReady:      true,
				ERSStoreEnergy:      1_120_000,
				ERSDeployedThisLap:  140_000,
				ERSHarvestedThisLap: 55_000,
			},
		},
	}
}
