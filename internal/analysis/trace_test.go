package analysis

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func tracePacket(stream string, frame, overall uint32, at, distance float64, lap int) map[string]any {
	key := map[string]string{"lap_data": "LapData", "telemetry": "CarTelemetryData", "motion": "CarMotionData", "car_status": "CarStatusData"}[stream]
	row := map[string]any{}
	switch stream {
	case "lap_data":
		row = map[string]any{"CurrentLapNum": lap, "CurrentLapTimeInMS": at * 1000, "LastLapTimeInMS": 1000, "LapDistance": distance}
	case "telemetry":
		row = map[string]any{"Speed": 200, "Throttle": 0.8, "Brake": 0.0, "Steer": 0, "Gear": 4, "EngineRPM": 11000}
	case "motion":
		row = map[string]any{"WorldPositionX": distance, "WorldPositionZ": -distance, "WorldVelocityX": 0, "WorldVelocityZ": 55, "Yaw": 0}
	case "car_status":
		row = map[string]any{"FuelInTank": 0, "ERSStoreEnergy": 1234567}
	}
	return map[string]any{"ts": time.Unix(1700000000, 0).Add(time.Duration(overall) * time.Millisecond).UTC().Format(time.RFC3339Nano), "frame": frame, "sessionTime": at, "data": map[string]any{"Header": map[string]any{"PlayerCarIndex": 0, "SessionUID": 1, "OverallFrameIdentifier": overall, "FrameIdentifier": frame, "SessionTime": at, "PacketFormat": 2026, "GameYear": 26}, key: []any{row}}}
}
func packetHeaderMap(p map[string]any) map[string]any {
	return p["data"].(map[string]any)["Header"].(map[string]any)
}
func packetRow(p map[string]any, key string) map[string]any {
	return p["data"].(map[string]any)[key].([]any)[0].(map[string]any)
}
func nativeFixture(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	var laps, controls, motion, status []map[string]any
	for i := 0; i < 60; i++ {
		frame := uint32(i + 1)
		at := float64(i) / 60
		dist := at * 100
		if i%3 == 0 {
			laps = append(laps, tracePacket("lap_data", frame, frame, at, dist, 1))
		}
		tel := tracePacket("telemetry", frame, frame, at, dist, 1)
		if i == 1 {
			packetRow(tel, "CarTelemetryData")["Brake"] = 1
		}
		controls = append(controls, tel)
		motion = append(motion, tracePacket("motion", frame, frame, at, dist, 1))
		if i%30 == 0 {
			status = append(status, tracePacket("car_status", frame, frame, at, dist, 1))
		}
	}
	end := tracePacket("lap_data", 61, 61, 1, 0, 2)
	packetRow(end, "LapData")["CurrentLapTimeInMS"] = 0
	laps = append(laps, end)
	writeJSONLFile(t, dir, "lap_data.jsonl", laps...)
	writeJSONLFile(t, dir, "telemetry.jsonl", controls...)
	writeJSONLFile(t, dir, "motion.jsonl", motion...)
	writeJSONLFile(t, dir, "car_status.jsonl", status...)
	writeJSONLFile(t, dir, "session.jsonl", map[string]any{"data": map[string]any{"TrackID": 0, "TrackLength": 100}})
	return dir
}
func TestSelectedTraceNativeCadencePulseAndFinish(t *testing.T) {
	tr, err := ReadSelectedLapTrace(context.Background(), nativeFixture(t), 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(tr.Timing) != 20 || len(tr.Controls) != 60 || len(tr.Motion) != 60 || len(tr.Status) != 2 {
		t.Fatalf("native counts %d/%d/%d/%d", len(tr.Timing), len(tr.Controls), len(tr.Motion), len(tr.Status))
	}
	pulse := tr.Controls[1]
	if pulse.Brake == nil || *pulse.Brake != 1 || pulse.DistanceM == nil || math.Abs(*pulse.DistanceM-100.0/60) > 1e-8 || pulse.Alignment != "interpolated" {
		t.Fatalf("pulse lost: %+v", pulse)
	}
	if tr.Controls[59].DistanceM != nil {
		t.Fatal("must not extrapolate trailing controls")
	}
	if tr.Status[1].DistanceM == nil || *tr.Status[1].FuelKg != 0 || *tr.Status[1].ERSJ != 1234567 {
		t.Fatalf("2 Hz status must align and preserve zero: %+v", tr.Status)
	}
	if tr.Finish.ElapsedMs != 1000 || tr.Finish.Source != "lastLapTime" || *tr.Finish.DistanceM != 100 || *tr.Timing[len(tr.Timing)-1].ElapsedMs >= 1000 {
		t.Fatal("official finish must stay separate")
	}
	if tr.TrackID == nil || *tr.TrackID != 0 || tr.PacketFormat == nil || *tr.PacketFormat != 2026 {
		t.Fatal("known track zero or format lost")
	}
	q := tr.Quality.Controls
	if q.CapturedSamples != 60 || q.ReturnedSamples != 60 || q.AlignedSamples != 58 || q.Method != "overallFrame" || math.Abs(*q.MedianIntervalMs-1000.0/60) > 1e-7 || math.Abs(*q.MaxSkewMs-1000.0/60) > 1e-7 || *q.MaxSkewFrames != 1 {
		t.Fatalf("wrong quality: %+v", q)
	}
}
func TestSelectedTraceWindowCountsAndUnknowns(t *testing.T) {
	dir := nativeFixture(t)
	window := &TraceExtent{FromM: 0, ToM: 5}
	tr, err := ReadSelectedLapTrace(context.Background(), dir, 1, window)
	if err != nil {
		t.Fatal(err)
	}
	if len(tr.Controls) != 4 || tr.Quality.Controls.CapturedSamples != 60 || tr.Quality.Controls.ReturnedSamples != 4 {
		t.Fatalf("window cadence/count %+v", tr.Quality.Controls)
	}
	for _, name := range []string{"session", "telemetry", "motion", "car_status"} {
		if err := os.Remove(filepath.Join(dir, name+".jsonl")); err != nil {
			t.Fatal(err)
		}
	}
	tr, err = ReadSelectedLapTrace(context.Background(), dir, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	if tr.TrackID != nil || tr.TrackLengthM != nil || tr.Finish.DistanceM != nil || tr.Controls == nil || tr.Motion == nil || tr.Status == nil || tr.Quality.Status.Available {
		t.Fatalf("unknown metadata/optional streams: %+v", tr)
	}
	tr2, err := ReadSelectedLapTrace(context.Background(), dir, 1, nil)
	if err != nil || tr.AttemptID != tr2.AttemptID {
		t.Fatal("attempt ID must be deterministic")
	}
	_, err = ReadSelectedLapTrace(context.Background(), dir, 1, &TraceExtent{FromM: 0, ToM: 100})
	var e *TraceError
	if !errors.As(err, &e) || e.Code != "invalid_query" || e.Extent == nil {
		t.Fatalf("observed extent validation: %v", err)
	}
}
func TestSelectedTraceMissingClockAndNullChannels(t *testing.T) {
	dir := t.TempDir()
	a := tracePacket("lap_data", 1, 0, 0, 0, 1)
	b := tracePacket("lap_data", 2, 0, 1, 0, 2)
	tel := tracePacket("telemetry", 1, 0, 0, 0, 1)
	for _, p := range []map[string]any{a, b, tel} {
		delete(p, "ts")
		delete(p, "sessionTime")
		h := packetHeaderMap(p)
		delete(h, "SessionTime")
		delete(h, "PacketFormat")
		delete(h, "GameYear")
	}
	delete(packetRow(a, "LapData"), "CurrentLapTimeInMS")
	row := packetRow(tel, "CarTelemetryData")
	delete(row, "Speed")
	row["Throttle"] = 2
	row["Brake"] = 0
	row["Steer"] = -2
	row["Gear"] = 2.5
	delete(row, "EngineRPM")
	writeJSONLFile(t, dir, "lap_data.jsonl", a, b)
	writeJSONLFile(t, dir, "telemetry.jsonl", tel)
	tr, err := ReadSelectedLapTrace(context.Background(), dir, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	if tr.PacketFormat != nil || tr.GameYear != nil || tr.Timing[0].ElapsedMs != nil || tr.Timing[0].SessionTimeMs != nil || tr.Controls[0].DistanceM == nil || tr.Quality.Controls.Method != "frame" {
		t.Fatalf("legacy exact identity: %+v", tr)
	}
	c := tr.Controls[0]
	if c.SpeedKph != nil || c.Throttle != nil || c.Steer != nil || c.Gear != nil || c.RPM != nil || c.Brake == nil || *c.Brake != 0 {
		t.Fatalf("null/zero domains: %+v", c)
	}
	data, _ := json.Marshal(tr)
	var decoded map[string]any
	if json.Unmarshal(data, &decoded) != nil || decoded["trackId"] != nil {
		t.Fatal("null JSON contract")
	}
	// A duplicate source frame must never become a map overwrite.
	writeJSONLFile(t, dir, "telemetry.jsonl", tel, tel)
	tr, err = ReadSelectedLapTrace(context.Background(), dir, 1, nil)
	if err != nil || len(tr.Controls) != 0 {
		t.Fatalf("ambiguous source accepted: %v %+v", err, tr)
	}
}
func TestSelectedTraceFlashbackIsolationAndLegacyAmbiguity(t *testing.T) {
	for _, mode := range []string{"overall", "capture", "legacy", "tiedCapture"} {
		t.Run(mode, func(t *testing.T) {
			dir := t.TempDir()
			laps := []map[string]any{tracePacket("lap_data", 1, 1, 0, 0, 1), tracePacket("lap_data", 4, 4, .05, 50, 1), tracePacket("lap_data", 7, 7, .1, 100, 1), tracePacket("lap_data", 4, 10, .05, 50, 1), tracePacket("lap_data", 7, 13, .1, 100, 1), tracePacket("lap_data", 10, 16, .15, 0, 2)}
			old := tracePacket("telemetry", 4, 4, .05, 50, 1)
			packetRow(old, "CarTelemetryData")["Speed"] = 999
			fresh := tracePacket("telemetry", 4, 10, .05, 50, 1)
			packetRow(fresh, "CarTelemetryData")["Speed"] = 123
			wrong := tracePacket("telemetry", 7, 13, .1, 100, 1)
			packetHeaderMap(wrong)["SessionUID"] = 2
			all := append(append([]map[string]any{}, laps...), old, fresh, wrong)
			for _, p := range all {
				if mode != "overall" {
					packetHeaderMap(p)["OverallFrameIdentifier"] = 0
				}
				if mode == "legacy" {
					delete(p, "ts")
				}
				if mode == "tiedCapture" {
					p["ts"] = "2026-01-01T00:00:00Z"
				}
			}
			writeJSONLFile(t, dir, "lap_data.jsonl", laps...)
			writeJSONLFile(t, dir, "telemetry.jsonl", old, fresh, wrong)
			tr, err := ReadSelectedLapTrace(context.Background(), dir, 1, nil)
			if mode == "legacy" || mode == "tiedCapture" {
				var e *TraceError
				if !errors.As(err, &e) || e.Code != "trace_unavailable" {
					t.Fatalf("ambiguous attempt should fail: %v", err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if len(tr.Timing) != 2 || *tr.Timing[0].DistanceM != 50 || len(tr.Controls) != 1 || *tr.Controls[0].SpeedKph != 123 {
				t.Fatalf("abandoned/other UID rows leaked: %+v", tr)
			}
			// Coarse analysis uses precisely the same surviving attempt.
			mot := tracePacket("motion", 4, 10, .05, 50, 1)
			if mode == "capture" {
				packetHeaderMap(mot)["OverallFrameIdentifier"] = 0
			}
			writeJSONLFile(t, dir, "motion.jsonl", mot)
			result, err := Analyze(dir)
			if err != nil || result.Comparison == nil {
				t.Fatalf("coarse unavailable: %v", err)
			}
			if got := result.Comparison.Laps[0].Trace.Speed[1]; got == nil || *got != 123 {
				t.Fatalf("coarse contaminated: %v", got)
			}
		})
	}
}
func TestSelectedTraceGapsAndDuplicateDistances(t *testing.T) {
	dir := t.TempDir()
	laps := []map[string]any{tracePacket("lap_data", 1, 1, 0, 0, 1), tracePacket("lap_data", 4, 4, .05, 5, 1), tracePacket("lap_data", 7, 7, .1, 5, 1), tracePacket("lap_data", 10, 10, .3, 30, 1), tracePacket("lap_data", 13, 13, .35, 35, 1), tracePacket("lap_data", 16, 16, .4, 0, 2)}
	writeJSONLFile(t, dir, "lap_data.jsonl", laps...)
	writeJSONLFile(t, dir, "telemetry.jsonl", tracePacket("telemetry", 5, 5, .075, 0, 1), tracePacket("telemetry", 8, 8, .2, 0, 1), tracePacket("telemetry", 11, 11, .325, 0, 1))
	tr, err := ReadSelectedLapTrace(context.Background(), dir, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	if tr.Controls[0].DistanceM != nil || tr.Controls[1].DistanceM != nil || tr.Controls[2].DistanceM == nil {
		t.Fatalf("gap or ambiguous distance interpolation: %+v", tr.Controls)
	}
	if *tr.Timing[1].Segment == *tr.Timing[2].Segment || *tr.Timing[2].Segment == *tr.Timing[3].Segment {
		t.Fatal("timing gaps must break segments")
	}
}
func TestSelectedTraceLimitsAndCancellation(t *testing.T) {
	dir := t.TempDir()
	writeJSONLFile(t, dir, "lap_data.jsonl", tracePacket("lap_data", 1, 1, 0, 0, 1), tracePacket("lap_data", 70000, 70000, 70, 0, 2))
	f, err := os.Create(filepath.Join(dir, "telemetry.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	encoder := json.NewEncoder(f)
	for i := 1; i <= MaxTraceSamples+1; i++ {
		if err := encoder.Encode(tracePacket("telemetry", uint32(i), uint32(i), float64(i)/1000, 0, 1)); err != nil {
			t.Fatal(err)
		}
	}
	f.Close()
	_, err = ReadSelectedLapTrace(context.Background(), dir, 1, nil)
	var e *TraceError
	if !errors.As(err, &e) || e.Code != "trace_too_large" || e.MaxSamples != 60000 || e.MaxBytes != MaxTraceBytes {
		t.Fatalf("sample cap: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err = ReadSelectedLapTrace(ctx, dir, 1, nil)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("cancel: %v", err)
	}
}
func TestSnapshotStopsAtInitialBytesAndSkipsPartialJSON(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "lap_data.jsonl")
	line, _ := json.Marshal(tracePacket("lap_data", 1, 1, 0, 0, 1))
	initial := append(line, '\n')
	if err := os.WriteFile(path, initial, 0600); err != nil {
		t.Fatal(err)
	}
	f, _ := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0600)
	fmt.Fprintln(f, string(line))
	f.Close()
	frames, err := readLapTimeline(context.Background(), dir, int64(len(initial)))
	if err != nil || len(frames) != 1 {
		t.Fatalf("snapshot grew: %v %d", err, len(frames))
	}
	if err := os.WriteFile(path, append(initial, []byte(`{"data":`)...), 0600); err != nil {
		t.Fatal(err)
	}
	frames, err = readLapTimeline(context.Background(), dir, -1)
	if err != nil || len(frames) != 1 {
		t.Fatalf("partial line: %v", err)
	}
}

func TestSelectedTraceSequentialBoundariesAndPlayerIdentity(t *testing.T) {
	dir := t.TempDir()
	a := tracePacket("lap_data", 1, 1, 0, 0, 1)
	b := tracePacket("lap_data", 4, 4, .05, 5, 1)
	c := tracePacket("lap_data", 7, 7, .1, 0, 2)
	d := tracePacket("lap_data", 10, 10, .15, 5, 2)
	e := tracePacket("lap_data", 13, 13, .2, 0, 3)
	packetRow(c, "LapData")["CurrentLapTimeInMS"] = 0
	packetRow(d, "LapData")["CurrentLapTimeInMS"] = 50
	packetRow(e, "LapData")["CurrentLapTimeInMS"] = 0
	tel := tracePacket("telemetry", 7, 7, .1, 0, 2)
	wrong := tracePacket("telemetry", 10, 10, .15, 0, 2)
	packetHeaderMap(wrong)["PlayerCarIndex"] = 1
	wrong["data"].(map[string]any)["CarTelemetryData"] = []any{map[string]any{}, map[string]any{"Speed": 999}}
	writeJSONLFile(t, dir, "lap_data.jsonl", a, b, c, d, e)
	writeJSONLFile(t, dir, "telemetry.jsonl", tel, wrong)
	first, err := ReadSelectedLapTrace(context.Background(), dir, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	second, err := ReadSelectedLapTrace(context.Background(), dir, 2, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Timing) != 2 || len(first.Controls) != 0 || len(second.Timing) != 2 || len(second.Controls) != 1 || first.AttemptID == second.AttemptID || *second.Timing[0].ElapsedMs != 0 {
		t.Fatal("lap start belongs to exactly one completed lap")
	}
	// Removing capture timestamps/overall keeps globally unique exact legacy joins.
	for _, p := range []map[string]any{a, b, c, d, e, tel, wrong} {
		delete(p, "ts")
		packetHeaderMap(p)["OverallFrameIdentifier"] = 0
	}
	writeJSONLFile(t, dir, "lap_data.jsonl", a, b, c, d, e)
	writeJSONLFile(t, dir, "telemetry.jsonl", tel, wrong)
	second, err = ReadSelectedLapTrace(context.Background(), dir, 2, nil)
	if err != nil || len(second.Controls) != 1 || second.Quality.Controls.Method != "frame" {
		t.Fatalf("sequential legacy clock reset misidentified as rewind: %v %+v", err, second)
	}
}
func TestSelectedTraceUnreliableSourceOverallAndOptionalOverflow(t *testing.T) {
	dir := nativeFixture(t)
	a := tracePacket("telemetry", 2, 2, 1.0/60, 0, 1)
	b := tracePacket("telemetry", 3, 2, 2.0/60, 0, 1)
	delete(a, "ts")
	delete(b, "ts")
	writeJSONLFile(t, dir, "telemetry.jsonl", a, b)
	tr, err := ReadSelectedLapTrace(context.Background(), dir, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(tr.Controls) != 0 {
		t.Fatal("repeated source overall must not establish identity")
	}
	// JSON numeric overflow and bad optional types become null, not lost rows.
	raw := `{"frame":1,"sessionTime":0,"data":{"Header":{"PlayerCarIndex":0,"OverallFrameIdentifier":1,"SessionUID":1},"CarTelemetryData":[{"Speed":1e999,"Throttle":"bad","Brake":0,"Gear":4}]}}` + "\n"
	if err := os.WriteFile(filepath.Join(dir, "telemetry.jsonl"), []byte(raw), 0600); err != nil {
		t.Fatal(err)
	}
	tr, err = ReadSelectedLapTrace(context.Background(), dir, 1, nil)
	if err != nil || len(tr.Controls) != 1 || tr.Controls[0].SpeedKph != nil || tr.Controls[0].Throttle != nil || tr.Controls[0].Brake == nil {
		t.Fatalf("optional overflow lost native row: %v %+v", err, tr)
	}
	result, err := Analyze(dir)
	if err != nil || result.Comparison == nil {
		t.Fatalf("coarse: %v", err)
	}
	if err := os.Remove(filepath.Join(dir, "motion.jsonl")); err != nil {
		t.Fatal(err)
	}
	writeJSONLFile(t, dir, "telemetry.jsonl", tracePacket("telemetry", 1, 1, 0, 0, 1))
	result, err = Analyze(dir)
	if err != nil || result.Speed == nil || result.Comparison != nil {
		t.Fatalf("safe coarse speed fallback changed: %v %+v", err, result)
	}
}
func TestSelectedTraceEncodedByteLimit(t *testing.T) {
	dir := t.TempDir()
	var laps []map[string]any
	const samples = 59800
	for i := 0; i < samples; i += 300 {
		at := float64(i) * .000123456789012345
		lap := tracePacket("lap_data", uint32(i+1), uint32(i+1), at, at*1.2345678901234567e-100, 1)
		packetRow(lap, "LapData")["CurrentLapTimeInMS"] = math.Trunc(at * 1000)
		laps = append(laps, lap)
	}
	laps = append(laps, tracePacket("lap_data", samples+1, samples+1, 8, 0, 2))
	writeJSONLFile(t, dir, "lap_data.jsonl", laps...)
	f, err := os.Create(filepath.Join(dir, "telemetry.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < samples; i++ {
		fmt.Fprintf(f, `{"frame":%d,"sessionTime":%.17g,"data":{"Header":{"PlayerCarIndex":0,"SessionUID":1,"OverallFrameIdentifier":%d},"CarTelemetryData":[{"Speed":1.2345678901234567e-100,"Throttle":1.2345678901234567e-100,"Brake":2.3456789012345678e-100,"Steer":-3.4567890123456789e-100,"Gear":4,"EngineRPM":1.2345678901234567e-100}]}}`+"\n", i+1, float64(i)*.000123456789012345, i+1)
	}
	f.Close()
	_, err = ReadSelectedLapTrace(context.Background(), dir, 1, nil)
	var e *TraceError
	if !errors.As(err, &e) || e.Code != "trace_too_large" {
		t.Fatalf("byte cap below sample cap: %v", err)
	}
}

func TestSelectedTraceMissingDistanceBreaksSegmentWithoutRestart(t *testing.T) {
	for _, missing := range []string{"absent", "null", "negative", "overflow"} {
		t.Run(missing, func(t *testing.T) {
			dir := t.TempDir()
			first := tracePacket("lap_data", 1, 1, 0, 100, 1)
			gap := tracePacket("lap_data", 4, 4, .05, 105, 1)
			after := tracePacket("lap_data", 7, 7, .1, 110, 1)
			finish := tracePacket("lap_data", 10, 10, .15, 0, 2)
			switch missing {
			case "absent":
				delete(packetRow(gap, "LapData"), "LapDistance")
			case "null":
				packetRow(gap, "LapData")["LapDistance"] = nil
			case "negative":
				packetRow(gap, "LapData")["LapDistance"] = -1
			case "overflow":
				packetRow(gap, "LapData")["LapDistance"] = json.Number("1e999")
			}
			writeJSONLFile(t, dir, "lap_data.jsonl", first, gap, after, finish)
			writeJSONLFile(t, dir, "telemetry.jsonl", tracePacket("telemetry", 1, 1, 0, 100, 1), tracePacket("telemetry", 4, 4, .05, 105, 1), tracePacket("telemetry", 7, 7, .1, 110, 1))
			trace, err := ReadSelectedLapTrace(context.Background(), dir, 1, nil)
			if err != nil {
				t.Fatal(err)
			}
			if len(trace.Timing) != 3 || trace.Timing[0].DistanceM == nil || *trace.Timing[0].DistanceM != 100 || trace.Timing[1].DistanceM != nil || trace.Timing[2].DistanceM == nil || *trace.Timing[2].DistanceM != 110 {
				t.Fatalf("coordinate gap changed the completed attempt: %+v", trace.Timing)
			}
			if trace.Timing[1].Segment != nil || *trace.Timing[0].Segment == *trace.Timing[2].Segment {
				t.Fatal("missing coordinate must break the segment")
			}
			if len(trace.Controls) != 3 || trace.Controls[0].DistanceM == nil || trace.Controls[1].DistanceM != nil || trace.Quality.Timing.CapturedSamples != 3 {
				t.Fatal("coordinate gap discarded native rows")
			}
			frames, err := readLapTimeline(context.Background(), dir, -1)
			if err != nil {
				t.Fatal(err)
			}
			laps := summarizeLapFrames(frames)
			if len(laps) != 1 || laps[0].startOrdinal != 0 || laps[0].generation != 0 {
				t.Fatalf("coordinate gap was classified as a rewind: %+v", laps)
			}
		})
	}
}
