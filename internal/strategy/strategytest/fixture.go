// Package strategytest supplies synthetic, independently specified telemetry
// for cross-layer strategy tests. It is never used as product/demo data.
package strategytest

import (
	"fmt"
	"math"
	"strconv"

	"frc.engineer/internal/strategy"
)

func Float(value float64) *float64 { return &value }
func Int(value int) *int           { return &value }

// Records describes 12 independent 30-lap races, three drivers, varying pit
// timing, known fuel effect (40 ms/kg), two tyre trends (110/50 ms per lap),
// a 600 ms compound offset, and 20 seconds additional pit in/out lap time.
func Records() []strategy.Record {
	out := []strategy.Record{}
	for race := 0; race < 12; race++ {
		pitLap := 11 + race%7
		e := strategy.Evidence{Version: 1, SessionUID: strconv.Itoa(1000 + race), Reasons: []string{}, Laps: []strategy.Lap{},
			Conditions: strategy.Conditions{PacketFormat: 2026, GameYear: 25, GameMajor: 1, GameMinor: 22, Formula: 13, SessionType: 15, TotalLaps: 30, TrackLengthM: 4500,
				TeamID: Int(476), Rules: &strategy.Rules{EqualPerformance: true, GameMode: 7, RuleSet: 1, SessionLength: 5, SurfaceType: 1, TyreTemperature: 1, PitLaneTyreSim: 0}},
			Stops: []strategy.Stop{{InLap: pitLap, OutLap: pitLap + 1, LaneMs: 27000, StationaryMs: 2300}}}
		for number := 1; number <= 30; number++ {
			age := number - 1
			compound, tyre, stint := 16, "Soft", 1
			fuel := 95 - float64(number)*1.4 - float64(number*number)*.004 + float64(race%3)
			trend, offset := 110.0, -600.0
			if number > pitLap {
				age = number - pitLap - 1
				compound, tyre, stint = 18, "Hard", 2
				trend, offset = 50, 0
			}
			ms := 90000 + float64(race%3)*1800 + 40*fuel + offset + trend*float64(age)
			flags := []string{}
			if number == 1 {
				flags = append(flags, "race-start")
			}
			if number == pitLap || number == pitLap+1 {
				ms += 10000
				flags = append(flags, "pit")
			}
			lapMs := int(math.Round(ms))
			e.Laps = append(e.Laps, strategy.Lap{Number: number, TimeMs: lapMs, Compound: compound, Tyre: tyre, TyreAge: age, EndCompound: compound, EndTyreAge: age,
				Stint: stint, SetupRevision: 1, Weather: 0, TrackTemp: 30, TractionControl: 0, ABS: 0, FuelKg: Float(fuel), FuelEndKg: Float(fuel - 1.5),
				ERSStartJ: Float(3000000), ERSEndJ: Float(2400000), Flags: flags,
				Energy: []strategy.EnergySector{{DeployedJ: 800000, HarvestedJ: 600000, DurationMs: float64(lapMs)/3 - 150, MeanSpeedKph: 220},
					{DeployedJ: 800000, HarvestedJ: 500000, DurationMs: float64(lapMs)/3 - 150, MeanSpeedKph: 210},
					{DeployedJ: 400000, HarvestedJ: 300000, DurationMs: float64(lapMs)/3 - 150, MeanSpeedKph: 230}}})
		}
		out = append(out, strategy.Record{AccountID: fmt.Sprintf("driver-%d", race%3), RaceID: fmt.Sprintf("race-%02d", race), Evidence: e})
	}
	return out
}

func Request(records []strategy.Record) strategy.Request {
	contexts := strategy.Contexts(records)
	id := "00000000000000000000000000000000"
	if len(contexts) > 0 {
		id = contexts[0].ID
	}
	return strategy.Request{ContextID: id, MaxStops: 2, AvailableSets: map[string]int{"Soft": 1, "Medium": 1, "Hard": 1}, RequireTwoCompounds: true}
}
