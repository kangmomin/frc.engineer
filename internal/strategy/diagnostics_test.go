package strategy_test

import (
	"encoding/json"
	"reflect"
	"testing"

	"frc.engineer/internal/strategy"
	"frc.engineer/internal/strategy/strategytest"
)

func TestDiagnosticsCountsDistinctLapsAndOverlappingReasons(t *testing.T) {
	r := strategytest.Records()[0]
	r.Evidence.Laps = r.Evidence.Laps[1:4]
	r.Evidence.Laps[0].Flags = []string{"damage", "traffic"}
	r.Evidence.Laps[0].FuelEndKg = nil
	r.Evidence.Laps[1].SetupRevision = 0
	duplicate := r
	duplicate.RaceID = "partial-copy"
	duplicate.Evidence.Laps = r.Evidence.Laps[:2]
	records := []strategy.Record{duplicate, r}
	before, _ := json.Marshal(records)
	d := strategy.Diagnose(records)
	if d.CollectedLaps != 3 || d.CleanLaps != 1 || d.ExcludedLaps != 2 || d.ExcludedRecords != 0 {
		t.Fatalf("counts confused duplicates or overlapping reasons: %+v", d)
	}
	want := []strategy.Exclusion{{Code: "damage", Records: 1, Laps: 1}, {Code: "missing-fuel", Records: 1, Laps: 1},
		{Code: "missing-setup", Records: 1, Laps: 1}, {Code: "traffic", Records: 1, Laps: 1}}
	if !reflect.DeepEqual(d.Exclusions, want) {
		t.Fatalf("exclusions = %+v, want %+v", d.Exclusions, want)
	}
	contexts := strategy.Contexts(records)
	if len(contexts) != 1 || contexts[0].CleanLaps != d.CleanLaps {
		t.Fatal("diagnostics and discovery disagree about usable laps")
	}
	after, _ := json.Marshal(records)
	if string(before) != string(after) {
		t.Fatal("diagnosis mutated private evidence")
	}
}

func TestDiagnosticsExplainsUnknownConditionsAndSessionExclusions(t *testing.T) {
	for _, tc := range []struct {
		name string
		edit func(*strategy.Evidence)
		code string
	}{
		{"unknown rules", func(e *strategy.Evidence) { e.Conditions.Rules = nil }, "missing-conditions"},
		{"unknown team", func(e *strategy.Evidence) { e.Conditions.TeamID = nil }, "missing-conditions"},
		{"unsupported formula", func(e *strategy.Evidence) { e.Conditions.Formula = 2 }, "unsupported-formula"},
		{"changed conditions", func(e *strategy.Evidence) { e.Reasons = []string{"conditions-change"} }, "conditions-change"},
		{"rewound race", func(e *strategy.Evidence) { e.Reasons = []string{"flashback"}; e.Laps = []strategy.Lap{} }, "flashback"},
		{"no completed laps", func(e *strategy.Evidence) { e.Laps = []strategy.Lap{} }, "no-completed-laps"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := strategytest.Records()[0]
			r.Evidence.Laps = r.Evidence.Laps[1:3]
			tc.edit(&r.Evidence)
			d := strategy.Diagnose([]strategy.Record{r})
			if d.CleanLaps != 0 || d.ExcludedRecords != 1 || d.ExcludedLaps != len(r.Evidence.Laps) ||
				len(d.Exclusions) != 1 || d.Exclusions[0] != (strategy.Exclusion{Code: tc.code, Records: 1, Laps: len(r.Evidence.Laps)}) ||
				len(strategy.Contexts([]strategy.Record{r})) != 0 {
				t.Fatalf("unexplained exclusion: %+v", d)
			}
		})
	}
}

func TestDiagnosticsPreservesModelThresholdsAndPrivacy(t *testing.T) {
	records := strategytest.Records()
	d := strategy.Diagnose(records)
	clean := 0
	for _, c := range strategy.Contexts(records) {
		clean += c.CleanLaps
	}
	if d.CleanLaps != clean || d.CollectedLaps != d.CleanLaps+d.ExcludedLaps || d.ExcludedRecords != 0 {
		t.Fatalf("discovery counts disagree: %+v", d)
	}
	if got := strategy.Analyze(records[:1], strategytest.Request(records[:1])); got.Status != "insufficient-data" {
		t.Fatal("single-driver corpus bypassed analysis gate")
	}
	empty := strategy.Diagnose(nil)
	if empty.Exclusions == nil || empty.CollectedLaps != 0 || empty.CleanLaps != 0 {
		t.Fatal("empty corpus must be explicit zero counts and an array")
	}
}
