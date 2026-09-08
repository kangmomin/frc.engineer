package analysis

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"math"
	"os"
	"path/filepath"
	"sort"
	"time"
)

type captureIdentity struct {
	Player   *int     `json:"PlayerCarIndex"`
	UID      *uint64  `json:"SessionUID"`
	Overall  *uint32  `json:"OverallFrameIdentifier"`
	Frame    *uint32  `json:"FrameIdentifier"`
	Time     *float64 `json:"SessionTime"`
	Format   *int     `json:"PacketFormat"`
	Year     *int     `json:"GameYear"`
	recorded time.Time
}
type nativeCar struct {
	Distance *float64 `json:"LapDistance"`
	Elapsed  *float64 `json:"CurrentLapTimeInMS"`
	Speed    *float64 `json:"Speed"`
	Throttle *float64 `json:"Throttle"`
	Brake    *float64 `json:"Brake"`
	Steer    *float64 `json:"Steer"`
	Gear     *float64 `json:"Gear"`
	RPM      *float64 `json:"EngineRPM"`
	X        *float64 `json:"WorldPositionX"`
	Z        *float64 `json:"WorldPositionZ"`
	Fuel     *float64 `json:"FuelInTank"`
	ERS      *float64 `json:"ERSStoreEnergy"`
	VelX     float32  `json:"WorldVelocityX"`
	VelZ     float32  `json:"WorldVelocityZ"`
	Yaw      float32  `json:"Yaw"`
}
type nativeRecord struct {
	id  captureIdentity
	car nativeCar
	lap lapDatum
}

// All readers consume only the byte count captured before analysis starts.
func scanSnapshot(ctx context.Context, path string, size int64, visit func([]byte) error) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	if size < 0 {
		st, err := f.Stat()
		if err != nil {
			return err
		}
		size = st.Size()
	}
	scanner := bufio.NewScanner(io.LimitReader(f, size))
	scanner.Buffer(make([]byte, 64*1024), 4*1024*1024)
	for scanner.Scan() {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := visit(scanner.Bytes()); err != nil {
			return err
		}
	}
	return scanner.Err()
}
func decodeNative(line []byte, stream string) (nativeRecord, bool) {
	var env struct {
		TS    string          `json:"ts"`
		Frame *uint32         `json:"frame"`
		Time  *float64        `json:"sessionTime"`
		Data  json.RawMessage `json:"data"`
	}
	var pkt struct {
		Header                                                  captureIdentity
		LapData, CarTelemetryData, CarMotionData, CarStatusData []json.RawMessage
	}
	if json.Unmarshal(line, &env) != nil || json.Unmarshal(env.Data, &pkt) != nil || pkt.Header.Player == nil {
		return nativeRecord{}, false
	}
	id := pkt.Header
	id.recorded, _ = time.Parse(time.RFC3339Nano, env.TS)
	if id.Frame == nil {
		id.Frame = env.Frame
	}
	if id.Time == nil {
		id.Time = env.Time
	}
	id.Time = bounded(id.Time, 0, math.MaxFloat64)
	var rows []json.RawMessage
	switch stream {
	case "lap_data":
		rows = pkt.LapData
	case "telemetry":
		rows = pkt.CarTelemetryData
	case "motion":
		rows = pkt.CarMotionData
	case "car_status":
		rows = pkt.CarStatusData
	}
	if *id.Player < 0 || *id.Player >= len(rows) {
		return nativeRecord{}, false
	}
	r := nativeRecord{id: id}
	row := rows[*id.Player]
	if json.Unmarshal(row, &r.car) != nil {
		return r, false
	}
	if stream == "lap_data" && json.Unmarshal(row, &r.lap) != nil {
		// Optional coordinate/clock overflow must not erase the lap identity.
		var fields map[string]json.RawMessage
		if json.Unmarshal(row, &fields) != nil {
			return r, false
		}
		delete(fields, "LapDistance")
		delete(fields, "CurrentLapTimeInMS")
		sanitized, _ := json.Marshal(fields)
		if json.Unmarshal(sanitized, &r.lap) != nil {
			return r, false
		}
		if v := bounded(r.car.Elapsed, 0, math.MaxUint32); v != nil && math.Trunc(*v) == *v {
			r.lap.CurrentLapTimeInMS = uint32(*v)
		}
		if v := bounded(r.car.Distance, -math.MaxFloat32, math.MaxFloat32); v != nil {
			r.lap.LapDistance = float32(*v)
		}
	}
	return r, true
}
func readLapTimeline(ctx context.Context, dir string, size int64) ([]parsedLapFrame, error) {
	var frames []parsedLapFrame
	err := scanSnapshot(ctx, filepath.Join(dir, "lap_data.jsonl"), size, func(line []byte) error {
		r, ok := decodeNative(line, "lap_data")
		if !ok {
			return nil
		}
		ld := r.lap
		s1 := uint32(ld.Sector1TimeMinutes)*60000 + uint32(ld.Sector1TimeInMS)
		s2 := uint32(ld.Sector2TimeMinutes)*60000 + uint32(ld.Sector2TimeInMS)
		if s1 == 0 {
			s1 = uint32(ld.Sector1TimeMinPart)*60000 + uint32(ld.Sector1TimeMSPart)
		}
		if s2 == 0 {
			s2 = uint32(ld.Sector2TimeMinPart)*60000 + uint32(ld.Sector2TimeMSPart)
		}
		var at float32
		if r.id.Time != nil {
			at = float32(*r.id.Time)
		}
		frames = append(frames, parsedLapFrame{identity: r.id, distance: bounded(r.car.Distance, 0, math.MaxFloat64), elapsed: wholeBounded(r.car.Elapsed, 0, math.MaxUint32), recordedAt: r.id.recorded, currentLapTimeMs: ld.CurrentLapTimeInMS, playerIndex: *r.id.Player, sessionTime: at, lapNum: ld.CurrentLapNum, lapTimeMs: ld.LastLapTimeInMS, sector1Ms: s1, sector2Ms: s2, lapDist: ld.LapDistance, invalid: ld.CurrentLapInvalid != 0, sector: ld.Sector})
		return nil
	})
	return frames, err
}
func bounded(v *float64, lo, hi float64) *float64 {
	if v == nil || math.IsNaN(*v) || math.IsInf(*v, 0) || *v < lo || *v > hi {
		return nil
	}
	return v
}
func sameUID(a, b captureIdentity) bool { return a.UID == nil || b.UID == nil || *a.UID == *b.UID }
func samePlayer(a, b captureIdentity) bool {
	return a.Player != nil && b.Player != nil && *a.Player == *b.Player && sameUID(a, b)
}

// Recording-wide identity facts are immutable and shared by every completed lap.
// Per-attempt matchers index only their own ordinal range.
type lapRecordingIndex struct {
	overall     bool
	capture     bool
	legacy      bool
	frameCounts map[uint32]int
}

func indexLapRecording(frames []parsedLapFrame) *lapRecordingIndex {
	index := &lapRecordingIndex{overall: true, capture: true, legacy: true, frameCounts: make(map[uint32]int, len(frames))}
	for i, f := range frames {
		if f.identity.Frame != nil {
			index.frameCounts[*f.identity.Frame]++
		}
		if f.identity.Overall == nil || *f.identity.Overall == 0 {
			index.overall = false
		} else if i > 0 && frames[i-1].identity.Overall != nil && *f.identity.Overall <= *frames[i-1].identity.Overall {
			index.overall = false
		}
		if f.recordedAt.IsZero() || (i > 0 && f.recordedAt.Before(frames[i-1].recordedAt)) {
			index.capture = false
		}
		if i > 0 {
			prev := frames[i-1]
			if !samePlayer(prev.identity, f.identity) || lapRewound(f, prev) || (f.identity.Frame != nil && prev.identity.Frame != nil && *f.identity.Frame <= *prev.identity.Frame) {
				index.legacy = false
			}
		}
	}
	return index
}

type attemptMatcher struct {
	frames       []parsedLapFrame
	lap          LapSummary
	recording    *lapRecordingIndex
	overall      bool
	capture      bool
	legacy       bool
	overallIndex map[uint32]int
	frameIndex   map[uint32]int
}

func newAttemptMatcher(frames []parsedLapFrame, lap LapSummary, recording *lapRecordingIndex) *attemptMatcher {
	count := lap.endOrdinal - lap.startOrdinal
	m := &attemptMatcher{frames: frames, lap: lap, recording: recording, overall: recording.overall, capture: recording.capture, legacy: recording.legacy, overallIndex: make(map[uint32]int, count), frameIndex: make(map[uint32]int, count)}
	for i := lap.startOrdinal; i < lap.endOrdinal; i++ {
		f := frames[i]
		if f.identity.Overall != nil {
			m.overallIndex[*f.identity.Overall] = i
		}
		if f.identity.Frame != nil {
			m.frameIndex[*f.identity.Frame] = i
		}
	}
	start, end := frames[lap.startOrdinal], frames[lap.endOrdinal]
	if !start.recordedAt.Before(end.recordedAt) {
		m.capture = false
	}
	// A capture timestamp shared with the abandoned attempt cannot identify its edge.
	if lap.startOrdinal > 0 && !frames[lap.startOrdinal-1].recordedAt.Before(start.recordedAt) {
		m.capture = false
	}
	return m
}

func (m *attemptMatcher) usable() bool { return m.overall || m.capture || m.legacy }
func (m *attemptMatcher) identify(id captureIdentity) (string, bool) {
	start, end := m.frames[m.lap.startOrdinal].identity, m.frames[m.lap.endOrdinal].identity
	if !samePlayer(id, start) {
		return "", false
	}
	if m.overall && id.Overall != nil && *id.Overall > 0 {
		return "overallFrame", *id.Overall >= *start.Overall && *id.Overall < *end.Overall
	}
	if m.capture && !id.recorded.IsZero() && id.Time != nil {
		// End is exclusive; equal capture times at the restart edge are ambiguous.
		if !id.recorded.Before(start.recorded) && id.recorded.Before(end.recorded) {
			return "captureTime", true
		}
		return "", false
	}
	if m.legacy && id.Frame != nil && m.recording.frameCounts[*id.Frame] == 1 {
		_, ok := m.frameIndex[*id.Frame]
		return "frame", ok
	}
	return "", false
}
func (m *attemptMatcher) anchor(id captureIdentity, method string) int {
	index := -1
	if method == "overallFrame" && id.Overall != nil {
		if i, ok := m.overallIndex[*id.Overall]; ok {
			index = i
		}
	}
	if method == "frame" && id.Frame != nil {
		if i, ok := m.frameIndex[*id.Frame]; ok {
			index = i
		}
	}
	if method == "captureTime" && id.Time != nil {
		for i := m.lap.startOrdinal; i < m.lap.endOrdinal; i++ {
			f := m.frames[i]
			if f.identity.Time != nil && *f.identity.Time == *id.Time && samePlayer(id, f.identity) {
				if index >= 0 {
					return -1
				}
				index = i
			}
		}
	}
	return index
}
func median(values []float64) *float64 {
	if len(values) == 0 {
		return nil
	}
	sort.Float64s(values)
	n := len(values)
	if n%2 == 1 {
		return float64Ptr(values[n/2])
	}
	return float64Ptr((values[n/2-1] + values[n/2]) / 2)
}

func lapRewound(current, previous parsedLapFrame) bool {
	return (current.identity.Time != nil && previous.identity.Time != nil && *current.identity.Time < *previous.identity.Time) || current.lapNum < previous.lapNum ||
		(current.lapNum == previous.lapNum && ((current.distance != nil && previous.distance != nil && *current.distance < *previous.distance-50) || (current.elapsed != nil && previous.elapsed != nil && *current.elapsed < *previous.elapsed)))
}

// Reliability belongs to the recording, not to a guessed stream generation.
// Repeated ordinary frames remain candidates, while an all-zero or rewinding
// overall counter cannot establish identity for that source.
type sourceIdentityInfo struct {
	overall     bool
	frameCounts map[uint32]int
}

func inspectSourceIdentity(ctx context.Context, path string, size int64, countFrames bool) (sourceIdentityInfo, error) {
	info := sourceIdentityInfo{overall: true, frameCounts: map[uint32]int{}}
	var previous *uint32
	stream := filepath.Base(path)
	stream = stream[:len(stream)-len(".jsonl")]
	err := scanSnapshot(ctx, path, size, func(line []byte) error {
		r, ok := decodeNative(line, stream)
		if !ok {
			return nil
		}
		if r.id.Overall == nil || *r.id.Overall == 0 || (previous != nil && *r.id.Overall <= *previous) {
			info.overall = false
		}
		previous = r.id.Overall
		if countFrames && r.id.Frame != nil {
			info.frameCounts[*r.id.Frame]++
		}
		return nil
	})
	return info, err
}
func (s sourceIdentityInfo) identify(m *attemptMatcher, id captureIdentity) (string, bool) {
	if !s.overall {
		id.Overall = nil
	}
	method, ok := m.identify(id)
	if method == "frame" && (id.Frame == nil || s.frameCounts[*id.Frame] != 1) {
		return "", false
	}
	return method, ok
}

func wholeBounded(value *float64, low, high float64) *float64 {
	value = bounded(value, low, high)
	if value != nil && math.Trunc(*value) != *value {
		return nil
	}
	return value
}

// Decode malformed optional channels independently, retaining the captured row.
func (c *nativeCar) UnmarshalJSON(data []byte) error {
	type plain nativeCar
	if err := json.Unmarshal(data, (*plain)(c)); err == nil {
		return nil
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	for _, field := range []struct {
		name  string
		value **float64
	}{
		{"LapDistance", &c.Distance}, {"CurrentLapTimeInMS", &c.Elapsed}, {"Speed", &c.Speed}, {"Throttle", &c.Throttle}, {"Brake", &c.Brake}, {"Steer", &c.Steer}, {"Gear", &c.Gear}, {"EngineRPM", &c.RPM}, {"WorldPositionX", &c.X}, {"WorldPositionZ", &c.Z}, {"FuelInTank", &c.Fuel}, {"ERSStoreEnergy", &c.ERS},
	} {
		*field.value = nil
		var value float64
		if raw, ok := fields[field.name]; ok && string(raw) != "null" && json.Unmarshal(raw, &value) == nil {
			*field.value = &value
		}
	}
	return nil
}
