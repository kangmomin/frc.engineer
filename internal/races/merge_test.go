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
