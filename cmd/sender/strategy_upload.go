package main

import (
	"frc.engineer/internal/races"
	"frc.engineer/internal/strategy"
)

// Only completed timings confirmed by the race summary are uploaded. A
// discarded attempt or a changed retroactive lap must not reject the race or
// introduce a second timing truth into the strategy corpus.
func uploadStrategyEvidence(summary *races.RaceSummary) *strategy.Evidence {
	if summary.PrivateCapture == nil || summary.PrivateCapture.Strategy == nil || summary.Detail == nil {
		return nil
	}
	e := *summary.PrivateCapture.Strategy
	times := map[int]int{}
	for _, l := range summary.Detail.Laps {
		times[l.LapNumber] = int(l.LapMs)
	}
	e.Laps = []strategy.Lap{}
	for _, l := range summary.PrivateCapture.Strategy.Laps {
		if times[l.Number] == l.TimeMs {
			e.Laps = append(e.Laps, l)
		}
	}
	valid := strategy.RetainValidSamples(&e)
	if valid == nil || len(valid.Laps) == 0 {
		return nil
	}
	return valid
}
