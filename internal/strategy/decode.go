package strategy

import "encoding/json"

// Missing physics settings or lap metadata are unknown, not a reported zero.
// Pointer-valued measurements retain their explicit null/unknown semantics.
func decodeKnown(data []byte, target any, required ...string) error {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	for _, name := range required {
		value, ok := fields[name]
		if !ok || string(value) == "null" {
			return ErrInvalidEvidence
		}
	}
	return json.Unmarshal(data, target)
}

func (r *Rules) UnmarshalJSON(data []byte) error {
	type plain Rules
	return decodeKnown(data, (*plain)(r), "equalPerformance", "gameMode", "ruleSet", "sessionLength", "surfaceType", "lowFuelMode", "tyreTemperature", "pitLaneTyreSim", "ersAssist", "pitAssist", "pitReleaseAssist", "pitStopExperience")
}

func (c *Conditions) UnmarshalJSON(data []byte) error {
	type plain Conditions
	return decodeKnown(data, (*plain)(c), "packetFormat", "gameYear", "gameMajor", "gameMinor", "formula", "sessionType", "totalLaps", "trackLengthM")
}

func (l *Lap) UnmarshalJSON(data []byte) error {
	type plain Lap
	return decodeKnown(data, (*plain)(l), "number", "timeMs", "compound", "tyre", "tyreAge", "endCompound", "endTyreAge", "stint", "setupRevision", "weather", "trackTemp", "tractionControl", "abs", "flags")
}
