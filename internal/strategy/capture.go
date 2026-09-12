package strategy

// RetainValidSamples is for locally captured evidence, never server ingestion.
// One malformed lap or pit timer must not discard other completed measurements.
// Session validation and exclusion reasons remain intact; no value is inferred
// or repaired, and an ambiguous lap sequence is still rejected as a whole.
func RetainValidSamples(e *Evidence) *Evidence {
	if ValidateEvidence(e) == nil {
		return e
	}
	sample := *e
	sample.Laps, sample.Stops = []Lap{}, []Stop{}
	if ValidateEvidence(&sample) != nil {
		return nil
	}
	out := sample
	previousLap := 0
	for _, l := range e.Laps {
		if l.Number <= previousLap {
			return nil
		}
		previousLap = l.Number
		sample.Laps = []Lap{l}
		if ValidateEvidence(&sample) == nil {
			out.Laps = append(out.Laps, l)
		}
	}
	sample.Laps = []Lap{}
	previousOut := 0
	for _, stop := range e.Stops {
		sample.Stops = []Stop{stop}
		if stop.InLap >= previousOut && len(out.Stops) < MaxStops && ValidateEvidence(&sample) == nil {
			out.Stops = append(out.Stops, stop)
			previousOut = stop.OutLap
		}
	}
	if (len(out.Laps) == 0 && len(out.Reasons) == 0) || ValidateEvidence(&out) != nil {
		return nil
	}
	return &out
}
