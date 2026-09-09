package strategy_test

import (
	"encoding/json"
	"testing"

	"frc.engineer/internal/strategy"
	"frc.engineer/internal/strategy/strategytest"
)

func TestEvidenceMissingValuesNeverBecomeKnownZero(t *testing.T) {
	for _, field := range []string{"equalPerformance", "tyreTemperature", "ersAssist"} {
		for _, missing := range []bool{true, false} {
			data, _ := json.Marshal(strategytest.Records()[0].Evidence)
			var e map[string]any
			_ = json.Unmarshal(data, &e)
			rules := e["conditions"].(map[string]any)["rules"].(map[string]any)
			if missing {
				delete(rules, field)
			} else {
				rules[field] = nil
			}
			data, _ = json.Marshal(e)
			var out strategy.Evidence
			if json.Unmarshal(data, &out) == nil {
				t.Fatalf("accepted missing/null %s", field)
			}
		}
	}
}

func TestEvidenceRoundTripAndSizeBudget(t *testing.T) {
	e := strategytest.Records()[0].Evidence
	data, _ := json.Marshal(e)
	var out strategy.Evidence
	if err := json.Unmarshal(data, &out); err != nil || strategy.ValidateEvidence(&out) != nil || *out.Conditions.TeamID != 476 {
		t.Fatalf("complete 2026 evidence rejected: %v", err)
	}
	e.Conditions.TotalLaps = strategy.MaxLaps
	base := e.Laps[1]
	base.Flags = []string{"partial-lap", "invalid", "pit", "safety-car", "incident", "damage", "traffic", "setup-change", "weather-change", "gap", "flashback", "source-missing", "penalty", "paused", "conditions-change", "race-start"}
	e.Laps = nil
	for i := 1; i <= strategy.MaxLaps; i++ {
		l := base
		l.Number = i
		e.Laps = append(e.Laps, l)
	}
	data, _ = json.Marshal(e)
	if len(data) <= strategy.MaxEvidenceBytes || strategy.ValidateEvidence(&e) == nil {
		t.Fatalf("oversized evidence must be omitted: %d bytes", len(data))
	}
}
