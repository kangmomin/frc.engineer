package strategydata

import (
	"slices"
	"testing"
)

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

func hasAdjustment(adjustments []string, want string) bool {
	return slices.Contains(adjustments, want)
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
	if got.StrategyMeta == nil {
		t.Fatal("2026 track must carry StrategyMeta")
	}
	if !hasAdjustment(got.StrategyMeta.Adjustments, "c6_downgraded_to_c5") {
		t.Fatalf("adjustments %v missing c6_downgraded_to_c5", got.StrategyMeta.Adjustments)
	}
	if !hasAdjustment(got.StrategyMeta.Adjustments, "drs_abolished") {
		t.Fatalf("adjustments %v missing drs_abolished", got.StrategyMeta.Adjustments)
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

func TestApplyGameFormatNoC6StillAnnotates(t *testing.T) {
	track := &NormalizedTrackFile{
		Track: "bahrain",
		TyreStrategy: NormalizedTyreStrategy{
			Compounds: map[string]string{"hard": "C1", "medium": "C2", "soft": "C3"},
		},
	}
	got := ApplyGameFormat(track, 2026)
	// C6가 없어도 26이면 애노테이션 메타를 붙인 복사본을 반환한다.
	if got == track {
		t.Fatal("2026 track should return an annotated copy, not the original pointer")
	}
	if got.StrategyMeta == nil {
		t.Fatal("2026 track without C6 must still carry StrategyMeta")
	}
	if got.StrategyMeta.SourceGame != "f1_25_scrape" {
		t.Fatalf("source_game = %q, want f1_25_scrape", got.StrategyMeta.SourceGame)
	}
	// C6 강등이 없었으므로 해당 adjustment는 없어야 한다.
	if hasAdjustment(got.StrategyMeta.Adjustments, "c6_downgraded_to_c5") {
		t.Fatalf("adjustments %v should not include c6_downgraded_to_c5", got.StrategyMeta.Adjustments)
	}
	// 원본은 메타가 붙지 않아야 한다(store 불변).
	if track.StrategyMeta != nil {
		t.Fatal("original store track must not be mutated with StrategyMeta")
	}
}

func TestApplyGameFormatNilSafe(t *testing.T) {
	if got := ApplyGameFormat(nil, 2026); got != nil {
		t.Fatal("nil track should return nil")
	}
}
