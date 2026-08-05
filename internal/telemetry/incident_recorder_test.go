package telemetry

import (
	"math"
	"testing"

	"frc.engineer/internal/dto"
	"frc.engineer/internal/packets"
)

// incSim drives an incidentRecorder with synthetic packets on a 60Hz game-time
// axis (SessionTime = frame/60). Motion/telemetry/lapdata share the frame id,
// mirroring the real synchronized emission.
type incSim struct {
	t      *testing.T
	r      *incidentRecorder
	uid    uint64
	frame  uint32
	pos    map[int][3]float32 // vehicleIdx → world position (persists between steps)
	status map[int]uint8      // vehicleIdx → ResultStatus (persists; default 0 = inactive)
	speed  map[int]uint16
}

func newIncSim(t *testing.T) *incSim {
	s := &incSim{
		t:      t,
		r:      newIncidentRecorder(testLogger(), nil),
		uid:    777,
		pos:    make(map[int][3]float32),
		status: make(map[int]uint8),
		speed:  make(map[int]uint16),
	}
	s.r.observeSession(s.uid)
	return s
}

func (s *incSim) header(sessionTime float32) *packets.PacketHeader {
	return &packets.PacketHeader{
		SessionUID:      s.uid,
		SessionTime:     sessionTime,
		FrameIdentifier: s.frame,
		PlayerCarIndex:  0,
	}
}

// tick feeds one 60Hz frame at the given game time.
func (s *incSim) tick(sessionTime float32) {
	h := s.header(sessionTime)

	lap := &packets.PacketLapData{Header: *h}
	for idx, st := range s.status {
		lap.LapData[idx].ResultStatus = st
		lap.LapData[idx].CurrentLapNum = 3
	}
	s.r.noteLapData(lap)

	tel := &packets.PacketCarTelemetryData{Header: *h}
	for idx, sp := range s.speed {
		tel.CarTelemetryData[idx].Speed = sp
	}
	s.r.noteTelemetry(tel)

	m := &packets.PacketMotionData{Header: *h}
	for idx, p := range s.pos {
		m.CarMotionData[idx].WorldPositionX = p[0]
		m.CarMotionData[idx].WorldPositionY = p[1]
		m.CarMotionData[idx].WorldPositionZ = p[2]
	}
	s.r.noteMotion(m, h)
	s.frame++
}

// run feeds 60Hz ticks over [from, to) game seconds.
func (s *incSim) run(from, to float32) {
	for t := from; t < to; t += 1.0 / 60.0 {
		s.tick(t)
	}
}

func (s *incSim) collide(sessionTime float32, v1, v2 uint8) {
	s.r.onCollision(s.header(sessionTime), v1, v2)
}

func (s *incSim) clips() []dto.IncidentClip {
	return s.r.snapshot(s.uid)
}

func participantIdxs(c dto.IncidentClip) []int {
	out := make([]int, len(c.Participants))
	for i, p := range c.Participants {
		out[i] = p.Idx
	}
	return out
}

func hasParticipant(c dto.IncidentClip, idx int) bool {
	for _, p := range c.Participants {
		if p.Idx == idx {
			return true
		}
	}
	return false
}

func TestIncidentRecorderCapturesBasicClip(t *testing.T) {
	s := newIncSim(t)
	// 플레이어(0)와 파트너(1)는 5m, 근접 활성차(2)는 20m, 활성이지만 먼 차(3)는 200m,
	// 좌표상 가깝지만 비활성(status 0)인 슬롯(4)은 제외되어야 한다.
	s.pos[0] = [3]float32{100, 0, 100}
	s.pos[1] = [3]float32{105, 0, 100}
	s.pos[2] = [3]float32{100, 0, 120}
	s.pos[3] = [3]float32{300, 0, 100}
	s.pos[4] = [3]float32{101, 0, 100}
	s.status[0], s.status[1], s.status[2], s.status[3] = 2, 2, 2, 2
	s.speed[0] = 250

	s.run(0, 2.0)
	s.collide(2.0, 0, 1)
	s.run(2.0, 3.3) // post 1초 + 데드라인 여유

	clips := s.clips()
	if len(clips) != 1 {
		t.Fatalf("clips = %d, want 1", len(clips))
	}
	c := clips[0]
	if c.SessionTimeMS != 2000 || c.WindowStartMS != 1000 {
		t.Fatalf("window = [%d, t0 %d], want [1000, 2000]", c.WindowStartMS, c.SessionTimeMS)
	}
	// 20Hz 다운샘플: 2초 윈도우면 60Hz 원본 ~120틱이 아니라 ~41프레임이어야 한다.
	if len(c.Frames) < 35 || len(c.Frames) > 45 {
		t.Fatalf("frames = %d, want ~41 (20Hz downsample)", len(c.Frames))
	}
	want := []int{0, 1, 2} // 플레이어 → 파트너 → 근접 활성차
	got := participantIdxs(c)
	if len(got) != len(want) {
		t.Fatalf("participants = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("participants = %v, want %v", got, want)
		}
	}
	if !c.Participants[0].IsPlayer || c.Participants[0].MinDistM != 0 {
		t.Fatalf("player participant = %+v", c.Participants[0])
	}
	if d := c.Participants[1].MinDistM; d < 4.9 || d > 5.1 {
		t.Fatalf("partner minDist = %v, want ~5", d)
	}
	if c.Lap != 3 {
		t.Fatalf("lap = %d, want 3", c.Lap)
	}
	// car-frame은 고정 14값이고 speedKmh(인덱스 9)가 전달된다.
	f := c.Frames[0]
	if len(f.Cars) != 3 || len(f.Cars[0]) != dto.IncidentCarFrameValues {
		t.Fatalf("frame shape = %d cars / %d values", len(f.Cars), len(f.Cars[0]))
	}
	if f.Cars[0][9] != 250 {
		t.Fatalf("player speed = %v, want 250", f.Cars[0][9])
	}
}

func TestIncidentRecorderSessionStartPartialWindow(t *testing.T) {
	s := newIncSim(t)
	s.pos[0] = [3]float32{0, 0, 0}
	s.pos[1] = [3]float32{3, 0, 0}
	s.status[0], s.status[1] = 2, 2

	s.run(0, 0.3)
	s.collide(0.3, 1, 0) // 플레이어가 Vehicle2 쪽인 경우도 트리거
	s.run(0.3, 1.6)

	clips := s.clips()
	if len(clips) != 1 {
		t.Fatalf("clips = %d, want 1", len(clips))
	}
	c := clips[0]
	if c.WindowStartMS != 0 {
		t.Fatalf("windowStart = %d, want 0 (clamped)", c.WindowStartMS)
	}
	// pre 구간은 있는 만큼(~0.3s ≈ 6프레임) + post 1s ≈ 20프레임
	if len(c.Frames) < 20 || len(c.Frames) > 32 {
		t.Fatalf("frames = %d, want partial-window ~26", len(c.Frames))
	}
}

func TestIncidentRecorderForcedPartnerAndDiveBomb(t *testing.T) {
	s := newIncSim(t)
	s.pos[0] = [3]float32{0, 0, 0}
	s.pos[1] = [3]float32{60, 0, 0}  // 파트너인데 60m — 반경 밖이어도 강제 포함
	s.pos[2] = [3]float32{80, 0, 0}  // 다이브밤: 접근해서 반경 안으로
	s.pos[3] = [3]float32{-60, 0, 0} // 비파트너 60m — 제외
	s.status[0], s.status[1], s.status[2], s.status[3] = 2, 2, 2, 2

	s.run(0, 1.0)
	// 1.0s~2.0s 동안 차 2가 80m → 4m로 접근
	for tt := float32(1.0); tt < 2.0; tt += 1.0 / 60.0 {
		s.pos[2] = [3]float32{80 - (tt-1.0)*76, 0, 0}
		s.tick(tt)
	}
	s.collide(2.0, 0, 1)
	s.run(2.0, 3.3)

	clips := s.clips()
	if len(clips) != 1 {
		t.Fatalf("clips = %d, want 1", len(clips))
	}
	c := clips[0]
	if !hasParticipant(c, 1) {
		t.Fatalf("forced partner missing: %v", participantIdxs(c))
	}
	if !hasParticipant(c, 2) {
		t.Fatalf("dive-bomb car missing: %v", participantIdxs(c))
	}
	if hasParticipant(c, 3) {
		t.Fatalf("far non-partner included: %v", participantIdxs(c))
	}
}

func TestIncidentRecorderPerSampleStatusKeepsMidWindowRetiree(t *testing.T) {
	s := newIncSim(t)
	s.pos[0] = [3]float32{0, 0, 0}
	s.pos[1] = [3]float32{2, 0, 0}
	s.pos[2] = [3]float32{10, 0, 0} // 비파트너: 윈도우 중 리타이어(2→7)
	s.status[0], s.status[1], s.status[2] = 2, 2, 2

	s.run(0, 2.0)
	s.collide(2.0, 0, 1)
	s.status[2] = 7 // 충돌 직후 리타이어
	s.run(2.0, 3.3)

	clips := s.clips()
	if len(clips) != 1 {
		t.Fatalf("clips = %d, want 1", len(clips))
	}
	if !hasParticipant(clips[0], 2) {
		t.Fatalf("mid-window retiree dropped (per-sample status broken): %v", participantIdxs(clips[0]))
	}
}

func TestIncidentRecorderParticipantCap(t *testing.T) {
	s := newIncSim(t)
	s.pos[0] = [3]float32{0, 0, 0}
	s.status[0] = 2
	// 12대가 서로 다른 거리(2m..24m)로 반경 안에 존재 → 플레이어 포함 10대만 유지
	for i := 1; i <= 12; i++ {
		s.pos[i] = [3]float32{float32(2 * i), 0, 0}
		s.status[i] = 2
	}
	s.run(0, 2.0)
	s.collide(2.0, 0, 1)
	s.run(2.0, 3.3)

	clips := s.clips()
	if len(clips) != 1 {
		t.Fatalf("clips = %d, want 1", len(clips))
	}
	c := clips[0]
	if len(c.Participants) != incidentMaxParticipants {
		t.Fatalf("participants = %d, want %d", len(c.Participants), incidentMaxParticipants)
	}
	// 가장 먼 11, 12번이 잘려야 한다
	if hasParticipant(c, 11) || hasParticipant(c, 12) {
		t.Fatalf("farthest cars not trimmed: %v", participantIdxs(c))
	}
}

func TestIncidentRecorderMergeDebounceAndClamp(t *testing.T) {
	s := newIncSim(t)
	s.pos[0] = [3]float32{0, 0, 0}
	s.pos[1] = [3]float32{3, 0, 0}
	s.pos[2] = [3]float32{6, 0, 0}
	s.status[0], s.status[1], s.status[2] = 2, 2, 2

	s.run(0, 2.0)
	s.collide(2.0, 0, 1)
	s.run(2.0, 2.5)
	s.collide(2.5, 0, 1) // 동일 페어 1s 이내 → 완전 무시
	s.collide(2.5, 0, 2) // 다른 페어 → 병합 + 연장 (end = 3.5)
	s.run(2.5, 3.2)      // 원래 end(3.0)를 지나도 연장 때문에 계속 수집
	s.run(3.2, 4.8)      // end 3.5 경과 → finalize

	clips := s.clips()
	if len(clips) != 1 {
		t.Fatalf("clips = %d, want 1 merged clip", len(clips))
	}
	c := clips[0]
	if len(c.Collisions) != 2 {
		t.Fatalf("collisions = %v, want 2 (debounced duplicate excluded)", c.Collisions)
	}
	// 연장 확인: 마지막 프레임이 3.0s(비연장 종료) 이후여야 한다
	last := c.Frames[len(c.Frames)-1].TMS
	if last < 3050 {
		t.Fatalf("last frame = %dms, want >3050 (window extended)", last)
	}
	// 5s clamp: 총 윈도우는 hardEnd(1.0+5.0=6.0s)를 넘지 않는다
	if last > 6000 {
		t.Fatalf("last frame = %dms, exceeds 5s merged cap", last)
	}
}

func TestIncidentRecorderNewClipAfterWindowCloses(t *testing.T) {
	s := newIncSim(t)
	s.pos[0] = [3]float32{0, 0, 0}
	s.pos[1] = [3]float32{3, 0, 0}
	s.pos[2] = [3]float32{6, 0, 0}
	s.status[0], s.status[1], s.status[2] = 2, 2, 2

	s.run(0, 2.0)
	s.collide(2.0, 0, 1)
	s.run(2.0, 5.0) // 윈도우 종료(3.0) 후 한참 지남
	s.collide(5.0, 0, 2)
	s.run(5.0, 6.3)

	clips := s.clips()
	if len(clips) != 2 {
		t.Fatalf("clips = %d, want 2 separate clips", len(clips))
	}
	if clips[1].SessionTimeMS != 5000 {
		t.Fatalf("second clip t0 = %d, want 5000", clips[1].SessionTimeMS)
	}
}

func TestIncidentRecorderFlashbackAndRewindDiscard(t *testing.T) {
	// FLBK 이벤트 경로
	s := newIncSim(t)
	s.pos[0] = [3]float32{0, 0, 0}
	s.pos[1] = [3]float32{3, 0, 0}
	s.status[0], s.status[1] = 2, 2
	s.run(0, 2.0)
	s.collide(2.0, 0, 1)
	s.run(2.0, 2.4)
	s.r.onFlashback()
	s.run(2.4, 4.0)
	if got := s.clips(); len(got) != 0 {
		t.Fatalf("clips after flashback = %d, want 0", len(got))
	}

	// SessionTime 되감기 일반화 가드 경로 (FLBK 이벤트 유실 가정)
	s2 := newIncSim(t)
	s2.pos[0] = [3]float32{0, 0, 0}
	s2.pos[1] = [3]float32{3, 0, 0}
	s2.status[0], s2.status[1] = 2, 2
	s2.run(0, 3.0)
	s2.collide(3.0, 0, 1)
	s2.run(3.0, 3.4)
	s2.run(1.0, 1.5) // 게임 시간이 3.4 → 1.0으로 후퇴
	if got := s2.clips(); len(got) != 0 {
		t.Fatalf("clips after rewind = %d, want 0", len(got))
	}
}

func TestIncidentRecorderSessionChangeResets(t *testing.T) {
	s := newIncSim(t)
	s.pos[0] = [3]float32{0, 0, 0}
	s.pos[1] = [3]float32{3, 0, 0}
	s.status[0], s.status[1] = 2, 2
	s.run(0, 2.0)
	s.collide(2.0, 0, 1)
	s.run(2.0, 3.3)
	if got := s.clips(); len(got) != 1 {
		t.Fatalf("precondition clips = %d, want 1", len(got))
	}

	oldUID := s.uid
	s.r.observeSession(888)
	if got := s.r.snapshot(oldUID); got != nil {
		t.Fatalf("old-session snapshot = %d clips, want nil", len(got))
	}
	if got := s.r.snapshot(888); got != nil {
		t.Fatalf("new-session snapshot = %d clips, want nil", len(got))
	}
}

func TestIncidentRecorderIgnoresNonPlayerAndDegenerate(t *testing.T) {
	s := newIncSim(t)
	s.pos[0] = [3]float32{0, 0, 0}
	s.status[0] = 2
	s.run(0, 1.0)

	s.collide(1.0, 2, 3)  // 플레이어 미연루
	s.collide(1.0, 1, 1)  // 퇴화(v1==v2)
	s.collide(1.0, 30, 0) // 인덱스 범위 밖
	badHeader := s.header(1.0)
	badHeader.PlayerCarIndex = 255 // 관전 sentinel
	s.r.onCollision(badHeader, 255, 3)

	s.run(1.0, 2.5)
	if got := s.clips(); len(got) != 0 {
		t.Fatalf("clips = %d, want 0 (all triggers invalid)", len(got))
	}
}

func TestIncidentRecorderNaNFrameNulledOut(t *testing.T) {
	s := newIncSim(t)
	s.pos[0] = [3]float32{0, 0, 0}
	s.pos[1] = [3]float32{3, 0, 0}
	s.status[0], s.status[1] = 2, 2
	s.run(0, 2.0)
	s.collide(2.0, 0, 1)
	// 한 틱 동안 파트너 좌표가 NaN — 해당 프레임의 파트너 열만 null이어야 한다
	s.pos[1] = [3]float32{float32(math.NaN()), 0, 0}
	s.run(2.0, 2.1)
	s.pos[1] = [3]float32{3, 0, 0}
	s.run(2.1, 3.3)

	clips := s.clips()
	if len(clips) != 1 {
		t.Fatalf("clips = %d, want 1", len(clips))
	}
	c := clips[0]
	col := -1
	for j, p := range c.Participants {
		if p.Idx == 1 {
			col = j
		}
	}
	if col < 0 {
		t.Fatalf("partner missing: %v", participantIdxs(c))
	}
	sawNull, sawValue := false, false
	for _, f := range c.Frames {
		if col < len(f.Cars) && f.Cars[col] == nil {
			sawNull = true
		} else if col < len(f.Cars) && f.Cars[col] != nil {
			sawValue = true
		}
	}
	if !sawNull || !sawValue {
		t.Fatalf("NaN tick nulling: sawNull=%v sawValue=%v", sawNull, sawValue)
	}
}

func TestIncidentRecorderClipCap(t *testing.T) {
	s := newIncSim(t)
	s.pos[0] = [3]float32{0, 0, 0}
	s.pos[1] = [3]float32{3, 0, 0}
	s.pos[2] = [3]float32{6, 0, 0}
	s.status[0], s.status[1], s.status[2] = 2, 2, 2

	tt := float32(0)
	s.run(tt, 1.5)
	tt = 1.5
	for n := 0; n < incidentMaxClipsPerSession+1; n++ {
		partner := uint8(1 + n%2) // 페어 디바운스 회피용 교대
		s.collide(tt, 0, partner)
		s.run(tt, tt+2.5) // 윈도우 완전 종료 후 다음 충돌
		tt += 2.5
	}
	clips := s.clips()
	if len(clips) != incidentMaxClipsPerSession {
		t.Fatalf("clips = %d, want cap %d", len(clips), incidentMaxClipsPerSession)
	}
}

func TestIncidentRecorderSnapshotEarlyFinalizeNonDestructive(t *testing.T) {
	s := newIncSim(t)
	s.pos[0] = [3]float32{0, 0, 0}
	s.pos[1] = [3]float32{3, 0, 0}
	s.status[0], s.status[1] = 2, 2
	s.run(0, 2.0)
	s.collide(2.0, 0, 1)
	s.run(2.0, 2.3) // post 윈도우 미완 — 레이스 종료 조기 확정 시나리오

	first := s.clips()
	if len(first) != 1 {
		t.Fatalf("early snapshot clips = %d, want 1 (partial post window)", len(first))
	}
	second := s.clips()
	if len(second) != 1 || len(second[0].Frames) != len(first[0].Frames) {
		t.Fatalf("snapshot not idempotent: first %d frames, second %v", len(first[0].Frames), second)
	}
}

func TestIncidentRecorderStaleTelemetryIgnored(t *testing.T) {
	s := newIncSim(t)
	s.pos[0] = [3]float32{0, 0, 0}
	s.pos[1] = [3]float32{3, 0, 0}
	s.status[0], s.status[1] = 2, 2
	s.speed[0] = 300

	// telemetry를 한 번만 먹이고 프레임을 60 이상 전진 → 캐시 구식화
	h := s.header(0)
	tel := &packets.PacketCarTelemetryData{Header: *h}
	tel.CarTelemetryData[0].Speed = 300
	s.r.noteTelemetry(tel)
	s.frame = 100 // 100프레임(≈1.67s) 뒤에서 시작

	for tt := float32(1.7); tt < 3.7; tt += 1.0 / 60.0 {
		hh := s.header(tt)
		lap := &packets.PacketLapData{Header: *hh}
		lap.LapData[0].ResultStatus = 2
		lap.LapData[1].ResultStatus = 2
		s.r.noteLapData(lap)
		m := &packets.PacketMotionData{Header: *hh}
		m.CarMotionData[0].WorldPositionX = 0
		m.CarMotionData[1].WorldPositionX = 3
		s.r.noteMotion(m, hh)
		s.frame++
	}
	s.collide(3.7, 0, 1)
	for tt := float32(3.7); tt < 5.0; tt += 1.0 / 60.0 {
		hh := s.header(tt)
		m := &packets.PacketMotionData{Header: *hh}
		m.CarMotionData[0].WorldPositionX = 0
		m.CarMotionData[1].WorldPositionX = 3
		s.r.noteMotion(m, hh)
		s.frame++
	}

	clips := s.clips()
	if len(clips) != 1 {
		t.Fatalf("clips = %d, want 1", len(clips))
	}
	// 구식 telemetry의 speed 300이 "현재"로 저장되면 안 된다 (인덱스 9 == 0)
	for _, f := range clips[0].Frames {
		if f.Cars[0] != nil && f.Cars[0][9] != 0 {
			t.Fatalf("stale telemetry leaked: speed = %v", f.Cars[0][9])
		}
	}
}
