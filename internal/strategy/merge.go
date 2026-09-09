package strategy

import (
	"encoding/json"
	"sort"
)

// Merge preserves completed observations during sender restart adoption.
// A restarted process cannot prove that its local setup revision 1 equals the
// previous process's revision 1, so the combined capture is not a clean cohort.
func Merge(previous, next *Evidence, sameRun bool) *Evidence {
	if previous == nil {
		return next
	}
	if next == nil {
		return previous
	}
	if previous.SessionUID != next.SessionUID {
		return next
	}
	merged := *next
	byLap := map[int]Lap{}
	for _, l := range previous.Laps {
		byLap[l.Number] = l
	}
	for _, l := range next.Laps {
		byLap[l.Number] = l
	}
	merged.Laps = []Lap{}
	for _, l := range byLap {
		merged.Laps = append(merged.Laps, l)
	}
	sort.Slice(merged.Laps, func(i, j int) bool { return merged.Laps[i].Number < merged.Laps[j].Number })
	byStop := map[[2]int]Stop{}
	for _, s := range previous.Stops {
		byStop[[2]int{s.InLap, s.OutLap}] = s
	}
	for _, s := range next.Stops {
		byStop[[2]int{s.InLap, s.OutLap}] = s
	}
	merged.Stops = []Stop{}
	for _, s := range byStop {
		merged.Stops = append(merged.Stops, s)
	}
	sort.Slice(merged.Stops, func(i, j int) bool {
		if merged.Stops[i].InLap != merged.Stops[j].InLap {
			return merged.Stops[i].InLap < merged.Stops[j].InLap
		}
		return merged.Stops[i].OutLap < merged.Stops[j].OutLap
	})
	reasons := map[string]bool{}
	for _, r := range previous.Reasons {
		reasons[r] = true
	}
	for _, r := range next.Reasons {
		reasons[r] = true
	}
	a, _ := json.Marshal(previous.Conditions)
	b, _ := json.Marshal(next.Conditions)
	if !sameRun || string(a) != string(b) {
		reasons["conditions-change"] = true
	}
	merged.Reasons = []string{}
	for r := range reasons {
		merged.Reasons = append(merged.Reasons, r)
	}
	sort.Strings(merged.Reasons)
	return &merged
}
