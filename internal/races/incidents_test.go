package races

import (
	"bytes"
	"encoding/json"
	"math"
	"testing"

	"frc.engineer/internal/dto"
)

// buildTestClip creates a clip whose car-frame arrays are tagged with the
// participant's vehicle index in value[0], so column re-projection is checkable.
func buildTestClip(playerIdx int, partnerIdxs []int, otherIdxs []int, frames int) dto.IncidentClip {
	partner := make(map[int]bool, len(partnerIdxs))
	var collisions [][2]int
	for _, idx := range partnerIdxs {
		partner[idx] = true
		collisions = append(collisions, [2]int{playerIdx, idx})
	}

	clip := dto.IncidentClip{
		SessionTimeMS:   10_000,
		WindowStartMS:   9_000,
		FrameIntervalMS: 50,
		Lap:             3,
		Collisions:      collisions,
	}
	// participants: 플레이어 먼저, 이후 가까운 순(파트너/일반 섞임 — minDist로 표현)
	clip.Participants = append(clip.Participants, dto.IncidentParticipant{Idx: playerIdx, IsPlayer: true, MinDistM: 0})
	dist := 1.0
	all := append(append([]int(nil), partnerIdxs...), otherIdxs...)
	for _, idx := range all {
		clip.Participants = append(clip.Participants, dto.IncidentParticipant{Idx: idx, MinDistM: dist})
		dist += 1.0
	}

	for f := range frames {
		cars := make([][]float64, len(clip.Participants))
		for j, p := range clip.Participants {
			vals := make([]float64, dto.IncidentCarFrameValues)
			vals[0] = float64(p.Idx) // 열 정합 태그
			vals[1] = 1234.56
			vals[9] = 287
			cars[j] = vals
		}
		clip.Frames = append(clip.Frames, dto.IncidentFrame{TMS: int64(9_000 + 50*f), Cars: cars})
	}
	return clip
}

func TestTrimIncidentsSmallInputPassthrough(t *testing.T) {
	clips := []dto.IncidentClip{buildTestClip(0, []int{1}, []int{2}, 41)}
	out, dropped := TrimIncidentsForUpload(clips)
	if dropped != 0 || len(out) != 1 || len(out[0].Participants) != 3 {
		t.Fatalf("small input modified: dropped=%d out=%d participants=%d", dropped, len(out), len(out[0].Participants))
	}
}

func TestTrimIncidentsForUploadConvergesUnderBudget(t *testing.T) {
	// 20 clips retain every car in each kept clip; only whole clips may be dropped.
	var clips []dto.IncidentClip
	for range 20 {
		clips = append(clips, worstIncidentClip(10_000+int64(len(clips))*10_000))
	}
	out, dropped := TrimIncidentsForUpload(clips)
	if size := serializedIncidentsSize(out); size > incidentUploadBudgetBytes {
		t.Fatalf("trimmed block = %d bytes, exceeds budget %d", size, incidentUploadBudgetBytes)
	}
	if len(out) == 0 {
		t.Fatalf("everything dropped — budget algorithm degenerate")
	}
	if dropped != 20-len(out) {
		t.Fatalf("droppedClips = %d, want %d", dropped, 20-len(out))
	}
	// 결정성: 뒤(최신)에서부터 잘리므로 남은 것은 앞쪽 prefix
	for i := range out {
		if out[i].SessionTimeMS != clips[i].SessionTimeMS {
			t.Fatalf("kept clips are not the chronological prefix")
		}
	}
	// No nearby car disappears as a side effect of the upload budget.
	for i := range out {
		if len(out[i].Participants) != 24 {
			t.Fatalf("clip %d participants = %d, want 24", i, len(out[i].Participants))
		}
		foundPartner := false
		for _, p := range out[i].Participants {
			if p.Idx == 1 {
				foundPartner = true
			}
		}
		if !foundPartner {
			t.Fatalf("clip %d lost its collision partner during trim", i)
		}
	}
}

func TestTrimIncidentsPreservesFullGridAndOriginal(t *testing.T) {
	clip := worstIncidentClip(10_000)
	// Mixed freshness is indexed by vehicle ID, not the participant column.
	clip.Frames[0].TelemetryUnavailable = []int{0, 23}
	clip.Frames[1].Cars[23] = nil
	clips := []dto.IncidentClip{clip}
	before, _ := json.Marshal(clips)
	out, facts := TrimIncidentsForUploadWithFacts(clips)
	after, _ := json.Marshal(out)
	if facts.DroppedClips != 0 || facts.ParticipantsTrimmed || !bytes.Equal(before, after) {
		t.Fatalf("full grid changed: facts=%+v bytes=%d", facts, len(after))
	}
	t.Logf("24 cars x 101 frames: %d bytes", len(after))
	for range 19 {
		clips = append(clips, worstIncidentClip(20_000))
	}
	before, _ = json.Marshal(clips)
	out, facts = TrimIncidentsForUploadWithFacts(clips)
	after, _ = json.Marshal(clips)
	if facts.DroppedClips == 0 || facts.ParticipantsTrimmed || !bytes.Equal(before, after) {
		t.Fatalf("budget trim mutated original or projected cars: %+v", facts)
	}
	for i := range out {
		if len(out[i].Participants) != 24 {
			t.Fatal("nearby cars removed")
		}
	}
}

func TestTrimIncidentsExtremeFiniteCoordinates(t *testing.T) {
	clip := worstIncidentClip(10_000)
	for i := range clip.Frames {
		for j := range clip.Frames[i].Cars {
			for k := 0; k < 9; k++ {
				clip.Frames[i].Cars[j][k] = -float64(math.MaxFloat32)
			}
		}
	}
	out, facts := TrimIncidentsForUploadWithFacts([]dto.IncidentClip{clip})
	if len(out) != 0 || facts.DroppedClips != 1 || facts.ParticipantsTrimmed {
		t.Fatalf("oversized clip not dropped whole: %+v", facts)
	}
}
