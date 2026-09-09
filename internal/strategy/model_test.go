package strategy_test

import (
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"testing"

	"frc.engineer/internal/strategy"
	"frc.engineer/internal/strategy/strategytest"
)

func TestStrategyRecoversKnownFuelTyreAndPitEffects(t *testing.T) {
	records := strategytest.Records()
	for _, r := range records {
		if err := strategy.ValidateEvidence(&r.Evidence); err != nil {
			t.Fatal(err)
		}
	}
	result := strategy.Analyze(records, strategytest.Request(records))
	if result.Status != "ready" {
		t.Fatalf("status=%s reasons=%v", result.Status, result.Reasons)
	}
	if result.FuelSlopeMsPerKg == nil || math.Abs(*result.FuelSlopeMsPerKg-40) > 1 {
		t.Fatalf("fuel slope=%v", result.FuelSlopeMsPerKg)
	}
	for _, m := range result.Compounds {
		want := 50.0
		if m.Tyre == "Soft" {
			want = 110
		}
		if math.Abs(m.AgeSlopeMs-want) > 1 {
			t.Fatalf("%s age slope=%f", m.Tyre, m.AgeSlopeMs)
		}
	}
	if result.Pit == nil || math.Abs(result.Pit.AdditionalTimeMs-20000) > 10 {
		t.Fatalf("pit=%+v; dwell is 27000, additional lap time is 20000", result.Pit)
	}
	if len(result.Plans) < 2 || result.Plans[0].DeltaMs != 0 {
		t.Fatalf("plans=%+v", result.Plans)
	}
	for _, p := range result.Plans {
		if len(p.PitLaps) != 1 || p.Stints[0].StartLap != 1 || p.Stints[len(p.Stints)-1].EndLap != 30 {
			t.Fatalf("inventory/horizon violated: %+v", p)
		}
		if p.DeltaMs < 0 || math.IsNaN(p.DeltaMs) {
			t.Fatal("invalid comparison")
		}
	}
	if result.ERS.Status != "observed-budget" || math.Abs(result.ERS.NetUseJ-600000) > 1 {
		t.Fatalf("ERS=%+v", result.ERS)
	}
	if result.Validation != "in-sample-only" {
		t.Fatal("synthetic fitting is not out-of-sample validation")
	}
	b, _ := json.Marshal(result)
	for _, secret := range []string{"driver-", "race-00", "sessionUid", "setupRevision", "frontWing", "contentHash"} {
		if strings.Contains(string(b), secret) {
			t.Fatalf("aggregate leaked %s", secret)
		}
	}
}

func TestFuelBurnDoesNotBecomeTyreDegradation(t *testing.T) {
	records := strategytest.Records()
	for i := range records {
		for j := range records[i].Evidence.Laps {
			l := &records[i].Evidence.Laps[j]
			trend := 50.0
			if l.Tyre == "Soft" {
				trend = 110
			}
			l.TimeMs -= int(trend * float64(l.TyreAge))
			for k := range l.Energy {
				l.Energy[k].DurationMs = float64(l.TimeMs)/3 - 150
			}
		}
	}
	r := strategy.Analyze(records, strategytest.Request(records))
	if r.Status != "ready" {
		t.Fatalf("%s %v", r.Status, r.Reasons)
	}
	for _, m := range r.Compounds {
		if math.Abs(m.AgeSlopeMs) > 1 {
			t.Fatalf("fuel-only data manufactured degradation: %+v", m)
		}
	}
}

func TestIndependentEvidenceAndKnownConditionGates(t *testing.T) {
	for _, scenario := range []string{"same-session", "one-user", "unknown-rules", "missing-fuel", "mixed-setup", "damaged"} {
		t.Run(scenario, func(t *testing.T) {
			records := strategytest.Records()
			request := strategytest.Request(records)
			for i := range records {
				e := &records[i].Evidence
				switch scenario {
				case "same-session":
					e.SessionUID = "1000"
				case "one-user":
					records[i].AccountID = "one"
				case "unknown-rules":
					e.Conditions.Rules = nil
				}
				for j := range e.Laps {
					switch scenario {
					case "missing-fuel":
						e.Laps[j].FuelKg = nil
					case "mixed-setup":
						if j > 15 {
							e.Laps[j].SetupRevision = 2
						}
					case "damaged":
						e.Laps[j].Flags = []string{"damage"}
					}
				}
			}
			r := strategy.Analyze(records, request)
			if r.Status == "ready" || len(r.Plans) > 0 {
				t.Fatalf("unsupported evidence generated plans: %+v", r)
			}
		})
	}
	base := strategytest.Records()
	contexts := strategy.Contexts(base)
	duplicated := append(append([]strategy.Record{}, base...), base...)
	dupContexts := strategy.Contexts(duplicated)
	if len(dupContexts) != 1 || dupContexts[0].Sessions != contexts[0].Sessions || dupContexts[0].CleanLaps != contexts[0].CleanLaps {
		t.Fatal("duplicate upload increased evidence")
	}
}

func TestUnidentifiableFuelAgeDoesNotGetRegularizedIntoARecommendation(t *testing.T) {
	records := strategytest.Records()
	for i := range records {
		for j := range records[i].Evidence.Laps {
			l := &records[i].Evidence.Laps[j]
			l.FuelKg = strategytest.Float(90 - float64(l.TyreAge))
		}
	}
	r := strategy.Analyze(records, strategytest.Request(records))
	if r.Status != "unidentifiable" || len(r.Plans) > 0 {
		t.Fatalf("status=%s plans=%d", r.Status, len(r.Plans))
	}
}

func TestUnavailablePitEvidenceAndTyreInventorySuppressImpossiblePlans(t *testing.T) {
	records := strategytest.Records()
	request := strategytest.Request(records)
	for i := range records {
		records[i].Evidence.Stops = nil
	}
	r := strategy.Analyze(records, request)
	if r.Pit != nil || len(r.Plans) != 0 {
		t.Fatal("fabricated missing pit cost")
	}
	records = strategytest.Records()
	request = strategytest.Request(records)
	request.AvailableSets = map[string]int{"Soft": 1}
	r = strategy.Analyze(records, request)
	if len(r.Plans) != 0 {
		t.Fatal("one available compound cannot satisfy two-compound rule")
	}
}

func TestInsufficientERSCoverageIsNotPresentedAsAnEnergyBudget(t *testing.T) {
	records := strategytest.Records()
	for i := range records {
		for j := range records[i].Evidence.Laps {
			for k := range records[i].Evidence.Laps[j].Energy {
				records[i].Evidence.Laps[j].Energy[k].DurationMs = 100
			}
		}
	}
	r := strategy.Analyze(records, strategytest.Request(records))
	if r.ERS.Status != "insufficient-data" || len(r.ERS.Segments) > 0 {
		t.Fatal("missing coverage disguised as measured budget")
	}
}

func TestMinimumLapEvidenceExcludesRacesRejectedForMixedSetups(t *testing.T) {
	records := strategytest.Records()
	for i := range records {
		for j := range records[i].Evidence.Laps {
			l := &records[i].Evidence.Laps[j]
			if i >= 6 {
				if j > 15 {
					l.SetupRevision = 2
				}
				continue
			}
			if l.TyreAge != 1 && l.TyreAge != 4 && l.TyreAge != 8 {
				l.Flags = []string{"traffic"}
			}
		}
	}
	contexts := strategy.Contexts(records)
	if len(contexts) != 1 || contexts[0].CleanLaps <= strategy.MinCleanLaps {
		t.Fatal("fixture must have enough discovery evidence before excluding mixed setups")
	}
	r := strategy.Analyze(records, strategytest.Request(records))
	if r.Status != "insufficient-data" || r.FuelSlopeMsPerKg != nil || len(r.Plans) != 0 {
		t.Fatalf("fitted below the minimum clean-lap count: %+v", r)
	}
	if r.Context == nil || r.Context.CleanLaps != 36 || r.Context.Users != 3 || r.Context.Sessions != 6 {
		t.Fatalf("context must describe the actual 36 fitting laps: %+v", r.Context)
	}
}

func TestMinimumIndependentEvidenceIsRecheckedAfterCompoundFiltering(t *testing.T) {
	records := strategytest.Records()[:6]
	for i := range records {
		for j := range records[i].Evidence.Laps {
			l := &records[i].Evidence.Laps[j]
			// Only the first race has four retained laps. Other races contribute
			// one Soft lap and enough individually unsupported compound laps to
			// pass the initial per-race count.
			if l.Tyre == "Soft" && (i == 0 || l.TyreAge == 1) {
				continue
			}
			l.Compound, l.EndCompound, l.Tyre = 100+i, 100+i, "Hard"
		}
	}
	r := strategy.Analyze(records, strategytest.Request(records))
	if r.Status != "insufficient-data" || r.FuelSlopeMsPerKg != nil || len(r.Plans) != 0 {
		t.Fatalf("a single usable driver/session generated a fit: %+v", r)
	}
	if r.Context == nil || r.Context.Users != 0 || r.Context.Sessions != 0 || r.Context.CleanLaps != 0 || len(r.Compounds) != 0 {
		t.Fatalf("unsupported compounds must not keep stale evidence counts: %+v", r)
	}
}

func TestCompoundCoverageUsesOnlyRacesRetainedForFitting(t *testing.T) {
	records := strategytest.Records()
	for i := 6; i < len(records); i++ {
		seen := map[string]bool{}
		for j := range records[i].Evidence.Laps {
			l := &records[i].Evidence.Laps[j]
			if len(l.Flags) == 0 && !seen[l.Tyre] {
				seen[l.Tyre] = true
				l.TyreAge, l.EndTyreAge = 100, 100
				continue
			}
			l.Compound, l.EndCompound, l.Tyre = 100+i, 100+i, "Medium"
		}
	}
	r := strategy.Analyze(records, strategytest.Request(records))
	if r.Status != "ready" {
		t.Fatalf("well-supported retained races should still fit: %s %v", r.Status, r.Reasons)
	}
	if r.Context == nil || r.Context.Users != 3 || r.Context.Sessions != 6 || r.Context.CleanLaps != 162 {
		t.Fatalf("context counted excluded race observations: %+v", r.Context)
	}
	laps := 0
	for _, m := range r.Compounds {
		if m.Users != 3 || m.Sessions != 6 || m.MaxAge >= 100 {
			t.Fatalf("excluded sparse races expanded compound support: %+v", m)
		}
		laps += m.Laps
	}
	if laps != r.Context.CleanLaps {
		t.Fatalf("compound laps=%d fitting laps=%d", laps, r.Context.CleanLaps)
	}
}

func TestERSLapTotalsPreserveBalancedLapsAcrossDifferentDeploymentSegments(t *testing.T) {
	records := strategytest.Records()
	for i := range records {
		cleanLap := 0
		for j := range records[i].Evidence.Laps {
			l := &records[i].Evidence.Laps[j]
			if len(l.Flags) != 0 {
				continue
			}
			for k := range l.Energy {
				l.Energy[k].DeployedJ = 0
				l.Energy[k].HarvestedJ = 1000000
			}
			l.Energy[cleanLap%3].DeployedJ = 3000000
			l.ERSStartJ, l.ERSEndJ = strategytest.Float(3000000), strategytest.Float(3000000)
			cleanLap++
		}
	}
	r := strategy.Analyze(records, strategytest.Request(records))
	if r.ERS.Status != "observed-budget" || r.ERS.DeployedJ != 3000000 || r.ERS.HarvestedJ != 3000000 || r.ERS.NetUseJ != 0 {
		t.Fatalf("balanced observed laps became a fictitious charging budget: %+v", r.ERS)
	}
}

func TestERSNetUseAggregatesPairedLapDifferences(t *testing.T) {
	records := strategytest.Records()
	deploy := []float64{1000000, 2000000, 4000000}
	harvest := []float64{0, 2000000, 2000000}
	for i := range records {
		cleanLap := 0
		for j := range records[i].Evidence.Laps {
			l := &records[i].Evidence.Laps[j]
			if len(l.Flags) != 0 {
				continue
			}
			for k := range l.Energy {
				l.Energy[k].DeployedJ, l.Energy[k].HarvestedJ = 0, 0
			}
			d, h := deploy[cleanLap%3], harvest[cleanLap%3]
			l.Energy[0].DeployedJ, l.Energy[0].HarvestedJ = d, h
			l.ERSStartJ, l.ERSEndJ = strategytest.Float(3000000), strategytest.Float(3000000-d+h)
			cleanLap++
		}
	}
	r := strategy.Analyze(records, strategytest.Request(records))
	if r.ERS.Status != "observed-budget" || r.ERS.DeployedJ != 2000000 || r.ERS.HarvestedJ != 2000000 || r.ERS.NetUseJ != 1000000 {
		t.Fatalf("median lap net use must preserve paired observations: %+v", r.ERS)
	}
}

func TestPitAndERSLimitBothSessionAndUserInfluence(t *testing.T) {
	for _, scenario := range []string{"many-users-one-session", "one-user-many-sessions"} {
		t.Run(scenario, func(t *testing.T) {
			records := strategytest.Records()
			for i := 0; i < 24; i++ {
				r := strategyRecordWithBudget(strategytest.Records()[0], 6000, 3000000, 600000)
				r.RaceID = fmt.Sprintf("additional-race-%d", i)
				r.AccountID = fmt.Sprintf("additional-driver-%d", i)
				r.Evidence.SessionUID = "9000"
				if scenario == "one-user-many-sessions" {
					r.AccountID = "additional-driver"
					r.Evidence.SessionUID = fmt.Sprint(9000 + i)
				}
				records = append(records, r)
			}
			request := strategytest.Request(records)
			request.AvailableSets["Soft"] = 2
			r := strategy.Analyze(records, request)
			if r.Status != "ready" || r.Pit == nil {
				t.Fatalf("valid independent baseline should remain available: %s %v", r.Status, r.Reasons)
			}
			if math.Abs(r.Pit.AdditionalTimeMs-20000) > 10 || len(r.Plans[0].PitLaps) != 1 {
				t.Fatalf("concentrated uploads overwhelmed the pit estimate and stop ranking: pit=%+v plan=%+v", r.Pit, r.Plans[0])
			}
			if r.ERS.Status != "observed-budget" || r.ERS.DeployedJ != 2000000 || r.ERS.HarvestedJ != 1400000 || r.ERS.NetUseJ != 600000 {
				t.Fatalf("concentrated uploads overwhelmed the paired lap energy budget: %+v", r.ERS)
			}
			if r.ERS.Segments[0].DeployedJ != 800000 || r.ERS.Segments[0].MeanSpeedKph != 220 || r.ERS.StartEnergyJ != 3000000 || r.ERS.EndEnergyJ != 2400000 {
				t.Fatalf("energy profile fields did not share record weights: %+v", r.ERS)
			}
			users, sessions := 27, 13
			if scenario == "one-user-many-sessions" {
				users, sessions = 4, 36
			}
			if r.Pit.Users != users || r.Pit.Sessions != sessions || r.Pit.Stops != 36 || r.ERS.Users != users || r.ERS.Sessions != sessions || r.ERS.Laps != 972 {
				t.Fatalf("weights must not replace raw support counts: pit=%+v ers=%+v", r.Pit, r.ERS)
			}
		})
	}
}

func TestERSRecordWeightDoesNotGrowWithLapCount(t *testing.T) {
	records := strategytest.Records()
	for i := range records {
		if i >= 9 {
			// Each driver's one long race has 27 clean laps with heavy deployment.
			records[i] = strategyRecordWithBudget(records[i], 20000, 3000000, 600000)
			continue
		}
		// Their other three races each provide only six clean laps. A race's
		// contribution must not grow with its number of captured laps.
		for j := range records[i].Evidence.Laps {
			l := &records[i].Evidence.Laps[j]
			if len(l.Flags) == 0 && l.TyreAge != 1 && l.TyreAge != 4 && l.TyreAge != 8 {
				l.Flags = []string{"traffic"}
			}
		}
	}
	r := strategy.Analyze(records, strategytest.Request(records))
	if r.ERS.Status != "observed-budget" || r.ERS.NetUseJ != 600000 || r.ERS.Segments[0].DeployedJ != 800000 {
		t.Fatalf("one longer race outweighed three independent races per driver: %+v", r.ERS)
	}
	if r.ERS.Users != 3 || r.ERS.Sessions != 12 || r.ERS.Laps != 135 {
		t.Fatalf("valid energy support counts changed: %+v", r.ERS)
	}
}

func strategyRecordWithBudget(record strategy.Record, pitMs int, deployedJ, harvestedJ float64) strategy.Record {
	record.Evidence.Laps = append([]strategy.Lap{}, record.Evidence.Laps...)
	for i := range record.Evidence.Laps {
		l := &record.Evidence.Laps[i]
		for _, flag := range l.Flags {
			if flag == "pit" {
				// The base fixture places half its 20-second overhead on each
				// member of the in/out lap pair.
				l.TimeMs += (pitMs - 20000) / 2
			}
		}
		l.Energy = append([]strategy.EnergySector{}, l.Energy...)
		for j := range l.Energy {
			l.Energy[j].DeployedJ = deployedJ / 3
			l.Energy[j].HarvestedJ = harvestedJ / 3
			l.Energy[j].DurationMs = float64(l.TimeMs)/3 - 150
			l.Energy[j].MeanSpeedKph = 300
		}
		l.ERSStartJ = strategytest.Float(4000000)
		l.ERSEndJ = strategytest.Float(4000000 - deployedJ + harvestedJ)
	}
	return record
}

func TestContextsKeepTracksSeparate(t *testing.T) {
	first := strategytest.Records()
	second := strategytest.Records()
	for i := range second {
		second[i].TrackID = 7
	}
	combined := append(append([]strategy.Record{}, first...), second...)
	contexts := strategy.Contexts(combined)
	if len(contexts) != 2 {
		t.Fatalf("tracks were deduplicated or combined: %+v", contexts)
	}
	for _, records := range [][]strategy.Record{first, second} {
		one := strategy.Contexts(records)[0]
		found := false
		for _, c := range contexts {
			if c.TrackID == one.TrackID {
				found = true
				if c.ID != one.ID || c.Users != one.Users || c.Sessions != one.Sessions || c.CleanLaps != one.CleanLaps {
					t.Fatalf("all-track context changed: %+v vs %+v", c, one)
				}
			}
		}
		if !found {
			t.Fatal("track absent")
		}
		result := strategy.Analyze(combined, strategytest.Request(records))
		if result.Status != "ready" || result.Context.TrackID != one.TrackID || result.Context.Sessions != one.Sessions {
			t.Fatalf("comparison mixed tracks: %+v", result)
		}
		want, _ := json.Marshal(strategy.Analyze(records, strategytest.Request(records)))
		got, _ := json.Marshal(result)
		if string(got) != string(want) {
			t.Fatal("other track changed tyre, pit or ERS calculation")
		}
	}
}
