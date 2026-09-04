package races

import (
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

func TestProjectIncidentParticipantsKeepsPlayerPartnersAndColumns(t *testing.T) {
	// 10대: 플레이어(0) + 파트너(7, 거리 5번째) + 일반 8대
	clip := buildTestClip(0, []int{7}, []int{1, 2, 3, 4, 5, 6, 8, 9}, 4)
	// 파트너를 거리순 중간으로 재배치해 우선순위가 거리보다 앞서는지 확인
	// (buildTestClip은 파트너를 두 번째에 두므로 뒤로 밀어 재구성)
	clip.Participants[1], clip.Participants[5] = clip.Participants[5], clip.Participants[1]
	for f := range clip.Frames {
		clip.Frames[f].Cars[1], clip.Frames[f].Cars[5] = clip.Frames[f].Cars[5], clip.Frames[f].Cars[1]
	}

	out := projectIncidentParticipants(clip, 6)
	if len(out.Participants) != 6 {
		t.Fatalf("participants = %d, want 6", len(out.Participants))
	}
	if !out.Participants[0].IsPlayer {
		t.Fatalf("player not first: %+v", out.Participants[0])
	}
	if out.Participants[1].Idx != 7 {
		t.Fatalf("partner not prioritized: second = %+v", out.Participants[1])
	}
	// 모든 프레임에서 cars[j][0] == participants[j].Idx (열 정합)
	for fi, f := range out.Frames {
		if len(f.Cars) != 6 {
			t.Fatalf("frame %d cars = %d, want 6", fi, len(f.Cars))
		}
		for j, car := range f.Cars {
			if car == nil {
				t.Fatalf("frame %d col %d unexpectedly nil", fi, j)
			}
			if int(car[0]) != out.Participants[j].Idx {
				t.Fatalf("frame %d col %d = idx %v, want %d (column misaligned)", fi, j, car[0], out.Participants[j].Idx)
			}
		}
	}
	// 원본 불변
	if len(clip.Participants) != 10 || len(clip.Frames[0].Cars) != 10 {
		t.Fatalf("input clip mutated")
	}
	if len(clip.Collisions) != 1 || clip.Collisions[0] != [2]int{0, 7} {
		t.Fatalf("input collisions mutated: %v", clip.Collisions)
	}
}

func TestProjectIncidentParticipantsPartnerOverflow(t *testing.T) {
	// 플레이어 + 파트너 7대 → 6대 상한이면 플레이어 + 가까운 파트너 5대만
	clip := buildTestClip(0, []int{1, 2, 3, 4, 5, 6, 7}, nil, 2)
	out := projectIncidentParticipants(clip, 6)
	if len(out.Participants) != 6 {
		t.Fatalf("participants = %d, want 6", len(out.Participants))
	}
	want := []int{0, 1, 2, 3, 4, 5} // 플레이어 + 가까운 순 파트너 5
	for j, p := range out.Participants {
		if p.Idx != want[j] {
			t.Fatalf("participants[%d] = %d, want %d", j, p.Idx, want[j])
		}
	}
}

func TestProjectIncidentParticipantsPreservesFreshnessAlignment(t *testing.T) {
	clip := buildTestClip(0, []int{1}, []int{2, 3, 4, 5, 6, 7, 8, 9}, 1)
	capturedParticipants, capturedFrames := len(clip.Participants), len(clip.Frames)
	clip.Completeness = dto.IncidentCompleteness{
		Status:                   dto.AvailabilityComplete,
		Reasons:                  []dto.CompletenessReason{},
		CapturedParticipantCount: &capturedParticipants,
		StoredParticipantCount:   capturedParticipants,
		CapturedFrameCount:       &capturedFrames,
		StoredFrameCount:         capturedFrames,
	}
	// 8 is trimmed out below. The retained frame must not advertise an index for
	// which it no longer has a Cars column, while genuine 0-valued inputs stay a
	// separate concern from this freshness list.
	clip.Frames[0].TelemetryUnavailable = []int{0, 1, 8}

	out := projectIncidentParticipants(clip, 6)
	if got, want := out.Frames[0].TelemetryUnavailable, []int{0, 1}; len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("telemetryUnavailable = %v, want %v after participant projection", got, want)
	}
	if len(out.Collisions) != 1 || out.Collisions[0] != [2]int{0, 1} {
		t.Fatalf("projected collisions = %v, want retained player pair", out.Collisions)
	}
	if out.Completeness.StoredParticipantCount != 6 || out.Completeness.StoredFrameCount != 1 ||
		!containsCompletenessReason(out.Completeness.Reasons, dto.ReasonUploadParticipantsTrimmed) {
		t.Fatalf("projected completeness = %+v", out.Completeness)
	}
	if len(clip.Completeness.Reasons) != 0 {
		t.Fatalf("input completeness reasons mutated: %v", clip.Completeness.Reasons)
	}
}

func TestTrimIncidentsSmallInputPassthrough(t *testing.T) {
	clips := []dto.IncidentClip{buildTestClip(0, []int{1}, []int{2}, 41)}
	out, dropped := TrimIncidentsForUpload(clips)
	if dropped != 0 || len(out) != 1 || len(out[0].Participants) != 3 {
		t.Fatalf("small input modified: dropped=%d out=%d participants=%d", dropped, len(out), len(out[0].Participants))
	}
}

func TestTrimIncidentsForUploadConvergesUnderBudget(t *testing.T) {
	// 워스트 근사: 20클립 × 10대 × 101프레임 (~2MB) → 예산 수렴 필수
	var clips []dto.IncidentClip
	for range 20 {
		clips = append(clips, buildTestClip(0, []int{1}, []int{2, 3, 4, 5, 6, 7, 8, 9}, 101))
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
	// 6대 재투영이 적용되었고 파트너는 살아남았다
	for i := range out {
		if len(out[i].Participants) != 6 {
			t.Fatalf("clip %d participants = %d, want 6", i, len(out[i].Participants))
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
