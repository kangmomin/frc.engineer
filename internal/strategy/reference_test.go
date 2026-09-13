package strategy_test

import (
	"math"
	"reflect"
	"testing"

	"frc.engineer/internal/strategy"
	"frc.engineer/internal/strategy/strategytest"
)

func oneDriverRecords() []strategy.Record {
	records := strategytest.Records()
	for i := range records {
		records[i].AccountID = "one-driver"
	}
	return records
}

func TestReferenceAnalysisUsesOneDriversIndependentRaces(t *testing.T) {
	records := oneDriverRecords()
	request := strategytest.Request(records)
	strict := strategy.Analyze(records, request)
	if strict.Status != "insufficient-data" || len(strict.Plans) != 0 {
		t.Fatal("strict analysis unexpectedly changed its independent-user threshold")
	}
	result := strategy.AnalyzeWithLimitedEvidence(records, request)
	if result.Status != "ready" || result.SampleLevel != "limited" || result.Validation != "in-sample-only" ||
		result.MinimumEvidence != (strategy.EvidenceMinimums{Users: 1, Sessions: 3, CleanLaps: 12}) ||
		result.Context.Users != 1 || result.Context.Sessions != 12 || result.Context.CleanLaps != 324 || len(result.Plans) != 2 {
		t.Fatalf("missing labelled reference strategy: %+v", result)
	}
	if result.FuelSlopeMsPerKg == nil || math.Abs(*result.FuelSlopeMsPerKg-40) > 1 || result.Pit == nil ||
		math.Abs(result.Pit.AdditionalTimeMs-20000) > 10 || result.Pit.Users != 1 || result.Pit.Sessions != 12 {
		t.Fatalf("reference changed the measured estimator: %+v", result)
	}
	if result.ERS.Status != "insufficient-data" || len(result.ERS.Segments) != 0 {
		t.Fatal("reference pace relaxed the separate ERS evidence gate")
	}
	for _, model := range result.Compounds {
		want := 50.0
		if model.Tyre == "Soft" {
			want = 110
		}
		if math.Abs(model.AgeSlopeMs-want) > 1 {
			t.Fatalf("reference lost the known tyre effect: %+v", model)
		}
	}
}

func TestReferenceDoesNotRetryFailedFitsOrChangeSupportedResults(t *testing.T) {
	for _, scenario := range []string{"supported", "singular", "missing-pit", "no-inventory"} {
		t.Run(scenario, func(t *testing.T) {
			records := strategytest.Records()
			request := strategytest.Request(records)
			for i := range records {
				if scenario == "missing-pit" {
					records[i].Evidence.Stops = nil
				}
				for j := range records[i].Evidence.Laps {
					if scenario == "singular" {
						lap := &records[i].Evidence.Laps[j]
						lap.FuelKg = strategytest.Float(90 - float64(lap.TyreAge))
					}
				}
			}
			if scenario == "no-inventory" {
				request.AvailableSets = map[string]int{"Soft": 1}
			}
			if !reflect.DeepEqual(strategy.Analyze(records, request), strategy.AnalyzeWithLimitedEvidence(records, request)) {
				t.Fatal("reference path altered an existing supported result or retried a failed fit")
			}
		})
	}
}

func TestReferenceStillRequiresIndependentCompleteIdentifiableEvidence(t *testing.T) {
	for _, scenario := range []string{"one-session", "two-sessions", "duplicate-races", "missing-fuel", "damaged", "mixed-setup", "singular", "missing-pit", "sparse-compound"} {
		t.Run(scenario, func(t *testing.T) {
			records := oneDriverRecords()
			request := strategytest.Request(records)
			for i := range records {
				e := &records[i].Evidence
				switch scenario {
				case "one-session", "duplicate-races":
					e.SessionUID = "1000"
				case "two-sessions":
					e.SessionUID = []string{"1000", "1001"}[i%2]
				case "missing-pit":
					e.Stops = nil
				}
				for j := range e.Laps {
					lap := &e.Laps[j]
					switch scenario {
					case "missing-fuel":
						lap.FuelKg = nil
					case "damaged":
						lap.Flags = []string{"damage"}
					case "mixed-setup":
						if j > 15 {
							lap.SetupRevision = 2
						}
					case "singular":
						lap.FuelKg = strategytest.Float(90 - float64(lap.TyreAge))
					case "sparse-compound":
						if i > 1 && lap.Tyre == "Hard" {
							lap.Flags = []string{"traffic"}
						}
					}
				}
			}
			if scenario == "duplicate-races" {
				records = append(records, records...)
			}
			result := strategy.AnalyzeWithLimitedEvidence(records, request)
			if result.Status == "ready" || len(result.Plans) > 0 {
				t.Fatalf("unsupported reference produced a plan: %+v", result)
			}
		})
	}
}
