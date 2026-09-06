package races

import (
	"encoding/json"
	"sort"

	"frc.engineer/internal/dto"
)

// MergeAdoptedSummary folds capture data from a previously persisted summary of
// the SAME session (prev) into a freshly built one (next), in place on next.
// Used when the sender restarts mid-session and re-adopts the session's file:
// laps are retroactive (full session history), but dynamics/events/incidents
// only exist from each run's attach point, so overwriting would discard what
// the previous run measured.
//
// Rules: dynamics union by lap number (prev wins — its laps were observed live,
// the new run has nothing for them); events union deduped by (timestamp,
// message); CaptureStartLap = min of the non-zero values. V2 additionally
// unions the private eligible ledger before deduplicating/capping visible clips.
func MergeAdoptedSummary(prev, next *RaceSummary) {
	if prev == nil || next == nil {
		return
	}
	if prev.Detail != nil && next.Detail == nil {
		// Next run observed nothing rich yet — carry the previous detail whole.
		d := *prev.Detail
		next.Detail = &d
	} else if prev.Detail != nil && next.Detail != nil {
		mergeDynamics(prev.Detail, next.Detail)
		mergeEvents(prev.Detail, next.Detail)
		// The TrackStore may be unavailable during the first resumed snapshot.
		// Keep an already captured real centreline instead of turning it into an
		// unavailable outline merely because this process has not loaded it yet.
		if next.Detail.TrackOutline == nil && prev.Detail.TrackOutline != nil {
			next.Detail.TrackOutline = cloneTrackOutline(prev.Detail.TrackOutline)
		}
		if prev.Detail.CaptureStartLap > 0 &&
			(next.Detail.CaptureStartLap == 0 || prev.Detail.CaptureStartLap < next.Detail.CaptureStartLap) {
			next.Detail.CaptureStartLap = prev.Detail.CaptureStartLap
		}
	}
	mergeDebrief(prev, next)
	mergeReplay(prev, next)
	mergePrivateCapture(prev, next)
	mergeIncidents(prev, next)
	RefreshLocalCompleteness(next)
}

// mergeDebrief preserves a previously measured pit pair when a restarted
// process has recovered the stop count but has not yet observed a new complete
// measurement. The lane/stationary pair is indivisible on the v2 wire: copying
// one without the other would fail ingest and would misrepresent the fact.
func mergeDebrief(prev, next *RaceSummary) {
	if prev == nil || prev.Debrief == nil || next == nil {
		return
	}
	if next.Debrief == nil {
		copyDebrief := *prev.Debrief
		next.Debrief = &copyDebrief
		return
	}
	// Read the original provenance before mergePrivateCapture ORs its flags.
	// An observed zero is a value; only missing observation groups are restored.
	var oldFacts, newFacts dto.RaceCaptureProvenance
	if prev.PrivateCapture != nil {
		oldFacts = prev.PrivateCapture.Provenance
	}
	if next.PrivateCapture != nil {
		newFacts = next.PrivateCapture.Provenance
	}
	oldTyres, newTyres := prev.Debrief.Tyres, &next.Debrief.Tyres
	if oldFacts.CarStatusObserved && !newFacts.CarStatusObserved {
		newTyres.FinalCompound, newTyres.FinalAge = oldTyres.FinalCompound, oldTyres.FinalAge
	}
	if oldFacts.CarDamageObserved && !newFacts.CarDamageObserved {
		newTyres.AverageWearPct, newTyres.PeakWearPct = oldTyres.AverageWearPct, oldTyres.PeakWearPct
	}
	if oldFacts.TyreSetsObserved && !newFacts.TyreSetsObserved {
		newTyres.FinalSetWearPct, newTyres.LifeSpan = oldTyres.FinalSetWearPct, oldTyres.LifeSpan
		newTyres.UsableLife, newTyres.LifeRemainingPct = oldTyres.UsableLife, oldTyres.LifeRemainingPct
	}
	if oldFacts.LapDataObserved && !newFacts.LapDataObserved {
		next.Debrief.Penalties = prev.Debrief.Penalties
	}
	oldPit, newPit := prev.Debrief.Pit, &next.Debrief.Pit
	if newPit.Stops < oldPit.Stops {
		newPit.Stops = oldPit.Stops
	}
	if newPit.Stops > 0 && newPit.PitLaneTimeMS == 0 && newPit.StationaryTimeMS == 0 &&
		oldPit.PitLaneTimeMS > 0 && oldPit.StationaryTimeMS <= oldPit.PitLaneTimeMS {
		newPit.PitLaneTimeMS = oldPit.PitLaneTimeMS
		newPit.StationaryTimeMS = oldPit.StationaryTimeMS
	}
}

func mergeReplay(prev, next *RaceSummary) {
	if prev.Replay == nil {
		return
	}
	if next.Replay == nil {
		copyReplay := *prev.Replay
		copyReplay.Frames = append([]ReplayFrame(nil), prev.Replay.Frames...)
		next.Replay = &copyReplay
		return
	}
	old, current := prev.Replay, next.Replay
	if current.TrackMap == nil {
		current.TrackMap = old.TrackMap
	}
	if current.Session == nil {
		current.Session = old.Session
	}
	if current.FrameIntervalMS <= 0 {
		current.FrameIntervalMS = old.FrameIntervalMS
	}
	// Frame timestamps are capture wall-clock milliseconds, not session time
	// (which can rewind). The new snapshot wins an overlapping checkpoint.
	frames := make(map[int64]ReplayFrame, len(old.Frames)+len(current.Frames))
	for _, frame := range old.Frames {
		frames[frame.Timestamp] = frame
	}
	for _, frame := range current.Frames {
		frames[frame.Timestamp] = frame
	}
	merged := make([]ReplayFrame, 0, len(frames))
	for _, frame := range frames {
		merged = append(merged, frame)
	}
	sort.Slice(merged, func(i, j int) bool { return merged[i].Timestamp < merged[j].Timestamp })
	current.Frames = merged
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

func mergePrivateCapture(prev, next *RaceSummary) {
	if prev.PrivateCapture == nil && next.PrivateCapture == nil {
		return
	}
	merged := dto.RacePrivateCapture{}
	sameRun := prev.PrivateCapture != nil && next.PrivateCapture != nil &&
		prev.PrivateCapture.RunID != "" && prev.PrivateCapture.RunID == next.PrivateCapture.RunID
	if prev.PrivateCapture != nil {
		merged.RunID = prev.PrivateCapture.RunID
		merged.Provenance = prev.PrivateCapture.Provenance
	}
	if next.PrivateCapture != nil {
		if next.PrivateCapture.RunID != "" {
			merged.RunID = next.PrivateCapture.RunID
		}
		merged.Provenance = mergeProvenance(merged.Provenance, next.PrivateCapture.Provenance, sameRun)
	}
	keys := make(map[string]dto.IncidentCaptureKey)
	for _, capture := range []*dto.RacePrivateCapture{prev.PrivateCapture, next.PrivateCapture} {
		if capture == nil {
			continue
		}
		for _, key := range capture.EligibleIncidentKeys {
			normalized := normalizedIncidentKey(key)
			keys[incidentKeyString(normalized)] = normalized
		}
	}
	merged.EligibleIncidentKeys = make([]dto.IncidentCaptureKey, 0, len(keys))
	for _, key := range keys {
		merged.EligibleIncidentKeys = append(merged.EligibleIncidentKeys, key)
	}
	sort.Slice(merged.EligibleIncidentKeys, func(i, j int) bool {
		left, right := merged.EligibleIncidentKeys[i], merged.EligibleIncidentKeys[j]
		if left.SessionTimeMS != right.SessionTimeMS {
			return left.SessionTimeMS < right.SessionTimeMS
		}
		return incidentKeyString(left) < incidentKeyString(right)
	})
	next.PrivateCapture = &merged
}

func mergeProvenance(left, right dto.RaceCaptureProvenance, sameRun bool) dto.RaceCaptureProvenance {
	left.LapDataObserved = left.LapDataObserved || right.LapDataObserved
	left.SessionHistoryObserved = left.SessionHistoryObserved || right.SessionHistoryObserved
	left.CarStatusObserved = left.CarStatusObserved || right.CarStatusObserved
	left.CarDamageObserved = left.CarDamageObserved || right.CarDamageObserved
	left.TyreSetsObserved = left.TyreSetsObserved || right.TyreSetsObserved
	left.PitMeasurementObserved = left.PitMeasurementObserved || right.PitMeasurementObserved
	left.EventsCaptureActive = left.EventsCaptureActive || right.EventsCaptureActive
	left.IncidentsCaptureActive = left.IncidentsCaptureActive || right.IncidentsCaptureActive
	left.IncidentClipLimitReached = left.IncidentClipLimitReached || right.IncidentClipLimitReached
	// Finalization describes the newest saved snapshot, not a historical OR. A
	// normal SEND after checkpoints must clear checkpoint-finalize.
	if right.CheckpointFinalize || right.NormalFinalize {
		left.CheckpointFinalize = right.CheckpointFinalize
		left.NormalFinalize = right.NormalFinalize
	}
	if right.TrackOutlineSourcePoints > left.TrackOutlineSourcePoints {
		left.TrackOutlineSourcePoints = right.TrackOutlineSourcePoints
	}
	left.IncidentMergeLimited = left.IncidentMergeLimited || right.IncidentMergeLimited
	if sameRun {
		// A process emits cumulative counters at every checkpoint. Re-adopting
		// its previous on-disk snapshot must be idempotent.
		if right.EventsSeen > left.EventsSeen {
			left.EventsSeen = right.EventsSeen
		}
		if right.EventsBufferDropped > left.EventsBufferDropped {
			left.EventsBufferDropped = right.EventsBufferDropped
		}
	} else {
		// Separate process runs own separate rich-event buffers.
		left.EventsSeen += right.EventsSeen
		left.EventsBufferDropped += right.EventsBufferDropped
	}
	return left
}

func mergeIncidents(prev, next *RaceSummary) {
	all := append(append([]dto.IncidentClip(nil), prev.Incidents...), next.Incidents...)
	if len(all) == 0 {
		return
	}
	unique := make(map[string]dto.IncidentClip, len(all))
	for _, clip := range all {
		key := incidentIdentity(clip)
		if _, exists := unique[key]; !exists {
			unique[key] = clip
		}
	}
	merged := make([]dto.IncidentClip, 0, len(unique))
	for _, clip := range unique {
		merged = append(merged, clip)
	}
	sort.SliceStable(merged, func(i, j int) bool {
		if merged[i].SessionTimeMS != merged[j].SessionTimeMS {
			return merged[i].SessionTimeMS < merged[j].SessionTimeMS
		}
		return incidentIdentity(merged[i]) < incidentIdentity(merged[j])
	})
	mergeLimited := len(merged) > incidentStoredCap
	if mergeLimited {
		merged = merged[:incidentStoredCap]
		if next.PrivateCapture == nil {
			next.PrivateCapture = &dto.RacePrivateCapture{}
		}
		next.PrivateCapture.Provenance.IncidentMergeLimited = true
	}
	next.Incidents = merged
	if mergeLimited && next.Detail != nil && next.Detail.Completeness != nil {
		section := &next.Detail.Completeness.Sections.Incidents
		section.Reasons = appendReason(section.Reasons, dto.ReasonIncidentMergeLimit)
		section.Status = dto.AvailabilityPartial
	}
}

func incidentIdentity(clip dto.IncidentClip) string {
	return incidentKeyString(normalizedIncidentKey(dto.IncidentCaptureKey{
		SessionTimeMS: clip.SessionTimeMS,
		Collisions:    clip.Collisions,
	}))
}

func normalizedIncidentKey(key dto.IncidentCaptureKey) dto.IncidentCaptureKey {
	key.Collisions = append([][2]int(nil), key.Collisions...)
	for i := range key.Collisions {
		if key.Collisions[i][1] < key.Collisions[i][0] {
			key.Collisions[i][0], key.Collisions[i][1] = key.Collisions[i][1], key.Collisions[i][0]
		}
	}
	sort.Slice(key.Collisions, func(i, j int) bool {
		if key.Collisions[i][0] != key.Collisions[j][0] {
			return key.Collisions[i][0] < key.Collisions[j][0]
		}
		return key.Collisions[i][1] < key.Collisions[j][1]
	})
	unique := key.Collisions[:0]
	for _, pair := range key.Collisions {
		if len(unique) > 0 && unique[len(unique)-1] == pair {
			continue
		}
		unique = append(unique, pair)
	}
	key.Collisions = unique
	return key
}

func incidentKeyString(key dto.IncidentCaptureKey) string {
	encoded, _ := json.Marshal(key)
	return string(encoded)
}
