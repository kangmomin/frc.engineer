package races

import "sort"

// MergeAdoptedSummary folds capture data from a previously persisted summary of
// the SAME session (prev) into a freshly built one (next), in place on next.
// Used when the sender restarts mid-session and re-adopts the session's file:
// laps are retroactive (full session history), but dynamics/events/incidents
// only exist from each run's attach point, so overwriting would discard what
// the previous run measured.
//
// Rules: dynamics union by lap number (prev wins — its laps were observed live,
// the new run has nothing for them); events union deduped by (timestamp,
// message); CaptureStartLap = min of the non-zero values; incidents kept from
// prev only when the new run captured none. Laps/setup/trigger stay next's.
func MergeAdoptedSummary(prev, next *RaceSummary) {
	if prev == nil || next == nil || prev.Detail == nil {
		return
	}
	if next.Detail == nil {
		// Next run observed nothing rich yet — carry the previous detail whole.
		d := *prev.Detail
		next.Detail = &d
	} else {
		mergeDynamics(prev.Detail, next.Detail)
		mergeEvents(prev.Detail, next.Detail)
		if prev.Detail.CaptureStartLap > 0 &&
			(next.Detail.CaptureStartLap == 0 || prev.Detail.CaptureStartLap < next.Detail.CaptureStartLap) {
			next.Detail.CaptureStartLap = prev.Detail.CaptureStartLap
		}
	}
	if len(next.Incidents) == 0 && len(prev.Incidents) > 0 {
		next.Incidents = prev.Incidents
	}
}

func mergeDynamics(prev, next *RaceDetail) {
	if len(prev.Dynamics) == 0 {
		return
	}
	seen := make(map[int]struct{}, len(next.Dynamics))
	for _, d := range next.Dynamics {
		seen[d.LapNum] = struct{}{}
	}
	merged := next.Dynamics
	for _, d := range prev.Dynamics {
		if _, dup := seen[d.LapNum]; !dup {
			merged = append(merged, d)
		}
	}
	sort.Slice(merged, func(i, j int) bool { return merged[i].LapNum < merged[j].LapNum })
	next.Dynamics = merged
}

func mergeEvents(prev, next *RaceDetail) {
	if len(prev.Events) == 0 {
		return
	}
	type key struct {
		ts  int64
		msg string
	}
	seen := make(map[key]struct{}, len(next.Events))
	for _, e := range next.Events {
		seen[key{e.Timestamp, e.Message}] = struct{}{}
	}
	merged := next.Events
	for _, e := range prev.Events {
		if _, dup := seen[key{e.Timestamp, e.Message}]; !dup {
			merged = append(merged, e)
		}
	}
	sort.Slice(merged, func(i, j int) bool { return merged[i].Timestamp < merged[j].Timestamp })
	next.Events = merged
}
