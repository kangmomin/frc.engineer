package strategydata

import "testing"

func newC6Track() *NormalizedTrackFile {
	return &NormalizedTrackFile{
		Track: "canada",
		TyreStrategy: NormalizedTyreStrategy{
			Compounds: map[string]string{
				"hard":   "C4",
				"medium": "C5",
				"soft":   "C6",
			},
		},
	}
}

func TestApplyGameFormat2026DowngradesC6(t *testing.T) {
	track := newC6Track()
	got := ApplyGameFormat(track, 2026)
	if got.TyreStrategy.Compounds["soft"] != "C5" {
		t.Fatalf("soft compound = %q, want C5", got.TyreStrategy.Compounds["soft"])
	}
	// 다른 슬롯은 유지되어야 한다.
	if got.TyreStrategy.Compounds["hard"] != "C4" {
		t.Fatalf("hard compound = %q, want C4", got.TyreStrategy.Compounds["hard"])
	}
}

func TestApplyGameFormat2026DoesNotMutateOriginal(t *testing.T) {
	track := newC6Track()
	_ = ApplyGameFormat(track, 2026)
	// 원본 store 데이터가 오염되면 안 된다(포인터/맵 분리 확인).
	if track.TyreStrategy.Compounds["soft"] != "C6" {
		t.Fatalf("original soft compound mutated to %q, want C6", track.TyreStrategy.Compounds["soft"])
	}
}

func TestApplyGameFormat2025ReturnsOriginal(t *testing.T) {
	track := newC6Track()
	got := ApplyGameFormat(track, 2025)
	if got != track {
		t.Fatal("F1 25 should return the original track pointer unchanged")
	}
	if got.TyreStrategy.Compounds["soft"] != "C6" {
		t.Fatalf("F1 25 soft compound = %q, want C6 (unchanged)", got.TyreStrategy.Compounds["soft"])
	}
}

func TestApplyGameFormatNoC6ReturnsOriginal(t *testing.T) {
	track := &NormalizedTrackFile{
		Track: "bahrain",
		TyreStrategy: NormalizedTyreStrategy{
			Compounds: map[string]string{"hard": "C1", "medium": "C2", "soft": "C3"},
		},
	}
	got := ApplyGameFormat(track, 2026)
	// C6가 없으면 복사 없이 원본을 그대로 반환한다.
	if got != track {
		t.Fatal("track without C6 should return the original pointer (no copy)")
	}
}

func TestApplyGameFormatNilSafe(t *testing.T) {
	if got := ApplyGameFormat(nil, 2026); got != nil {
		t.Fatal("nil track should return nil")
	}
}
