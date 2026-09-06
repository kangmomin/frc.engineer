package analysis

import (
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"frc.engineer/internal/packets"
	"frc.engineer/internal/udp"
)

func recordPacketLogs(t *testing.T, laps []packets.LapData, times []float32, statuses []packets.CarStatusData, statusTimes []float32) string {
	t.Helper()
	base := t.TempDir()
	pl := udp.NewPacketLogger(base, slog.New(slog.NewTextHandler(io.Discard, nil)))
	// Use the production logger in capture order, interleaving packet types.
	type event struct {
		at     float32
		lap    *packets.LapData
		status *packets.CarStatusData
	}
	events := make([]event, 0, len(laps)+len(statuses))
	for i := range laps {
		events = append(events, event{at: times[i], lap: &laps[i]})
	}
	for i := range statuses {
		events = append(events, event{at: statusTimes[i], status: &statuses[i]})
	}
	sort.SliceStable(events, func(i, j int) bool { return events[i].at < events[j].at })
	for i, ev := range events {
		h := packets.PacketHeader{PacketFormat: 2026, SessionUID: 1, SessionTime: ev.at, FrameIdentifier: uint32(i), PlayerCarIndex: 0}
		if ev.lap != nil {
			h.PacketID = packets.PacketIDLapData
			p := &packets.PacketLapData{Header: h}
			p.LapData[0] = *ev.lap
			pl.Log(&h, &udp.ParsedData{Header: &h, LapData: p}, []byte{1})
		} else {
			h.PacketID = packets.PacketIDCarStatus
			p := &packets.PacketCarStatusData{Header: h}
			p.CarStatusData[0] = *ev.status
			pl.Log(&h, &udp.ParsedData{Header: &h, CarStatus: p}, []byte{1})
		}
	}
	pl.Close()
	dirs, err := os.ReadDir(base)
	if err != nil || len(dirs) != 1 {
		t.Fatalf("session directory: %v / %d", err, len(dirs))
	}
	return filepath.Join(base, dirs[0].Name())
}

func TestAnalysisInvalidLapDoesNotBecomeBest(t *testing.T) {
	dir := recordPacketLogs(t, []packets.LapData{
		{CurrentLapNum: 1, CurrentLapInvalid: 1, Sector: 2},
		{CurrentLapNum: 2, LastLapTimeInMS: 80000},
		{CurrentLapNum: 2, CurrentLapInvalid: 0, Sector: 2},
		{CurrentLapNum: 3, LastLapTimeInMS: 90000},
	}, []float32{79, 80, 169, 170}, nil, nil)
	result, err := Analyze(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Laps) != 2 {
		t.Fatalf("laps: %+v", result.Laps)
	}
	bestNum, bestTime := fastestLap(result.Laps)
	t.Logf("first lap invalid input=1; analysis valid=%v; best lap=%d time=%d", result.Laps[0].Valid, bestNum, bestTime)
	if result.Laps[0].Valid || bestNum != 2 || bestTime != 90000 {
		t.Fatal("invalid lap promoted to analysis best")
	}
}

func TestAnalysisPreservesCompletedSectors(t *testing.T) {
	dir := recordPacketLogs(t, []packets.LapData{
		{CurrentLapNum: 1, Sector: 2, Sector1TimeInMS: 10000, Sector1TimeMinutes: 1, Sector2TimeInMS: 40000},
		{CurrentLapNum: 2, LastLapTimeInMS: 150000, Sector: 0},
	}, []float32{149, 150}, nil, nil)
	result, err := Analyze(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Laps) != 1 {
		t.Fatalf("laps: %+v", result.Laps)
	}
	got := result.Laps[0]
	t.Logf("recorded sectors 70000/40000/40000; analysis=%d/%d/%d", got.Sector1Ms, got.Sector2Ms, got.Sector3Ms)
	if got.Sector1Ms != 70000 || got.Sector2Ms != 40000 || got.Sector3Ms != 40000 {
		t.Fatal("completed sector times lost at new lap")
	}
}

func TestAnalysisTyresFollowRecordedLapTime(t *testing.T) {
	dir := recordPacketLogs(t, []packets.LapData{
		{CurrentLapNum: 1},
		{CurrentLapNum: 2, LastLapTimeInMS: 90000},
		{CurrentLapNum: 3, LastLapTimeInMS: 90000},
		{CurrentLapNum: 4, LastLapTimeInMS: 90000},
	}, []float32{0, 90, 180, 270}, []packets.CarStatusData{
		{VisualTyreCompound: 16, TyresAgeLaps: 0},
		{VisualTyreCompound: 16, TyresAgeLaps: 1},
		{VisualTyreCompound: 16, TyresAgeLaps: 2},
		{VisualTyreCompound: 17, TyresAgeLaps: 0},
		{VisualTyreCompound: 17, TyresAgeLaps: 1},
		{VisualTyreCompound: 17, TyresAgeLaps: 2},
	}, []float32{0, 90, 179, 180, 270, 359})
	result, err := Analyze(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Laps) != 3 {
		t.Fatalf("laps: %+v", result.Laps)
	}
	t.Logf("recording Soft lap1-2 then Medium lap3; analysis=%s/%s/%s; stints=%+v", result.Laps[0].Compound, result.Laps[1].Compound, result.Laps[2].Compound, result.Stints)
	if result.Laps[0].Compound != "Soft" || result.Laps[1].Compound != "Soft" || result.Laps[2].Compound != "Medium" {
		t.Fatal("future replacement tyre assigned to pre-pit lap")
	}
}

func TestSessionsSortedByTimestamp(t *testing.T) {
	base := t.TempDir()
	for _, name := range []string{"9_20260101_000000", "1_20260905_000000"} {
		dir := filepath.Join(base, name)
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "lap_data.jsonl"), []byte("{}\n"), 0644); err != nil {
			t.Fatal(err)
		}
	}
	sessions, err := ListSessions(base)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("session order=%s, %s", sessions[0].Timestamp, sessions[1].Timestamp)
	if sessions[0].Timestamp != "20260905_000000" {
		t.Fatal("newest session is not first")
	}
}

func TestAnalysisNoValidBestAndUnknownSectors(t *testing.T) {
	dir := recordPacketLogs(t, []packets.LapData{
		{CurrentLapNum: 1, CurrentLapInvalid: 1},
		{CurrentLapNum: 1, CurrentLapInvalid: 0},
		{CurrentLapNum: 2, LastLapTimeInMS: 80000},
	}, []float32{10, 79, 80}, nil, nil)
	result, err := Analyze(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Laps) != 1 || result.Laps[0].Valid || result.Laps[0].Sector3Ms != 0 {
		t.Fatalf("lap: %+v", result.Laps)
	}
	if n, ms := fastestLap(result.Laps); n != 0 || ms != 0 {
		t.Fatalf("all invalid laps produced best %d/%d", n, ms)
	}
}

func TestAnalysisLapJumpDoesNotInventCompletion(t *testing.T) {
	dir := recordPacketLogs(t, []packets.LapData{
		{CurrentLapNum: 1, CurrentLapInvalid: 1},
		{CurrentLapNum: 3, LastLapTimeInMS: 80000},
		{CurrentLapNum: 4, LastLapTimeInMS: 90000},
	}, []float32{0, 170, 260}, nil, nil)
	laps, err := parseLapData(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(laps) != 1 || laps[0].LapNum != 3 || !laps[0].Valid {
		t.Fatalf("laps after jump: %+v", laps)
	}
}

func TestAnalysisFlashbackKeepsTheReplacementLapAndTyres(t *testing.T) {
	dir := t.TempDir()
	lap := func(ts string, sessionTime int, num uint8, invalid uint8, last uint32) map[string]any {
		return map[string]any{"ts": ts, "sessionTime": sessionTime, "data": map[string]any{
			"Header": map[string]any{"PlayerCarIndex": 0}, "LapData": []packets.LapData{{CurrentLapNum: num, CurrentLapInvalid: invalid, LastLapTimeInMS: last}},
		}}
	}
	writeJSONLFile(t, dir, "lap_data.jsonl",
		lap("2026-09-06T00:00:00Z", 0, 1, 1, 0),
		lap("2026-09-06T00:01:20Z", 80, 2, 0, 80000),
		lap("2026-09-06T00:01:30Z", 50, 1, 0, 0),
		lap("2026-09-06T00:02:15Z", 95, 2, 0, 95000),
	)
	status := func(ts string, sessionTime int, compound uint8) map[string]any {
		return map[string]any{"ts": ts, "sessionTime": sessionTime, "data": map[string]any{
			"Header": map[string]any{"PlayerCarIndex": 0}, "CarStatusData": []packets.CarStatusData{{VisualTyreCompound: compound}},
		}}
	}
	writeJSONLFile(t, dir, "car_status.jsonl",
		status("2026-09-06T00:01:19Z", 79, 16),
		status("2026-09-06T00:01:31Z", 51, 17),
		status("2026-09-06T00:02:16Z", 96, 18),
	)
	result, err := Analyze(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Laps) != 1 || !result.Laps[0].Valid || result.Laps[0].LapTimeMs != 95000 || result.Laps[0].Compound != "Medium" {
		t.Fatalf("replacement lap: %+v", result.Laps)
	}
}

func TestAnalysisDoesNotUseFutureTyres(t *testing.T) {
	dir := recordPacketLogs(t, []packets.LapData{
		{CurrentLapNum: 1}, {CurrentLapNum: 2, LastLapTimeInMS: 90000},
	}, []float32{0, 90}, []packets.CarStatusData{{VisualTyreCompound: 17}}, []float32{91})
	result, err := Analyze(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Laps) != 1 || result.Laps[0].Compound != "" {
		t.Fatalf("future tyre: %+v", result.Laps)
	}
}

func TestAnalysisLegacySectorAliases(t *testing.T) {
	dir := recordPacketLogs(t, []packets.LapData{
		{CurrentLapNum: 1, Sector: 2, Sector1TimeMinutes: 1, Sector1TimeInMS: 10000, Sector2TimeInMS: 40000},
		{CurrentLapNum: 2, LastLapTimeInMS: 150000},
	}, []float32{149, 150}, nil, nil)
	path := filepath.Join(dir, "lap_data.jsonl")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	legacy := strings.NewReplacer("Sector1TimeInMS", "Sector1TimeMSPart", "Sector1TimeMinutes", "Sector1TimeMinPart", "Sector2TimeInMS", "Sector2TimeMSPart", "Sector2TimeMinutes", "Sector2TimeMinPart").Replace(string(raw))
	if err := os.WriteFile(path, []byte(legacy), 0600); err != nil {
		t.Fatal(err)
	}
	result, err := Analyze(dir)
	if err != nil || len(result.Laps) != 1 {
		t.Fatalf("legacy analysis: %+v / %v", result, err)
	}
	lap := result.Laps[0]
	if lap.Sector1Ms != 70000 || lap.Sector2Ms != 40000 || lap.Sector3Ms != 40000 {
		t.Fatalf("legacy sectors: %+v", lap)
	}
}
