package strategy

import "sort"

// Diagnostics describes the same bounded, deduplicated corpus as Contexts.
// Reason counts overlap; ExcludedLaps counts each unusable lap only once.
type Diagnostics struct {
	CollectedLaps   int         `json:"collectedLaps"`
	CleanLaps       int         `json:"cleanLaps"`
	ExcludedLaps    int         `json:"excludedLaps"`
	ExcludedRecords int         `json:"excludedRecords"`
	Exclusions      []Exclusion `json:"exclusions"`
}

type Exclusion struct {
	Code    string `json:"code"`
	Records int    `json:"records"`
	Laps    int    `json:"laps"`
}

func Diagnose(records []Record) Diagnostics {
	out := Diagnostics{Exclusions: []Exclusion{}}
	counts := map[string]*Exclusion{}
	for _, r := range uniqueRecords(records) {
		e := r.Evidence
		recordReasons := map[string]bool{}
		for _, reason := range e.Reasons {
			recordReasons[reason] = true
		}
		if e.Conditions.Rules == nil || e.Conditions.TeamID == nil {
			recordReasons["missing-conditions"] = true
		}
		if e.Conditions.Formula != 0 && e.Conditions.Formula != 13 {
			recordReasons["unsupported-formula"] = true
		}
		lapCounts := map[string]int{}
		for code := range recordReasons {
			lapCounts[code] = 0
		}
		usable := 0
		out.CollectedLaps += len(e.Laps)
		for _, l := range e.Laps {
			if clean(l) {
				if _, known := contextFor(r, l); known {
					usable++
					continue
				}
			}
			causes := map[string]bool{}
			for code := range recordReasons {
				causes[code] = true
			}
			for _, code := range l.Flags {
				causes[code] = true
			}
			if l.SetupRevision == 0 {
				causes["missing-setup"] = true
			}
			if l.FuelKg == nil || l.FuelEndKg == nil {
				causes["missing-fuel"] = true
			}
			if !ValidTyre(l.Tyre) {
				causes["unknown-tyre"] = true
			}
			if l.Compound != l.EndCompound {
				causes["compound-change"] = true
			}
			for code := range causes {
				lapCounts[code]++
			}
		}
		if len(e.Laps) == 0 && len(lapCounts) == 0 {
			lapCounts["no-completed-laps"] = 0
		}
		out.CleanLaps += usable
		out.ExcludedLaps += len(e.Laps) - usable
		if usable == 0 {
			out.ExcludedRecords++
		}
		for code, laps := range lapCounts {
			if counts[code] == nil {
				counts[code] = &Exclusion{Code: code}
			}
			counts[code].Records++
			counts[code].Laps += laps
		}
	}
	for _, count := range counts {
		out.Exclusions = append(out.Exclusions, *count)
	}
	sort.Slice(out.Exclusions, func(i, j int) bool {
		a, b := out.Exclusions[i], out.Exclusions[j]
		if a.Laps != b.Laps {
			return a.Laps > b.Laps
		}
		if a.Records != b.Records {
			return a.Records > b.Records
		}
		return a.Code < b.Code
	})
	return out
}
