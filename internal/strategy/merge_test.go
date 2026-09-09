package strategy_test

import (
	"slices"
	"testing"

	"frc.engineer/internal/strategy"
	"frc.engineer/internal/strategy/strategytest"
)

func TestMergePreservesSessionDisqualificationWithoutNewLaps(t *testing.T) {
	previous := strategytest.Records()[0].Evidence
	next := previous
	next.Laps = nil
	next.Stops = nil
	next.Reasons = []string{"flashback"}
	merged := strategy.Merge(&previous, &next, true)
	if !slices.Contains(merged.Reasons, "flashback") || len(strategy.Contexts([]strategy.Record{{AccountID: "owner", Evidence: *merged}})) != 0 {
		t.Fatal("checkpoint restored disqualified strategy evidence")
	}
	next = previous
	merged = strategy.Merge(&previous, &next, false)
	if !slices.Contains(merged.Reasons, "conditions-change") {
		t.Fatal("restart inferred an identical setup")
	}
}

func TestAnalyzeRejectsConflictingCompoundAllocations(t *testing.T) {
	records := strategytest.Records()
	for i := range records {
		for j := range records[i].Evidence.Laps {
			records[i].Evidence.Laps[j].Tyre = "Soft"
		}
	}
	result := strategy.Analyze(records, strategytest.Request(records))
	if len(result.Plans) != 0 || !slices.Contains(result.Reasons, "compound-label-conflict") {
		t.Fatal("different compounds sharing one tyre colour were pooled")
	}
}
