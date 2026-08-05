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
)

// TrimIncidentsForUpload fits clips to the upload budget without mutating the
// input. Deterministic, no size sorting: when over budget it first re-projects
// every clip to its nearest incidentTrimmedParticipants cars (player and
// collision partners keep priority), then drops whole clips from the end
// (newest first) until the serialized block fits. droppedClips reports how many
// whole clips were removed so callers can log.
func TrimIncidentsForUpload(clips []dto.IncidentClip) (out []dto.IncidentClip, droppedClips int) {
	if len(clips) == 0 {
		return nil, 0
	}
	if serializedIncidentsSize(clips) <= incidentUploadBudgetBytes {
		return clips, 0
	}
	trimmed := make([]dto.IncidentClip, len(clips))
	for i := range clips {
		trimmed[i] = projectIncidentParticipants(clips[i], incidentTrimmedParticipants)
	}
	for len(trimmed) > 0 && serializedIncidentsSize(trimmed) > incidentUploadBudgetBytes {
		trimmed = trimmed[:len(trimmed)-1]
		droppedClips++
	}
	return trimmed, droppedClips
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
	out.Frames = make([]dto.IncidentFrame, len(clip.Frames))
	for i, f := range clip.Frames {
		cars := make([][]float64, len(kept))
		for newJ, oldJ := range kept {
			if oldJ < len(f.Cars) {
				cars[newJ] = f.Cars[oldJ]
			}
		}
		out.Frames[i] = dto.IncidentFrame{TMS: f.TMS, Cars: cars}
	}
	return out
}
