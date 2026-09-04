package races

import (
	"testing"

	"frc.engineer/internal/dto"
)

func TestMergeAdoptedSummary(t *testing.T) {
	prev := &RaceSummary{
		Detail: &RaceDetail{
			Dynamics: []dto.DynamicsLapDTO{
				{LapNum: 1, LockupCount: 2},
				{LapNum: 2, LockupCount: 1},
			},
			Events: []dto.RaceControlNotification{
				{Timestamp: 100, Message: "warn A"},
			},
			CaptureStartLap: 1,
		},
		Incidents: []dto.IncidentClip{{SessionTimeMS: 5000}},
	}
	next := &RaceSummary{
		Detail: &RaceDetail{
			Dynamics: []dto.DynamicsLapDTO{
				{LapNum: 3, SpinCount: 1},
			},
			Events: []dto.RaceControlNotification{
				{Timestamp: 100, Message: "warn A"}, // 중복 — dedupe 대상
				{Timestamp: 300, Message: "warn B"},
			},
			CaptureStartLap: 3,
			FinalizeTrigger: "SEND",
		},
	}

	MergeAdoptedSummary(prev, next)

	if got := len(next.Detail.Dynamics); got != 3 {
		t.Fatalf("dynamics len = %d, want 3", got)
	}
	for i, want := range []int{1, 2, 3} {
		if next.Detail.Dynamics[i].LapNum != want {
			t.Fatalf("dynamics[%d].LapNum = %d, want %d (sorted union)", i, next.Detail.Dynamics[i].LapNum, want)
		}
	}
	if got := len(next.Detail.Events); got != 2 {
		t.Fatalf("events len = %d, want 2 (deduped)", got)
	}
	if next.Detail.CaptureStartLap != 1 {
		t.Fatalf("captureStartLap = %d, want 1 (min of non-zero)", next.Detail.CaptureStartLap)
	}
	if next.Detail.FinalizeTrigger != "SEND" {
		t.Fatalf("finalizeTrigger = %q, want SEND (next side wins)", next.Detail.FinalizeTrigger)
	}
	if len(next.Incidents) != 1 || next.Incidents[0].SessionTimeMS != 5000 {
		t.Fatal("prev incidents should carry over when next has none")
	}
}

func TestMergeAdoptedSummaryNilCases(t *testing.T) {
	// prev nil / prev.Detail nil → no-op.
	next := &RaceSummary{Detail: &RaceDetail{CaptureStartLap: 2}}
	MergeAdoptedSummary(nil, next)
	MergeAdoptedSummary(&RaceSummary{}, next)
	if next.Detail.CaptureStartLap != 2 {
		t.Fatal("no-op merges must not mutate next")
	}

	// next.Detail nil → prev detail이 통째로 승계된다.
	prev := &RaceSummary{Detail: &RaceDetail{CaptureStartLap: 1, Dynamics: []dto.DynamicsLapDTO{{LapNum: 1}}}}
	bare := &RaceSummary{}
	MergeAdoptedSummary(prev, bare)
	if bare.Detail == nil || bare.Detail.CaptureStartLap != 1 || len(bare.Detail.Dynamics) != 1 {
		t.Fatal("prev detail should be carried whole when next has none")
	}
}

func TestBuildDetailCarriesCaptureFields(t *testing.T) {
	in := &dto.RaceDetailInput{
		PlayerLaps:      []dto.LapTimingDTO{{LapNumber: 1, LapMs: 90000, Valid: true}},
		CaptureStartLap: 3,
		FinalizeTrigger: "idle-timeout",
	}
	d := buildDetail(in, dto.DriverInfo{}, nil)
	if d == nil {
		t.Fatal("detail should be built")
	}
	if d.CaptureStartLap != 3 || d.FinalizeTrigger != "idle-timeout" {
		t.Fatalf("capture fields = %d/%q, want 3/idle-timeout", d.CaptureStartLap, d.FinalizeTrigger)
	}
}

func TestMergeAdoptedSummaryUnionsEligibleLedgerBeforeVisibleCap(t *testing.T) {
	clip := func(tMS int64, pair [2]int) dto.IncidentClip {
		return dto.IncidentClip{SessionTimeMS: tMS, Collisions: [][2]int{pair}}
	}
	key := func(tMS int64, pair [2]int) dto.IncidentCaptureKey {
		return dto.IncidentCaptureKey{SessionTimeMS: tMS, Collisions: [][2]int{pair}}
	}

	prev := &RaceSummary{
		SchemaVersion: RaceSummarySchemaVersion,
		PrivateCapture: &dto.RacePrivateCapture{RunID: "first-process", Provenance: dto.RaceCaptureProvenance{
			IncidentsCaptureActive: true,
		}},
	}
	for i := 0; i < incidentStoredCap; i++ {
		tMS := int64(1_000 + i*100)
		pair := [2]int{0, i + 1}
		prev.Incidents = append(prev.Incidents, clip(tMS, pair))
		prev.PrivateCapture.EligibleIncidentKeys = append(prev.PrivateCapture.EligibleIncidentKeys, key(tMS, pair))
	}

	next := &RaceSummary{
		SchemaVersion: RaceSummarySchemaVersion,
		Detail:        &RaceDetail{CaptureStartLap: 1},
		PrivateCapture: &dto.RacePrivateCapture{RunID: "second-process", Provenance: dto.RaceCaptureProvenance{
			IncidentsCaptureActive: true,
		}},
	}
	// Same event with reversed collision ordering must deduplicate in both the
	// private ledger and visible clip union.
	next.Incidents = append(next.Incidents, clip(1_000, [2]int{1, 0}), clip(9_999, [2]int{0, 23}))
	next.PrivateCapture.EligibleIncidentKeys = append(next.PrivateCapture.EligibleIncidentKeys,
		key(1_000, [2]int{1, 0}), key(9_999, [2]int{0, 23}))

	MergeAdoptedSummary(prev, next)

	if got := len(next.PrivateCapture.EligibleIncidentKeys); got != incidentStoredCap+1 {
		t.Fatalf("eligible ledger = %d, want %d unique events", got, incidentStoredCap+1)
	}
	if got := len(next.Incidents); got != incidentStoredCap {
		t.Fatalf("visible incidents = %d, want cap %d", got, incidentStoredCap)
	}
	for i, incident := range next.Incidents {
		want := int64(1_000 + i*100)
		if incident.SessionTimeMS != want {
			t.Fatalf("incident[%d] time = %d, want chronological %d", i, incident.SessionTimeMS, want)
		}
	}
	if !next.PrivateCapture.Provenance.IncidentMergeLimited {
		t.Fatal("visible union cap must persist incident-merge-limit provenance")
	}
	section := next.Detail.Completeness.Sections.Incidents
	if section.CapturedCount == nil || section.StoredCount == nil || *section.CapturedCount != incidentStoredCap+1 || *section.StoredCount != incidentStoredCap ||
		!containsCompletenessReason(section.Reasons, dto.ReasonIncidentMergeLimit) {
		t.Fatalf("incident completeness = %+v, want ledger-derived cap facts", section)
	}
}

func TestMergeAdoptedSummaryAccumulatesEventCaptureLossFacts(t *testing.T) {
	prev := &RaceSummary{
		SchemaVersion: RaceSummarySchemaVersion,
		Detail:        &RaceDetail{Events: []dto.RaceControlNotification{{Timestamp: 100, Message: "first"}}},
		PrivateCapture: &dto.RacePrivateCapture{RunID: "first-events-process", Provenance: dto.RaceCaptureProvenance{
			EventsCaptureActive: true, EventsSeen: 150, EventsBufferDropped: 3,
		}},
	}
	next := &RaceSummary{
		SchemaVersion: RaceSummarySchemaVersion,
		Detail:        &RaceDetail{Events: []dto.RaceControlNotification{{Timestamp: 200, Message: "second"}}},
		PrivateCapture: &dto.RacePrivateCapture{RunID: "second-events-process", Provenance: dto.RaceCaptureProvenance{
			EventsCaptureActive: true, EventsSeen: 150, EventsBufferDropped: 4,
		}},
	}

	MergeAdoptedSummary(prev, next)
	provenance := next.PrivateCapture.Provenance
	if provenance.EventsSeen != 300 || provenance.EventsBufferDropped != 7 {
		t.Fatalf("merged event provenance = %+v, want 300 seen / 7 dropped", provenance)
	}
	section := next.Detail.Completeness.Sections.Events
	if section.CapturedCount == nil || *section.CapturedCount != 300 ||
		!containsCompletenessReason(section.Reasons, dto.ReasonEventBufferLimit) {
		t.Fatalf("merged event completeness = %+v, want accumulated capture and loss", section)
	}
}

func TestMergeAdoptedSummarySameRunCheckpointThenNormalFinalIsIdempotent(t *testing.T) {
	checkpoint := &RaceSummary{
		SchemaVersion: RaceSummarySchemaVersion,
		Detail:        &RaceDetail{Events: []dto.RaceControlNotification{{Timestamp: 100, Message: "first"}}},
		PrivateCapture: &dto.RacePrivateCapture{RunID: "process-a", Provenance: dto.RaceCaptureProvenance{
			EventsCaptureActive: true, EventsSeen: 150, EventsBufferDropped: 3, CheckpointFinalize: true,
		}},
	}
	normalFinal := &RaceSummary{
		SchemaVersion: RaceSummarySchemaVersion,
		Detail:        &RaceDetail{Events: []dto.RaceControlNotification{{Timestamp: 100, Message: "first"}, {Timestamp: 200, Message: "final"}}},
		PrivateCapture: &dto.RacePrivateCapture{RunID: "process-a", Provenance: dto.RaceCaptureProvenance{
			EventsCaptureActive: true, EventsSeen: 150, EventsBufferDropped: 3, NormalFinalize: true,
		}},
	}

	MergeAdoptedSummary(checkpoint, normalFinal)
	got := normalFinal.PrivateCapture.Provenance
	if got.EventsSeen != 150 || got.EventsBufferDropped != 3 {
		t.Fatalf("same-run counters = %d/%d, want latest cumulative 150/3", got.EventsSeen, got.EventsBufferDropped)
	}
	if !got.NormalFinalize || got.CheckpointFinalize {
		t.Fatalf("latest finalization = %+v, want normal only", got)
	}
	// The next save reloads the normal snapshot itself; it must remain stable.
	again := *normalFinal
	again.Detail = &RaceDetail{Events: append([]dto.RaceControlNotification(nil), normalFinal.Detail.Events...)}
	again.PrivateCapture = &dto.RacePrivateCapture{RunID: "process-a", Provenance: dto.RaceCaptureProvenance{
		EventsCaptureActive: true, EventsSeen: 150, EventsBufferDropped: 3, NormalFinalize: true,
	}}
	MergeAdoptedSummary(normalFinal, &again)
	if got := again.PrivateCapture.Provenance; got.EventsSeen != 150 || got.EventsBufferDropped != 3 || !got.NormalFinalize || got.CheckpointFinalize {
		t.Fatalf("repeated same-run merge = %+v, want idempotent normal-final facts", got)
	}
}

func TestMergeAdoptedSummaryPreservesMeasuredPitPairAcrossRestart(t *testing.T) {
	prev := &RaceSummary{
		SchemaVersion: RaceSummarySchemaVersion,
		Debrief:       &RaceDebrief{Pit: RacePitSummary{Stops: 1, PitLaneTimeMS: 18_000, StationaryTimeMS: 2_500}},
		PrivateCapture: &dto.RacePrivateCapture{RunID: "first", Provenance: dto.RaceCaptureProvenance{
			PitMeasurementObserved: true,
		}},
	}
	next := &RaceSummary{
		SchemaVersion:  RaceSummarySchemaVersion,
		Debrief:        &RaceDebrief{Pit: RacePitSummary{Stops: 1}},
		PrivateCapture: &dto.RacePrivateCapture{RunID: "second", Provenance: dto.RaceCaptureProvenance{}},
	}
	MergeAdoptedSummary(prev, next)
	if got := next.Debrief.Pit; got.PitLaneTimeMS != 18_000 || got.StationaryTimeMS != 2_500 || got.Stops != 1 {
		t.Fatalf("merged pit = %+v, want atomic prior measurement", got)
	}
	if !next.PrivateCapture.Provenance.PitMeasurementObserved {
		t.Fatalf("merged pit provenance = %+v, want observed", next.PrivateCapture.Provenance)
	}
}

func TestMergeAdoptedSummaryPreservesZeroStationaryPitMeasurementAcrossRestart(t *testing.T) {
	prev := &RaceSummary{
		SchemaVersion: RaceSummarySchemaVersion,
		Debrief:       &RaceDebrief{Pit: RacePitSummary{Stops: 1, PitLaneTimeMS: 18_000, StationaryTimeMS: 0}},
		PrivateCapture: &dto.RacePrivateCapture{RunID: "first", Provenance: dto.RaceCaptureProvenance{
			PitMeasurementObserved: true,
		}},
	}
	next := &RaceSummary{
		SchemaVersion:  RaceSummarySchemaVersion,
		Debrief:        &RaceDebrief{Pit: RacePitSummary{Stops: 1}},
		PrivateCapture: &dto.RacePrivateCapture{RunID: "second"},
	}
	MergeAdoptedSummary(prev, next)
	if got := next.Debrief.Pit; got.PitLaneTimeMS != 18_000 || got.StationaryTimeMS != 0 {
		t.Fatalf("merged zero-stationary pit = %+v, want 18000/0", got)
	}
}

func TestMergeAdoptedSummaryPreservesTrackOutlineSourcePointCount(t *testing.T) {
	points := make([][2]float64, 256)
	for i := range points {
		points[i] = [2]float64{float64(i), -float64(i)}
	}
	outline := &dto.TrackOutlineDTO{Points: points, Bounds: dto.TrackOutlineBounds{MinX: 0, MaxX: 255, MinZ: -255, MaxZ: 0}}
	prev := &RaceSummary{
		SchemaVersion:  RaceSummarySchemaVersion,
		Detail:         &RaceDetail{TrackOutline: outline},
		PrivateCapture: &dto.RacePrivateCapture{RunID: "first", Provenance: dto.RaceCaptureProvenance{TrackOutlineSourcePoints: 400}},
	}
	next := &RaceSummary{
		SchemaVersion:  RaceSummarySchemaVersion,
		Detail:         &RaceDetail{TrackOutline: cloneTrackOutline(outline)},
		PrivateCapture: &dto.RacePrivateCapture{RunID: "second", Provenance: dto.RaceCaptureProvenance{TrackOutlineSourcePoints: 300}},
	}

	MergeAdoptedSummary(prev, next)
	if got := next.PrivateCapture.Provenance.TrackOutlineSourcePoints; got != 400 {
		t.Fatalf("merged source outline count = %d, want 400", got)
	}
	section := next.Detail.Completeness.Sections.TrackOutline
	if section.CapturedCount == nil || section.StoredCount == nil || *section.CapturedCount != 400 || *section.StoredCount != 256 ||
		section.Status != dto.AvailabilityPartial || !containsCompletenessReason(section.Reasons, dto.ReasonTrackOutlineDownsampled) {
		t.Fatalf("merged outline completeness = %+v", section)
	}
}

func TestMergeAdoptedSummaryKeepsPriorTrackOutlineWhenRestartHasNone(t *testing.T) {
	outline := &dto.TrackOutlineDTO{
		Points: [][2]float64{{0, 0}, {10, -10}},
		Bounds: dto.TrackOutlineBounds{MinX: 0, MaxX: 10, MinZ: -10, MaxZ: 0},
	}
	prev := &RaceSummary{
		SchemaVersion: RaceSummarySchemaVersion,
		Detail:        &RaceDetail{TrackOutline: outline},
		PrivateCapture: &dto.RacePrivateCapture{RunID: "first", Provenance: dto.RaceCaptureProvenance{
			TrackOutlineSourcePoints: 336,
		}},
	}
	next := &RaceSummary{
		SchemaVersion:  RaceSummarySchemaVersion,
		Detail:         &RaceDetail{},
		PrivateCapture: &dto.RacePrivateCapture{RunID: "second"},
	}

	MergeAdoptedSummary(prev, next)
	if next.Detail.TrackOutline == nil || len(next.Detail.TrackOutline.Points) != 2 {
		t.Fatalf("merged outline = %+v, want prior centreline", next.Detail.TrackOutline)
	}
	if next.Detail.TrackOutline == prev.Detail.TrackOutline ||
		&next.Detail.TrackOutline.Points[0] == &prev.Detail.TrackOutline.Points[0] {
		t.Fatal("merged outline must be deep copied from the adopted snapshot")
	}
	if got := next.PrivateCapture.Provenance.TrackOutlineSourcePoints; got != 336 {
		t.Fatalf("merged source outline count = %d, want 336", got)
	}
	section := next.Detail.Completeness.Sections.TrackOutline
	if section.Status != dto.AvailabilityPartial || section.CapturedCount == nil || section.StoredCount == nil ||
		*section.CapturedCount != 336 || *section.StoredCount != 2 ||
		!containsCompletenessReason(section.Reasons, dto.ReasonTrackOutlineDownsampled) {
		t.Fatalf("merged outline completeness = %+v", section)
	}
}

func TestNormalizedIncidentKeyDeduplicatesCollisionPairs(t *testing.T) {
	key := normalizedIncidentKey(dto.IncidentCaptureKey{
		SessionTimeMS: 1_000,
		Collisions:    [][2]int{{1, 0}, {0, 1}, {2, 0}},
	})
	if len(key.Collisions) != 2 || key.Collisions[0] != [2]int{0, 1} || key.Collisions[1] != [2]int{0, 2} {
		t.Fatalf("normalized collisions = %v, want canonical unique pairs", key.Collisions)
	}
}
