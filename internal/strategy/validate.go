package strategy

import (
	"encoding/json"
	"errors"
	"math"
	"strconv"
)

var ErrInvalidEvidence = errors.New("strategy: invalid evidence")
var ErrInvalidRequest = errors.New("strategy: invalid request")

var flagNames = map[string]bool{
	"partial-lap": true, "invalid": true, "pit": true, "safety-car": true,
	"incident": true, "damage": true, "traffic": true, "setup-change": true,
	"weather-change": true, "gap": true, "flashback": true, "source-missing": true,
	"penalty": true, "paused": true, "conditions-change": true, "race-start": true,
}

func finite(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) }
func bounded(v *float64, lo, hi float64) bool {
	return v == nil || (finite(*v) && *v >= lo && *v <= hi)
}

func validFlags(flags []string) bool {
	if flags == nil || len(flags) > len(flagNames) {
		return false
	}
	seen := map[string]bool{}
	for _, f := range flags {
		if !flagNames[f] || seen[f] {
			return false
		}
		seen[f] = true
	}
	return true
}

func validRules(r *Rules) bool {
	if r == nil {
		return true
	}
	for _, n := range []int{r.GameMode, r.RuleSet, r.SessionLength} {
		if n < 0 || n > 255 {
			return false
		}
	}
	for _, n := range []int{r.SurfaceType, r.LowFuelMode, r.TyreTemperature, r.PitLaneTyreSim, r.ERSAssist, r.PitAssist, r.PitReleaseAssist} {
		if n < 0 || n > 1 {
			return false
		}
	}
	return r.PitStopExperience >= 0 && r.PitStopExperience <= 2
}

func ValidTyre(tyre string) bool {
	return tyre == "Soft" || tyre == "Medium" || tyre == "Hard" || tyre == "Inter" || tyre == "Wet"
}

func ValidateEvidence(e *Evidence) error {
	if e == nil {
		return nil
	}
	uid, err := strconv.ParseUint(e.SessionUID, 10, 64)
	c := e.Conditions
	if err != nil || uid == 0 || strconv.FormatUint(uid, 10) != e.SessionUID || e.Version != EvidenceVersion ||
		(c.PacketFormat != 2025 && c.PacketFormat != 2026) || c.TotalLaps < 1 || c.TotalLaps > MaxLaps ||
		c.TrackLengthM < 100 || c.TrackLengthM > 20000 || c.SessionType < 15 || c.SessionType > 17 ||
		!validRules(c.Rules) || !validFlags(e.Reasons) || len(e.Laps) > MaxLaps || len(e.Stops) > MaxStops {
		return ErrInvalidEvidence
	}
	for _, n := range []int{c.GameYear, c.GameMajor, c.GameMinor, c.Formula} {
		if n < 0 || n > 255 {
			return ErrInvalidEvidence
		}
	}
	if c.TeamID != nil && (*c.TeamID < 0 || *c.TeamID > 65535) {
		return ErrInvalidEvidence
	}
	last := 0
	for _, l := range e.Laps {
		if l.Number <= last || l.Number > c.TotalLaps || l.TimeMs < 1 || l.TimeMs > 900000 ||
			l.Compound < 0 || l.Compound > 255 || l.EndCompound < 0 || l.EndCompound > 255 ||
			l.TyreAge < 0 || l.TyreAge > MaxLaps || l.EndTyreAge < 0 || l.EndTyreAge > MaxLaps ||
			l.Stint < 0 || l.Stint > MaxStops+1 || l.SetupRevision < 0 || l.SetupRevision > 65535 ||
			l.Weather < 0 || l.Weather > 5 || l.TrackTemp < -30 || l.TrackTemp > 100 ||
			l.TractionControl < 0 || l.TractionControl > 2 || l.ABS < 0 || l.ABS > 1 ||
			(l.Tyre != "" && !ValidTyre(l.Tyre)) || !validFlags(l.Flags) ||
			!bounded(l.FuelKg, 0, 200) || !bounded(l.FuelEndKg, 0, 200) ||
			!bounded(l.ERSStartJ, 0, 20000000) || !bounded(l.ERSEndJ, 0, 20000000) ||
			(l.Energy != nil && len(l.Energy) != 3) {
			return ErrInvalidEvidence
		}
		var duration float64
		for _, s := range l.Energy {
			if !finite(s.DeployedJ) || !finite(s.HarvestedJ) || !finite(s.DurationMs) || !finite(s.MeanSpeedKph) ||
				s.DeployedJ < 0 || s.DeployedJ > 100000000 || s.HarvestedJ < 0 || s.HarvestedJ > 100000000 ||
				s.DurationMs < 0 || s.DurationMs > float64(l.TimeMs) || s.MeanSpeedKph < 0 || s.MeanSpeedKph > 500 {
				return ErrInvalidEvidence
			}
			duration += s.DurationMs
		}
		if duration > float64(l.TimeMs)+100 {
			return ErrInvalidEvidence
		}
		last = l.Number
	}
	previousOut := 0
	for _, s := range e.Stops {
		if s.InLap < 1 || s.InLap < previousOut || s.OutLap < s.InLap || s.OutLap > c.TotalLaps ||
			s.OutLap-s.InLap > 1 || s.LaneMs < 0 || s.LaneMs > 600000 || s.StationaryMs < 0 || s.StationaryMs > s.LaneMs {
			return ErrInvalidEvidence
		}
		previousOut = s.OutLap
	}
	data, err := json.Marshal(e)
	if err != nil || len(data) > MaxEvidenceBytes {
		return ErrInvalidEvidence
	}
	return nil
}

func ValidateRequest(r Request) error {
	if len(r.ContextID) != 32 || r.MaxStops < 0 || r.MaxStops > 2 || len(r.AvailableSets) < 1 || len(r.AvailableSets) > 5 {
		return ErrInvalidRequest
	}
	for _, ch := range r.ContextID {
		if !((ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f')) {
			return ErrInvalidRequest
		}
	}
	total := 0
	for tyre, n := range r.AvailableSets {
		if !ValidTyre(tyre) || n < 0 || n > 3 {
			return ErrInvalidRequest
		}
		total += n
	}
	if total == 0 {
		return ErrInvalidRequest
	}
	return nil
}
