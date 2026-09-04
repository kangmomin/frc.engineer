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
	incidentUploadBudgetBytes   = 300 * 1024
	incidentTrimmedParticipants = 6
	incidentStoredCap           = 20
)

// IncidentTrimFacts reports transformations that affect v2 completeness. It
// intentionally distinguishes participant projection from whole-clip drops:
// both retain usable data, but mean different things to a replay reader.
type IncidentTrimFacts struct {
	DroppedClips        int
	ParticipantsTrimmed bool
}

// TrimIncidentsForUpload fits clips to the upload budget without mutating the
// input. Deterministic, no size sorting: when over budget it first re-projects
// every clip to its nearest incidentTrimmedParticipants cars (player and
// collision partners keep priority), then drops whole clips from the end
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
	trimmed := make([]dto.IncidentClip, len(clips))
	for i := range clips {
		if len(clips[i].Participants) > incidentTrimmedParticipants {
			facts.ParticipantsTrimmed = true
		}
		trimmed[i] = projectIncidentParticipants(clips[i], incidentTrimmedParticipants)
	}
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

// projectIncidentParticipants returns a copy of clip narrowed to at most k
// participants, preserving column alignment in every frame. Priority: the
// player, then collision partners, then the rest — each group keeping the
// builder's nearest-first order, so an oversized partner set keeps its nearest
// members. The input clip is never mutated (frames get fresh Cars slices; the
// innermost value arrays are shared, which is safe because nothing writes them).
func projectIncidentParticipants(clip dto.IncidentClip, k int) dto.IncidentClip {
	if len(clip.Participants) <= k {
		return clip
	}

	partner := make(map[int]bool, len(clip.Collisions)*2)
	for _, pair := range clip.Collisions {
		partner[pair[0]] = true
		partner[pair[1]] = true
	}
	rank := func(p dto.IncidentParticipant) int {
		switch {
		case p.IsPlayer:
			return 0
		case partner[p.Idx]:
			return 1
		default:
			return 2
		}
	}

	// Stable two-pass pick: keep original (nearest-first) order within each rank.
	kept := make([]int, 0, k)
	for r := 0; r <= 2 && len(kept) < k; r++ {
		for j, p := range clip.Participants {
			if rank(p) == r {
				kept = append(kept, j)
				if len(kept) == k {
					break
				}
			}
		}
	}

	out := clip
	out.Participants = make([]dto.IncidentParticipant, len(kept))
	for newJ, oldJ := range kept {
		out.Participants[newJ] = clip.Participants[oldJ]
	}
	keptIDs := make(map[int]struct{}, len(out.Participants))
	for _, participant := range out.Participants {
		keptIDs[participant.Idx] = struct{}{}
	}
	// v2 requires collision identities to remain valid participant ids. A
	// recorder-originated collision always includes the player, which is ranked
	// first, so this retains at least the nearest collision pair while honestly
	// dropping pairs whose partner could not fit the upload projection.
	out.Collisions = make([][2]int, 0, len(clip.Collisions))
	for _, pair := range clip.Collisions {
		_, left := keptIDs[pair[0]]
		_, right := keptIDs[pair[1]]
		if left && right {
			out.Collisions = append(out.Collisions, pair)
		}
	}
	out.Frames = make([]dto.IncidentFrame, len(clip.Frames))
	for i, f := range clip.Frames {
		cars := make([][]float64, len(kept))
		for newJ, oldJ := range kept {
			if oldJ < len(f.Cars) {
				cars[newJ] = f.Cars[oldJ]
			}
		}
		unavailable := make([]int, 0, len(f.TelemetryUnavailable))
		for _, idx := range f.TelemetryUnavailable {
			if _, ok := keptIDs[idx]; ok {
				unavailable = append(unavailable, idx)
			}
		}
		out.Frames[i] = dto.IncidentFrame{TMS: f.TMS, Cars: cars, TelemetryUnavailable: unavailable}
	}
	if out.Completeness.CapturedParticipantCount != nil || out.Completeness.CapturedFrameCount != nil {
		out.Completeness.Reasons = append([]dto.CompletenessReason(nil), out.Completeness.Reasons...)
		out.Completeness.StoredParticipantCount = len(out.Participants)
		out.Completeness.StoredFrameCount = len(out.Frames)
		out.Completeness.Status = dto.AvailabilityPartial
		out.Completeness.Reasons = appendReason(out.Completeness.Reasons, dto.ReasonUploadParticipantsTrimmed)
	}
	return out
}

func appendReason(reasons []dto.CompletenessReason, want dto.CompletenessReason) []dto.CompletenessReason {
	for _, reason := range reasons {
		if reason == want {
			return reasons
		}
	}
	return append(reasons, want)
}
