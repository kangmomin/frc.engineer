package telemetry

import (
	"fmt"
	"math"
	"testing"

	"frc.engineer/internal/dto"
	"frc.engineer/internal/packets"
)

// incSim drives an incidentRecorder with synthetic packets on a 60Hz game-time
// axis (SessionTime = frame/60). Motion/telemetry/lapdata share the frame id,
// mirroring the real synchronized emission.
type incSim struct {
	t             *testing.T
	r             *incidentRecorder
	uid           uint64
	format        uint16
	frame         uint32
	pos           map[int][3]float32 // vehicleIdx → world position (persists between steps)
	status        map[int]uint8      // vehicleIdx → ResultStatus (persists; default 0 = inactive)
	speed         map[int]uint16
	emitTelemetry bool
}

func newIncSim(t *testing.T) *incSim {
	s := &incSim{
		t:             t,
		r:             newIncidentRecorder(testLogger(), nil),
		uid:           777,
		format:        packets.PacketFormat2026,
		pos:           make(map[int][3]float32),
		status:        make(map[int]uint8),
		speed:         make(map[int]uint16),
		emitTelemetry: true,
	}
	s.r.observeSession(s.uid)
	return s
}

func (s *incSim) header(sessionTime float32) *packets.PacketHeader {
	return &packets.PacketHeader{
		SessionUID:      s.uid,
		PacketFormat:    s.format,
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

	if s.emitTelemetry {
		tel := &packets.PacketCarTelemetryData{Header: *h}
		for idx, sp := range s.speed {
			tel.CarTelemetryData[idx].Speed = sp
		}
		s.r.noteTelemetry(tel)
	}

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

func TestIncidentRecorderV2IdentityFreshnessAndCounts(t *testing.T) {
	zero, noTeam := 0, 255
	withTelemetry := newIncSim(t)
	withTelemetry.r.teamResolver = func(idx uint8) *int {
		switch idx {
		case 0:
			return &zero
		case 1:
			return &noTeam
		default:
			return nil
		}
	}
	withTelemetry.pos[0] = [3]float32{0, 0, 0}
	withTelemetry.pos[1] = [3]float32{3, 0, 0}
	withTelemetry.status[0], withTelemetry.status[1] = 2, 2
	// Explicit zero telemetry is fresh data, not an unavailable marker.
	withTelemetry.speed[0], withTelemetry.speed[1] = 0, 0
	withTelemetry.run(0, 2)
	withTelemetry.collide(2, 0, 1)
	withTelemetry.run(2, 3.3)
	clips := withTelemetry.clips()
	if len(clips) != 1 {
		t.Fatalf("clips = %d, want 1", len(clips))
	}
	clip := clips[0]
	if len(clip.Participants) != 2 || clip.Participants[0].TeamID == nil || *clip.Participants[0].TeamID != 0 ||
		clip.Participants[1].TeamID == nil || *clip.Participants[1].TeamID != 255 {
		t.Fatalf("team identities = %+v, want non-null 0 and 255", clip.Participants)
	}
	if clip.Completeness.CapturedParticipantCount == nil || clip.Completeness.CapturedFrameCount == nil ||
		*clip.Completeness.CapturedParticipantCount < clip.Completeness.StoredParticipantCount ||
		*clip.Completeness.CapturedFrameCount < clip.Completeness.StoredFrameCount {
		t.Fatalf("clip completeness = %+v", clip.Completeness)
	}
	for frameIndex, frame := range clip.Frames {
		if frameIndex > 0 && frame.TMS <= clip.Frames[frameIndex-1].TMS {
			t.Fatalf("frame timestamps are not strict at %d: %d <= %d", frameIndex, frame.TMS, clip.Frames[frameIndex-1].TMS)
		}
		if frame.TelemetryUnavailable == nil || len(frame.TelemetryUnavailable) != 0 {
			t.Fatalf("fresh zero telemetry marker = %#v, want explicit []", frame.TelemetryUnavailable)
		}
		if frame.Cars[0] == nil || frame.Cars[0][9] != 0 {
			t.Fatalf("genuine zero speed not retained: %+v", frame.Cars[0])
		}
	}

	withoutTelemetry := newIncSim(t)
	withoutTelemetry.emitTelemetry = false
	withoutTelemetry.pos[0] = [3]float32{0, 0, 0}
	withoutTelemetry.pos[1] = [3]float32{3, 0, 0}
	withoutTelemetry.status[0], withoutTelemetry.status[1] = 2, 2
	withoutTelemetry.run(0, 2)
	withoutTelemetry.collide(2, 0, 1)
	withoutTelemetry.run(2, 3.3)
	missing := withoutTelemetry.clips()
	if len(missing) != 1 {
		t.Fatalf("missing-telemetry clips = %d, want 1", len(missing))
	}
	for _, frame := range missing[0].Frames {
		if len(frame.TelemetryUnavailable) != 2 || frame.TelemetryUnavailable[0] != 0 || frame.TelemetryUnavailable[1] != 1 {
			t.Fatalf("unavailable telemetry marker = %v, want [0 1]", frame.TelemetryUnavailable)
		}
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
	if c.Completeness.Status != dto.AvailabilityPartial || !hasIncidentReason(c.Completeness.Reasons, dto.ReasonIncidentWindowTruncated) {
		t.Fatalf("session-start completeness = %+v, want partial window reason", c.Completeness)
	}
	// pre 구간은 있는 만큼(~0.3s ≈ 6프레임) + post 1s ≈ 20프레임
	if len(c.Frames) < 20 || len(c.Frames) > 32 {
		t.Fatalf("frames = %d, want partial-window ~26", len(c.Frames))
	}
}

func TestIncidentRecorderLateStartMarksMissingRetainedPreWindow(t *testing.T) {
	s := newIncSim(t)
	s.pos[0] = [3]float32{0, 0, 0}
	s.pos[1] = [3]float32{3, 0, 0}
	s.status[0], s.status[1] = 2, 2
	// The collision is well after session start, but this recorder only began
	// sampling at 1.7s. Its nominal pre-window begins at 1.0s and is absent.
	s.run(1.7, 2.0)
	s.collide(2.0, 0, 1)
	s.run(2.0, 3.3)
	clips := s.clips()
	if len(clips) != 1 {
		t.Fatalf("clips = %d, want 1", len(clips))
	}
	if !hasIncidentReason(clips[0].Completeness.Reasons, dto.ReasonIncidentWindowTruncated) || clips[0].Completeness.Status != dto.AvailabilityPartial {
		t.Fatalf("late recorder completeness = %+v, want partial retained-pre-window loss", clips[0].Completeness)
	}
}

func TestIncidentRecorderTelemetryAvailabilityUsesPerCarPrivacy(t *testing.T) {
	s := newIncSim(t)
	pm := NewPitwallManager(NewStrategyManager(), nil, nil)
	header := packets.PacketHeader{SessionUID: s.uid, PlayerCarIndex: 0}
	participants := &packets.PacketParticipantsData{Header: header, NumActiveCars: 3}
	participants.Participants[1].YourTelemetry = 0
	participants.Participants[2].YourTelemetry = 1
	pm.UpdateParticipants(participants)
	// 0 is the player (fresh zero is real), 1 is a restricted collision partner,
	// and 2 is a public rival. All three share the same fresh telemetry packet.
	s.r.setTelemetryResolver(pm.TelemetryAvailableForVehicle)
	for idx, x := range map[int]float32{0: 0, 1: 3, 2: 6} {
		s.pos[idx] = [3]float32{x, 0, 0}
		s.status[idx] = 2
		s.speed[idx] = 0
	}
	s.run(0, 2)
	s.collide(2, 0, 1)
	s.run(2, 3.3)
	clips := s.clips()
	if len(clips) != 1 {
		t.Fatalf("clips = %d, want 1", len(clips))
	}
	for _, frame := range clips[0].Frames {
		if len(frame.TelemetryUnavailable) != 1 || frame.TelemetryUnavailable[0] != 1 {
			t.Fatalf("privacy freshness = %v, want restricted rival only [1]", frame.TelemetryUnavailable)
		}
		if frame.Cars[0] == nil || frame.Cars[0][9] != 0 {
			t.Fatalf("player genuine zero was not retained: %v", frame.Cars[0])
		}
	}
}

func TestIncidentRecorderFrameCapReportsUncappedCandidates(t *testing.T) {
	r := newIncidentRecorder(testLogger(), nil)
	const uid uint64 = 882
	r.observeSession(uid)
	p := &incidentPending{
		playerIdx:           0,
		t0MS:                2_000,
		windowStart:         1_000,
		endMS:               6_000,
		collisions:          [][2]int{{0, 1}},
		candidateFrameCount: incidentMaxFrames + 1,
		framesCapWarned:     true,
	}
	for i := 0; i < incidentMaxFrames; i++ {
		tick := incidentTick{tMS: int64(1_000 + i*50)}
		for _, idx := range []int{0, 1} {
			tick.cars[idx] = incidentCarSample{valid: true, hasTelemetry: true, hasLapData: true, resultStatus: 2}
		}
		p.ticks = append(p.ticks, tick)
	}
	r.pending = p
	r.lastMotionTMS = p.endMS
	r.finalizeLocked()
	if len(r.clips) != 1 {
		t.Fatalf("clips = %d, want 1", len(r.clips))
	}
	c := r.clips[0]
	if c.Completeness.CapturedFrameCount == nil || *c.Completeness.CapturedFrameCount != incidentMaxFrames+1 || c.Completeness.StoredFrameCount != incidentMaxFrames {
		t.Fatalf("frame counts = %+v, want captured %d / stored %d", c.Completeness, incidentMaxFrames+1, incidentMaxFrames)
	}
	if c.Completeness.Status != dto.AvailabilityPartial || len(c.Completeness.Reasons) != 1 || !hasIncidentReason(c.Completeness.Reasons, dto.ReasonIncidentFrameLimit) {
		t.Fatalf("frame-cap completeness = %+v, want exactly partial frame-limit", c.Completeness)
	}
}

func TestIncidentRecorderSkippedWholeFrameCannotRemainComplete(t *testing.T) {
	r := newIncidentRecorder(testLogger(), nil)
	const uid uint64 = 883
	r.observeSession(uid)
	p := &incidentPending{playerIdx: 0, t0MS: 2_000, windowStart: 1_000, endMS: 2_000, collisions: [][2]int{{0, 1}}, candidateFrameCount: 2}
	for _, tMS := range []int64{1_000, 1_000} { // strict v2 order skips the second whole frame
		tick := incidentTick{tMS: tMS}
		for _, idx := range []int{0, 1} {
			tick.cars[idx] = incidentCarSample{valid: true, hasTelemetry: true, hasLapData: true, resultStatus: 2}
		}
		p.ticks = append(p.ticks, tick)
	}
	r.pending = p
	r.lastMotionTMS = p.endMS
	r.finalizeLocked()
	c := r.clips[0]
	if c.Completeness.Status == dto.AvailabilityComplete || !hasIncidentReason(c.Completeness.Reasons, dto.ReasonSourceMissing) {
		t.Fatalf("skipped-frame completeness = %+v, must not be complete", c.Completeness)
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

func TestIncidentRecorderFullGrid(t *testing.T) {
	for _, tc := range []struct {
		format uint16
		cars   int
	}{{packets.PacketFormat2025, 22}, {packets.PacketFormat2026, 24}} {
		t.Run(fmt.Sprint(tc.format), func(t *testing.T) {
			s := newIncSim(t)
			s.format = tc.format
			// Deliberately poison trailing slots too: a 2025 capture must ignore them.
			for i := 0; i < 24; i++ {
				s.pos[i] = [3]float32{float32(i), 0, 0}
				s.status[i] = 2
			}
			s.run(0, 2)
			if tc.cars == 22 {
				s.collide(2, 0, 23)
				if s.r.pending != nil {
					t.Fatal("2025 accepted a nonexistent collision partner")
				}
			}
			s.collide(2, 0, uint8(tc.cars-1))
			s.run(2, 3.3)
			clips := s.clips()
			if len(clips) != 1 {
				t.Fatalf("clips = %d, want 1", len(clips))
			}
			c := clips[0]
			if len(c.Participants) != tc.cars || *c.Completeness.CapturedParticipantCount != tc.cars {
				t.Fatalf("participants = %d, want %d", len(c.Participants), tc.cars)
			}
			for i := 0; i < tc.cars; i++ {
				if !hasParticipant(c, i) {
					t.Fatalf("lost car %d", i)
				}
			}
			if hasIncidentReason(c.Completeness.Reasons, dto.ReasonIncidentParticipantLimit) {
				t.Fatal("full grid incorrectly marked truncated")
			}
			for _, f := range c.Frames {
				for j, p := range c.Participants {
					if f.Cars[j] == nil || f.Cars[j][0] != float64(p.Idx) {
						t.Fatalf("car %d lost frame alignment", p.Idx)
					}
				}
			}
			assertIncidentV2Identity(t, c)
		})
	}
}

func TestIncidentRecorderFiltersCollisionsAfterParticipantSelection(t *testing.T) {
	t.Run("multiple collision partners retained", func(t *testing.T) {
		s := newIncSim(t)
		s.pos[0] = [3]float32{0, 0, 0}
		s.status[0] = 2
		for i := 1; i <= 12; i++ {
			s.pos[i] = [3]float32{float32(i), 0, 0}
			s.status[i] = 2
		}
		s.run(0, 2)
		for i := 1; i <= 12; i++ {
			s.collide(2+float32(i)/100, 0, uint8(i))
		}
		s.run(2.12, 3.5)
		clips := s.clips()
		if len(clips) != 1 {
			t.Fatalf("clips = %d, want 1", len(clips))
		}
		clip := clips[0]
		if len(clip.Participants) != 13 || len(clip.Collisions) != 12 || hasIncidentReason(clip.Completeness.Reasons, dto.ReasonIncidentParticipantLimit) {
			t.Fatalf("collision partners lost: %+v", clip.Completeness)
		}
		assertIncidentV2Identity(t, clip)
	})

	t.Run("invalid motion partner", func(t *testing.T) {
		r := newIncidentRecorder(testLogger(), nil)
		r.observeSession(901)
		pending := &incidentPending{
			playerIdx: 0, t0MS: 2_000, windowStart: 1_000, endMS: 2_000,
			collisions: [][2]int{{0, 1}, {0, 2}}, candidateFrameCount: 1,
		}
		tick := incidentTick{tMS: 1_000}
		for _, idx := range []int{0, 1} {
			tick.cars[idx] = incidentCarSample{valid: true, hasTelemetry: true, hasLapData: true, resultStatus: 2}
		}
		// Partner 2 is a real collision ID but has no valid motion sample, so it
		// cannot enter a v2 participant/frame alignment.
		pending.ticks = []incidentTick{tick}
		r.pending = pending
		r.lastMotionTMS = pending.endMS
		r.finalizeLocked()
		if len(r.clips) != 1 {
			t.Fatalf("clips = %d, want retained valid collision", len(r.clips))
		}
		clip := r.clips[0]
		if len(clip.Collisions) != 1 || clip.Collisions[0] != [2]int{0, 1} ||
			!hasIncidentReason(clip.Completeness.Reasons, dto.ReasonSourceMissing) {
			t.Fatalf("invalid partner clip = %+v", clip)
		}
		assertIncidentV2Identity(t, clip)
	})
}

func assertIncidentV2Identity(t *testing.T, clip dto.IncidentClip) {
	t.Helper()
	if len(clip.Collisions) == 0 {
		t.Fatal("v2 clip must retain at least one valid collision")
	}
	participants := make(map[int]struct{}, len(clip.Participants))
	players := 0
	for _, participant := range clip.Participants {
		participants[participant.Idx] = struct{}{}
		if participant.IsPlayer {
			players++
		}
	}
	if players != 1 {
		t.Fatalf("player participants = %d, want 1", players)
	}
	for _, pair := range clip.Collisions {
		if _, ok := participants[pair[0]]; !ok {
			t.Fatalf("collision %v references dropped participant", pair)
		}
		if _, ok := participants[pair[1]]; !ok {
			t.Fatalf("collision %v references dropped participant", pair)
		}
	}
	for index, frame := range clip.Frames {
		if len(frame.Cars) != len(clip.Participants) {
			t.Fatalf("frame %d car slots = %d, want %d", index, len(frame.Cars), len(clip.Participants))
		}
		if index > 0 && frame.TMS <= clip.Frames[index-1].TMS {
			t.Fatalf("frame timestamps not strictly increasing at %d", index)
		}
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

func TestIncidentRecorderDiscardedPendingClipDoesNotInflateEligibleLedger(t *testing.T) {
	s := newIncSim(t)
	s.pos[0] = [3]float32{0, 0, 0}
	s.pos[1] = [3]float32{3, 0, 0}
	s.status[0], s.status[1] = 2, 2
	s.run(0, 2)
	s.collide(2, 0, 1)
	s.run(2, 2.3)
	s.r.onFlashback() // the pending clip belongs to the discarded timeline

	metadata := s.r.captureMetadata(s.uid)
	if metadata == nil || len(metadata.EligibleIncidentKeys) != 0 {
		t.Fatalf("discarded pending capture leaked into eligible ledger: %+v", metadata)
	}
}

func TestIncidentRecorderEligibleEventWithoutFramesStillCountsUnlessDiscarded(t *testing.T) {
	r := newIncidentRecorder(testLogger(), nil)
	const uid uint64 = 991
	r.observeSession(uid)
	r.onCollision(&packets.PacketHeader{PacketFormat: packets.PacketFormat2026, SessionUID: uid, SessionTime: 1, PlayerCarIndex: 0}, 0, 1)
	if clips := r.snapshot(uid); len(clips) != 0 {
		t.Fatalf("zero-frame capture clips = %d, want no visible clip", len(clips))
	}
	metadata := r.captureMetadata(uid)
	if metadata == nil || len(metadata.EligibleIncidentKeys) != 1 {
		t.Fatalf("eligible zero-frame event missing from ledger: %+v", metadata)
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
	metadata := s.r.captureMetadata(s.uid)
	if metadata == nil || len(metadata.EligibleIncidentKeys) != incidentMaxClipsPerSession+1 {
		t.Fatalf("eligible key ledger = %+v, want refused event after visible cap", metadata)
	}
	if !metadata.Provenance.IncidentClipLimitReached {
		t.Fatalf("clip-cap metadata = %+v, want explicit recorder cap fact", metadata.Provenance)
	}
}

func hasIncidentReason(reasons []dto.CompletenessReason, wanted dto.CompletenessReason) bool {
	for _, reason := range reasons {
		if reason == wanted {
			return true
		}
	}
	return false
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
