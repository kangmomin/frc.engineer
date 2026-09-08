package analysis

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
)

const MaxTraceSamples = 60000
const MaxTraceBytes = 16 * 1024 * 1024

// [Assumption] Only timing anchors at most 100 ms apart support interpolation.
const MaxInterpolationGapMs = 100.0

type TraceExtent struct {
	FromM float64 `json:"fromM"`
	ToM   float64 `json:"toM"`
}
type TraceError struct {
	Code       string       `json:"code"`
	Message    string       `json:"message"`
	Extent     *TraceExtent `json:"extent,omitempty"`
	MaxSamples int          `json:"maxSamples,omitempty"`
	MaxBytes   int          `json:"maxBytes,omitempty"`
}

func (e *TraceError) Error() string { return e.Message }
func tooLarge() error {
	return &TraceError{Code: "trace_too_large", Message: "Select a smaller distance window.", MaxSamples: MaxTraceSamples, MaxBytes: MaxTraceBytes}
}

type SamplePosition struct {
	DistanceM     *float64 `json:"distanceM"`
	SessionTimeMs *float64 `json:"sessionTimeMs"`
	Segment       *int     `json:"segment"`
	Alignment     string   `json:"alignment"`
}
type TimingSample struct {
	SamplePosition
	ElapsedMs *float64 `json:"elapsedMs"`
}
type ControlSample struct {
	SamplePosition
	SpeedKph *float64 `json:"speedKph"`
	Throttle *float64 `json:"throttle"`
	Brake    *float64 `json:"brake"`
	Steer    *float64 `json:"steer"`
	Gear     *float64 `json:"gear"`
	RPM      *float64 `json:"rpm"`
}
type MotionSample struct {
	SamplePosition
	XM *float64 `json:"xM"`
	ZM *float64 `json:"zM"`
}
type StatusSample struct {
	SamplePosition
	FuelKg *float64 `json:"fuelKg"`
	ERSJ   *float64 `json:"ersJ"`
}
type StreamQuality struct {
	Available        bool     `json:"available"`
	CapturedSamples  int      `json:"capturedSamples"`
	ReturnedSamples  int      `json:"returnedSamples"`
	AlignedSamples   int      `json:"alignedSamples"`
	Method           string   `json:"method"`
	MedianIntervalMs *float64 `json:"medianIntervalMs"`
	MaxSkewMs        *float64 `json:"maxSkewMs"`
	MaxSkewFrames    *float64 `json:"maxSkewFrames"`
}
type SelectedLapTrace struct {
	LapNum       int          `json:"lapNum"`
	AttemptID    string       `json:"attemptId"`
	PlayerIndex  int          `json:"playerIndex"`
	Valid        bool         `json:"valid"`
	TrackID      *int         `json:"trackId"`
	PacketFormat *int         `json:"packetFormat"`
	GameYear     *int         `json:"gameYear"`
	TrackLengthM *float64     `json:"trackLengthM"`
	Extent       *TraceExtent `json:"extent"`
	Window       *TraceExtent `json:"window"`
	Finish       struct {
		DistanceM *float64 `json:"distanceM"`
		ElapsedMs uint32   `json:"elapsedMs"`
		Source    string   `json:"source"`
	} `json:"finish"`
	Timing   []TimingSample  `json:"timing"`
	Controls []ControlSample `json:"controls"`
	Motion   []MotionSample  `json:"motion"`
	Status   []StatusSample  `json:"status"`
	Quality  struct {
		Timing                StreamQuality `json:"timing"`
		Controls              StreamQuality `json:"controls"`
		Motion                StreamQuality `json:"motion"`
		Status                StreamQuality `json:"status"`
		MaxInterpolationGapMs float64       `json:"maxInterpolationGapMs"`
	} `json:"quality"`
}

func emptyQuality() StreamQuality { return StreamQuality{Method: "none"} }
func sessionMS(id captureIdentity) *float64 {
	if id.Time == nil {
		return nil
	}
	return float64Ptr(*id.Time * 1000)
}
func inWindow(p SamplePosition, window *TraceExtent) bool {
	return window == nil || (p.DistanceM != nil && *p.DistanceM >= window.FromM && *p.DistanceM <= window.ToM)
}

type streamStats struct {
	previous  *float64
	intervals []float64
}

func (s *streamStats) observe(q *StreamQuality, id captureIdentity) {
	q.CapturedSamples++
	q.Available = true
	now := sessionMS(id)
	if now != nil && s.previous != nil && *now > *s.previous {
		s.intervals = append(s.intervals, *now-*s.previous)
	}
	s.previous = now
}
func maxValue(dst **float64, v float64) {
	if *dst == nil || v > **dst {
		*dst = float64Ptr(v)
	}
}
func recordQuality(q *StreamQuality, p SamplePosition, method string, id, anchor captureIdentity) {
	q.ReturnedSamples++
	if q.Method == "none" {
		q.Method = method
	} else if q.Method != method {
		q.Method = "mixed"
	}
	if p.DistanceM == nil {
		return
	}
	q.AlignedSamples++
	if id.Time != nil && anchor.Time != nil {
		maxValue(&q.MaxSkewMs, math.Abs(*id.Time-*anchor.Time)*1000)
	}
	if method == "overallFrame" && id.Overall != nil && anchor.Overall != nil {
		maxValue(&q.MaxSkewFrames, math.Abs(float64(*id.Overall)-float64(*anchor.Overall)))
	} else if method == "frame" && id.Frame != nil && anchor.Frame != nil {
		maxValue(&q.MaxSkewFrames, math.Abs(float64(*id.Frame)-float64(*anchor.Frame)))
	}
}

type segmentTracker struct {
	previous *SamplePosition
	next     int
}

func (s *segmentTracker) assign(p *SamplePosition, timing bool, elapsed, prevElapsed *float64) {
	if p.DistanceM == nil {
		s.previous = nil
		p.Segment = nil
		return
	}
	continuous := false
	if old := s.previous; old != nil && old.DistanceM != nil && old.SessionTimeMs != nil && p.SessionTimeMs != nil {
		dt := *p.SessionTimeMs - *old.SessionTimeMs
		dd := *p.DistanceM - *old.DistanceM
		continuous = dt > 0 && dt <= MaxInterpolationGapMs+0.001 && dd >= 0
		if timing {
			continuous = continuous && dd > 0 && elapsed != nil && prevElapsed != nil && *elapsed > *prevElapsed
		}
	}
	if !continuous {
		s.next++
	}
	segment := s.next
	p.Segment = &segment
	copy := *p
	s.previous = &copy
}

type traceAligner struct {
	matcher      *attemptMatcher
	timing       []TimingSample
	clockIndices []int
}

func (a *traceAligner) align(id captureIdentity, method string) (SamplePosition, captureIdentity) {
	p := SamplePosition{SessionTimeMs: sessionMS(id), Alignment: "unavailable"}
	if i := a.matcher.anchor(id, method); i >= 0 {
		t := a.timing[i-a.matcher.lap.startOrdinal]
		p.DistanceM = t.DistanceM
		if p.DistanceM != nil {
			p.Alignment = "exact"
		}
		return p, a.matcher.frames[i].identity
	}
	if p.SessionTimeMs == nil {
		return p, captureIdentity{}
	}
	n := sort.Search(len(a.clockIndices), func(k int) bool { return *a.timing[a.clockIndices[k]].SessionTimeMs >= *p.SessionTimeMs })
	if n == 0 || n >= len(a.clockIndices) {
		return p, captureIdentity{}
	}
	li, ri := a.clockIndices[n-1], a.clockIndices[n]
	l, r := a.timing[li], a.timing[ri]
	if ri != li+1 || l.DistanceM == nil || r.DistanceM == nil || l.Segment == nil || r.Segment == nil || *l.Segment != *r.Segment || *r.SessionTimeMs <= *l.SessionTimeMs || *r.SessionTimeMs-*l.SessionTimeMs > MaxInterpolationGapMs+0.001 {
		return p, captureIdentity{}
	}
	f := (*p.SessionTimeMs - *l.SessionTimeMs) / (*r.SessionTimeMs - *l.SessionTimeMs)
	p.DistanceM = float64Ptr(*l.DistanceM + f*(*r.DistanceM-*l.DistanceM))
	p.Alignment = "interpolated"
	nearest := li
	if f > 0.5 {
		nearest = ri
	}
	return p, a.matcher.frames[a.matcher.lap.startOrdinal+nearest].identity
}

// ReadSelectedLapTrace returns each source at its native cadence; it never downsamples.
func ReadSelectedLapTrace(ctx context.Context, dir string, lapNum int, window *TraceExtent) (*SelectedLapTrace, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if lapNum < 1 || lapNum > 255 || window != nil && (math.IsNaN(window.FromM) || math.IsNaN(window.ToM) || math.IsInf(window.FromM, 0) || math.IsInf(window.ToM, 0) || window.FromM < 0 || window.ToM <= window.FromM) {
		return nil, &TraceError{Code: "invalid_query", Message: "Invalid lap or distance window."}
	}
	sizes := map[string]int64{}
	for _, name := range []string{"lap_data", "telemetry", "motion", "car_status", "session"} {
		st, err := os.Stat(filepath.Join(dir, name+".jsonl"))
		if err != nil {
			if errors.Is(err, os.ErrNotExist) && name != "lap_data" {
				continue
			}
			return nil, err
		}
		if !st.Mode().IsRegular() {
			return nil, fmt.Errorf("packet input is not a regular file")
		}
		sizes[name] = st.Size()
	}
	frames, err := readLapTimeline(ctx, dir, sizes["lap_data"])
	if err != nil {
		return nil, err
	}
	var lap *LapSummary
	for _, candidate := range summarizeLapFrames(frames) {
		if candidate.LapNum == lapNum {
			copy := candidate
			lap = &copy
		}
	}
	if lap == nil {
		return nil, &TraceError{Code: "not_found", Message: "Completed lap not found."}
	}
	if window == nil && lap.endOrdinal-lap.startOrdinal > MaxTraceSamples {
		return nil, tooLarge()
	}
	matcher := newAttemptMatcher(frames, *lap, indexLapRecording(frames))
	if !matcher.usable() {
		return nil, &TraceError{Code: "trace_unavailable", Message: "The completed attempt cannot be safely identified."}
	}
	trace := &SelectedLapTrace{LapNum: lapNum, PlayerIndex: lap.playerIndex, Valid: lap.Valid, Window: window, Timing: []TimingSample{}, Controls: []ControlSample{}, Motion: []MotionSample{}, Status: []StatusSample{}}
	trace.Quality.Timing = emptyQuality()
	trace.Quality.Controls = emptyQuality()
	trace.Quality.Motion = emptyQuality()
	trace.Quality.Status = emptyQuality()
	trace.Quality.MaxInterpolationGapMs = MaxInterpolationGapMs
	first := frames[lap.startOrdinal].identity
	trace.PacketFormat = first.Format
	trace.GameYear = first.Year
	fingerprint := fmt.Sprintf("%d/%d/%d/%v/%v/%s", lapNum, lap.startOrdinal, lap.endOrdinal, lap.playerIndex, first.UID, first.recorded.String())
	// Dereference optional identity values: pointer addresses must never enter IDs.
	if first.UID != nil {
		fingerprint = fmt.Sprintf("%d/%d/%d/%d/%d/%s", lapNum, lap.startOrdinal, lap.endOrdinal, lap.playerIndex, *first.UID, first.recorded.String())
	}
	trace.AttemptID = fmt.Sprintf("%x", sha256.Sum256([]byte(fingerprint)))[:24]
	if size, ok := sizes["session"]; ok {
		found := false
		err = scanSnapshot(ctx, filepath.Join(dir, "session.jsonl"), size, func(line []byte) error {
			if found {
				return nil
			}
			var env struct{ Data json.RawMessage }
			var meta struct {
				Header      captureIdentity
				TrackID     *int
				TrackLength *float64
			}
			if json.Unmarshal(line, &env) != nil || json.Unmarshal(env.Data, &meta) != nil {
				return nil
			}
			if !sameUID(first, meta.Header) {
				return nil
			}
			found = true
			if meta.TrackID != nil && *meta.TrackID >= 0 {
				trace.TrackID = meta.TrackID
			}
			trace.TrackLengthM = bounded(meta.TrackLength, 1, math.MaxFloat64)
			if trace.PacketFormat == nil {
				trace.PacketFormat = meta.Header.Format
			}
			if trace.GameYear == nil {
				trace.GameYear = meta.Header.Year
			}
			return nil
		})
		if err != nil {
			return nil, err
		}
	}
	if trace.PacketFormat != nil && *trace.PacketFormat <= 0 {
		trace.PacketFormat = nil
	}
	if trace.GameYear != nil && (*trace.GameYear <= 0 || *trace.GameYear > 99) {
		trace.GameYear = nil
	}
	trace.Finish.DistanceM = trace.TrackLengthM
	trace.Finish.ElapsedMs = lap.LapTimeMs
	trace.Finish.Source = "lastLapTime"
	aligner := traceAligner{matcher: matcher}
	var timingSegments segmentTracker
	var previousElapsed *float64
	for i := lap.startOrdinal; i < lap.endOrdinal; i++ {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		fr := frames[i]
		p := SamplePosition{DistanceM: fr.distance, SessionTimeMs: sessionMS(fr.identity), Alignment: "unavailable"}
		if p.DistanceM != nil {
			p.Alignment = "exact"
		}
		timingSegments.assign(&p, true, fr.elapsed, previousElapsed)
		previousElapsed = fr.elapsed
		aligner.timing = append(aligner.timing, TimingSample{SamplePosition: p, ElapsedMs: fr.elapsed})
		if p.SessionTimeMs != nil {
			aligner.clockIndices = append(aligner.clockIndices, i-lap.startOrdinal)
		}
		if p.DistanceM != nil {
			if trace.Extent == nil {
				trace.Extent = &TraceExtent{*p.DistanceM, *p.DistanceM}
			} else {
				trace.Extent.FromM = math.Min(trace.Extent.FromM, *p.DistanceM)
				trace.Extent.ToM = math.Max(trace.Extent.ToM, *p.DistanceM)
			}
		}
	}
	sort.SliceStable(aligner.clockIndices, func(i, j int) bool {
		return *aligner.timing[aligner.clockIndices[i]].SessionTimeMs < *aligner.timing[aligner.clockIndices[j]].SessionTimeMs
	})
	if trace.TrackLengthM != nil {
		trace.Extent = &TraceExtent{0, *trace.TrackLengthM}
	}
	if window != nil && (trace.Extent == nil || window.FromM < trace.Extent.FromM || window.ToM > trace.Extent.ToM) {
		return nil, &TraceError{Code: "invalid_query", Message: "Distance window is outside the recorded extent.", Extent: trace.Extent}
	}
	rows, bytes := 0, 0
	reserve := func(v any) error {
		if rows >= MaxTraceSamples {
			return tooLarge()
		}
		b, err := json.Marshal(v)
		if err != nil {
			return err
		}
		bytes += len(b)
		if bytes > MaxTraceBytes {
			return tooLarge()
		}
		rows++
		return nil
	}
	var timingStats streamStats
	for i, t := range aligner.timing {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		id := frames[i+lap.startOrdinal].identity
		timingStats.observe(&trace.Quality.Timing, id)
		if !inWindow(t.SamplePosition, window) {
			continue
		}
		if err := reserve(t); err != nil {
			return nil, err
		}
		trace.Timing = append(trace.Timing, t)
		method, _ := matcher.identify(id)
		if method == "" {
			method = "frame"
		}
		recordQuality(&trace.Quality.Timing, t.SamplePosition, method, id, id)
	}
	trace.Quality.Timing.MedianIntervalMs = median(timingStats.intervals)
	for _, stream := range []string{"telemetry", "motion", "car_status"} {
		size, ok := sizes[stream]
		if !ok {
			continue
		}
		var stats streamStats
		var segments segmentTracker
		identity, err := inspectSourceIdentity(ctx, filepath.Join(dir, stream+".jsonl"), size, matcher.legacy)
		if err != nil {
			return nil, err
		}

		q := &trace.Quality.Controls
		if stream == "motion" {
			q = &trace.Quality.Motion
		}
		if stream == "car_status" {
			q = &trace.Quality.Status
		}
		err = scanSnapshot(ctx, filepath.Join(dir, stream+".jsonl"), size, func(line []byte) error {
			r, ok := decodeNative(line, stream)
			if !ok {
				return nil
			}
			method, ok := identity.identify(matcher, r.id)
			if !ok {
				return nil
			}
			stats.observe(q, r.id)
			p, anchor := aligner.align(r.id, method)
			segments.assign(&p, false, nil, nil)
			if !inWindow(p, window) {
				return nil
			}
			c := r.car
			switch stream {
			case "telemetry":
				gear := bounded(c.Gear, -1, 8)
				if gear != nil && math.Trunc(*gear) != *gear {
					gear = nil
				}
				v := ControlSample{p, bounded(c.Speed, 0, 65535), bounded(c.Throttle, 0, 1), bounded(c.Brake, 0, 1), bounded(c.Steer, -1, 1), gear, bounded(c.RPM, 0, 65535)}
				if err := reserve(v); err != nil {
					return err
				}
				trace.Controls = append(trace.Controls, v)
			case "motion":
				v := MotionSample{p, bounded(c.X, -math.MaxFloat64, math.MaxFloat64), bounded(c.Z, -math.MaxFloat64, math.MaxFloat64)}
				if err := reserve(v); err != nil {
					return err
				}
				trace.Motion = append(trace.Motion, v)
			case "car_status":
				v := StatusSample{p, bounded(c.Fuel, 0, math.MaxFloat64), bounded(c.ERS, 0, math.MaxFloat64)}
				if err := reserve(v); err != nil {
					return err
				}
				trace.Status = append(trace.Status, v)
			}
			recordQuality(q, p, method, r.id, anchor)
			return nil
		})
		if err != nil {
			return nil, err
		}
		q.MedianIntervalMs = median(stats.intervals)
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	encoded, err := json.Marshal(trace)
	if err != nil {
		return nil, err
	}
	if len(encoded)+1 > MaxTraceBytes {
		return nil, tooLarge()
	}
	return trace, nil
}
