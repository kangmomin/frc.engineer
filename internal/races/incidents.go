package races

import (
	"encoding/json"

	"frc.engineer/internal/dto"
)

// Upload-path budget for the serialized incidents block. The platform request cap
// is 512 KiB (cmd/platform uploadMaxBytes) and the existing worst-case
// laps+setup+detail is ~130KB, so 300KB keeps a comfortable margin. Local
// summaries keep the untrimmed original — trimming shapes only what rides the
// upload. Lives in races (not cmd/sender) so the serialization-budget test can
// exercise the exact production trim.
const (
	incidentUploadBudgetBytes = 300 * 1024
	incidentStoredCap         = 20
)

// IncidentTrimFacts reports transformations that affect v2 completeness. It
// intentionally distinguishes participant projection from whole-clip drops:
// both retain usable data, but mean different things to a replay reader.
type IncidentTrimFacts struct {
	DroppedClips        int
	ParticipantsTrimmed bool // Legacy fact; new uploads preserve every retained car.
}

// TrimIncidentsForUpload fits clips to the upload budget without mutating the
// input. Deterministic, no size sorting: when over budget, it preserves all
// nearby cars and drops whole clips from the end
// (newest first) until the serialized block fits. droppedClips reports how many
// whole clips were removed so callers can log.
func TrimIncidentsForUpload(clips []dto.IncidentClip) (out []dto.IncidentClip, droppedClips int) {
	out, facts := TrimIncidentsForUploadWithFacts(clips)
	return out, facts.DroppedClips
}

// TrimIncidentsForUploadWithFacts is the v2-aware form of
// TrimIncidentsForUpload. It preserves the public legacy signature above while
// giving the uploader exact post-trim facts for completeness metadata.
func TrimIncidentsForUploadWithFacts(clips []dto.IncidentClip) (out []dto.IncidentClip, facts IncidentTrimFacts) {
	if len(clips) == 0 {
		return nil, facts
	}
	if serializedIncidentsSize(clips) <= incidentUploadBudgetBytes {
		return clips, facts
	}
	trimmed := clips
	for len(trimmed) > 0 && serializedIncidentsSize(trimmed) > incidentUploadBudgetBytes {
		trimmed = trimmed[:len(trimmed)-1]
		facts.DroppedClips++
	}
	return trimmed, facts
}

// serializedIncidentsSize measures the JSON size of the block. A marshal error
// (impossible for sanitized clips) reads as "over any budget" so the caller
// keeps dropping instead of uploading something unmarshalable.
func serializedIncidentsSize(clips []dto.IncidentClip) int {
	raw, err := json.Marshal(clips)
	if err != nil {
		return incidentUploadBudgetBytes + 1
	}
	return len(raw)
}

func appendReason(reasons []dto.CompletenessReason, want dto.CompletenessReason) []dto.CompletenessReason {
	for _, reason := range reasons {
		if reason == want {
			return reasons
		}
	}
	return append(reasons, want)
}
