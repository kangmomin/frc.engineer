package telemetry

import (
	"log/slog"
	"math"
	"sort"
	"sync"

	"frc.engineer/internal/dto"
	"frc.engineer/internal/packets"
)

// incidentRecorder captures player-involved collisions: a ±1s window (chain-merged
// up to 5s) of nearby-car motion+input samples downsampled to ~20Hz. It follows the
// pitMeasureState edge-detect→accumulate→finalize precedent and the replay
// recorder's session-reset discipline. Every method runs on the processor's single
// goroutine; the mutex only guards the save-callback snapshot path.
//
// All windowing/gating/deadlines use packet SessionTime (game time): "±1s" means
// one game second, pauses freeze capture naturally, and the COLL event header's
// SessionTime is t0 with no axis conversion. Rewinds (flashback / session restart)
// are detected on the motion-sample axis only and reset the buffers.
const (
	incidentFrameIntervalMS    = 50 // nominal — frames carry measured tMs
	incidentSampleGateMS       = 45 // ≥45ms between samples ≈ every 3rd frame at 60Hz
	incidentPreWindowMS        = 1000
	incidentPostWindowMS       = 1000
	incidentMergedWindowMaxMS  = 5000
	incidentRadiusM            = 40.0
	incidentMaxParticipants    = 10
	incidentMaxClipsPerSession = 20
	incidentMaxCollisions      = 20  // mirrors platform validateUpload cap
	incidentMaxFrames          = 101 // mirrors platform cap; gate jitter could exceed 5s/50ms
	incidentPairDebounceMS     = 1000
	incidentRewindResetMS      = 500
	incidentStaleCacheFrames   = 30 // ~0.5s at 60Hz: stale telemetry/lap caches are dropped
	incidentRingSlots          = 24 // ≥1.15s at 50ms spacing — always covers the 1s pre window
	incidentNameMaxRunes       = 48 // mirrors platform cap (packet names are ≤32 bytes anyway)
)

// incidentCarSample is one car at one tick, value-copied so no packet memory is
// retained. valid=false marks non-finite motion floats (the whole car-frame nulls
// out — Go json.Marshal would otherwise fail on NaN/Inf and poison the summary).
type incidentCarSample struct {
	valid        bool
	hasTelemetry bool
	hasLapData   bool
	resultStatus uint8
	posX, posY, posZ       float32
	velX, velY, velZ       float32
	yaw, gLat, gLong       float32
	speedKmh               uint16
	throttle, brake, steer float32
	gear                   int8
}

type incidentTick struct {
	tMS   int64
	frame uint32
	cars  [packets.MaxCars]incidentCarSample
}

type incidentPending struct {
	playerIdx   uint8
	t0MS        int64 // first merged COLL
	windowStart int64 // nominal t0−pre (may be negative near session start)
	endMS       int64 // current deadline (last merged t0 + post, clamped to hardEnd)
	hardEndMS   int64 // windowStart + incidentMergedWindowMaxMS
	lap         int
	collisions  [][2]int
	collisionsCapWarned bool
	ticks       []incidentTick
}

type incidentRecorder struct {
	mu           sync.Mutex
	logger       *slog.Logger
	nameResolver func(vehicleIdx uint8) string

	sessionUID    uint64
	sampledOnce   bool // lastSampleTMS==0 is a real timestamp at session time zero
	lastSampleTMS int64
	lastMotionTMS int64
	pairLastMS    map[[2]uint8]int64

	latestTelemetry *packets.PacketCarTelemetryData
	latestLapData   *packets.PacketLapData

	ring     [incidentRingSlots]incidentTick
	ringLen  int
	ringNext int

	pending         *incidentPending
	clips           []dto.IncidentClip
	clipLimitWarned bool
}

func newIncidentRecorder(logger *slog.Logger, nameResolver func(uint8) string) *incidentRecorder {
	return &incidentRecorder{
		logger:       logger,
		nameResolver: nameResolver,
		pairLastMS:   make(map[[2]uint8]int64),
	}
}

// observeSession resets everything (clips included) when the session changes,
// mirroring observeReplaySession.
func (r *incidentRecorder) observeSession(sessionUID uint64) {
	if r == nil || sessionUID == 0 {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.sessionUID == sessionUID {
		return
	}
	r.sessionUID = sessionUID
	r.resetCaptureLocked()
	r.lastMotionTMS = 0
	r.latestTelemetry = nil
	r.latestLapData = nil
	r.clips = nil
	r.clipLimitWarned = false
}

// resetCaptureLocked drops the ring, any open capture and the pair debounce —
// used on rewind (flashback / restart). Finalized clips are kept on purpose:
// they hold a single consistent timeline (see plan Rejected Decisions).
func (r *incidentRecorder) resetCaptureLocked() {
	r.pending = nil
	r.ringLen = 0
	r.ringNext = 0
	r.sampledOnce = false
	r.lastSampleTMS = 0
	if len(r.pairLastMS) > 0 {
		r.pairLastMS = make(map[[2]uint8]int64)
	}
}

func (r *incidentRecorder) noteTelemetry(t *packets.PacketCarTelemetryData) {
	if r == nil || t == nil {
		return
	}
	r.mu.Lock()
	r.latestTelemetry = t
	r.mu.Unlock()
}

func (r *incidentRecorder) noteLapData(ld *packets.PacketLapData) {
	if r == nil || ld == nil {
		return
	}
	r.mu.Lock()
	r.latestLapData = ld
	r.mu.Unlock()
}

// noteMotion drives the whole capture clock: rewind guard, pending deadline,
// 20Hz gate, ring append and pending accumulation.
func (r *incidentRecorder) noteMotion(m *packets.PacketMotionData, header *packets.PacketHeader) {
	if r == nil || m == nil || header == nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()

	tMS := int64(float64(header.SessionTime) * 1000)

	// Rewind guard (motion axis only): flashback or session restart pulled game
	// time backwards — buffered ticks belong to a discarded timeline.
	if r.lastMotionTMS != 0 && tMS < r.lastMotionTMS-incidentRewindResetMS {
		r.resetCaptureLocked()
	}
	r.lastMotionTMS = tMS

	// Close a due capture before gating: the deadline must fire even when this
	// particular frame is dropped by the 20Hz gate.
	if r.pending != nil && tMS > r.pending.endMS {
		r.finalizeLocked()
	}

	if r.sampledOnce && tMS-r.lastSampleTMS < incidentSampleGateMS {
		return
	}
	r.sampledOnce = true
	r.lastSampleTMS = tMS

	tick := r.buildTickLocked(m, header, tMS)
	r.ring[r.ringNext] = tick
	r.ringNext = (r.ringNext + 1) % incidentRingSlots
	if r.ringLen < incidentRingSlots {
		r.ringLen++
	}

	if r.pending != nil && len(r.pending.ticks) < incidentMaxFrames {
		r.pending.ticks = append(r.pending.ticks, tick)
	}
}

// buildTickLocked value-copies the full grid for one sample. Telemetry/lap caches
// older than incidentStaleCacheFrames vs the motion frame are ignored so a stalled
// stream can't smuggle seconds-old values in as "current".
func (r *incidentRecorder) buildTickLocked(m *packets.PacketMotionData, header *packets.PacketHeader, tMS int64) incidentTick {
	tick := incidentTick{tMS: tMS, frame: header.FrameIdentifier}

	telOK := r.latestTelemetry != nil &&
		frameDelta(header.FrameIdentifier, r.latestTelemetry.Header.FrameIdentifier) <= incidentStaleCacheFrames
	lapOK := r.latestLapData != nil &&
		frameDelta(header.FrameIdentifier, r.latestLapData.Header.FrameIdentifier) <= incidentStaleCacheFrames

	for i := 0; i < packets.MaxCars; i++ {
		cm := &m.CarMotionData[i]
		s := incidentCarSample{
			posX: cm.WorldPositionX, posY: cm.WorldPositionY, posZ: cm.WorldPositionZ,
			velX: cm.WorldVelocityX, velY: cm.WorldVelocityY, velZ: cm.WorldVelocityZ,
			yaw: cm.Yaw, gLat: cm.GForceLateral, gLong: cm.GForceLongitudinal,
		}
		if telOK {
			ct := &r.latestTelemetry.CarTelemetryData[i]
			s.speedKmh = ct.Speed
			s.throttle, s.brake, s.steer = ct.Throttle, ct.Brake, ct.Steer
			s.gear = ct.Gear
			s.hasTelemetry = true
		}
		if lapOK {
			s.resultStatus = r.latestLapData.LapData[i].ResultStatus
			s.hasLapData = true
		}
		s.valid = sampleFloatsFinite(&s)
		tick.cars[i] = s
	}
	return tick
}

// onCollision starts or merges a capture for a player-involved COLL.
func (r *incidentRecorder) onCollision(header *packets.PacketHeader, v1, v2 uint8) {
	if r == nil || header == nil {
		return
	}
	if v1 == v2 || int(v1) >= packets.MaxCars || int(v2) >= packets.MaxCars {
		return // degenerate event / spectator sentinel
	}
	player := header.PlayerCarIndex
	if int(player) >= packets.MaxCars || (v1 != player && v2 != player) {
		return
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	tMS := int64(float64(header.SessionTime) * 1000)

	// Same-pair debounce: a repeat COLL of the same contact within 1s neither
	// records nor extends — it would only burn the 5s merge budget.
	key := pairKey(v1, v2)
	if last, ok := r.pairLastMS[key]; ok && tMS >= last && tMS-last < incidentPairDebounceMS {
		return
	}
	r.pairLastMS[key] = tMS

	// An event can land between motion frames after the deadline passed.
	if r.pending != nil && tMS > r.pending.endMS {
		r.finalizeLocked()
	}

	if p := r.pending; p != nil {
		if len(p.collisions) < incidentMaxCollisions {
			p.collisions = append(p.collisions, [2]int{int(v1), int(v2)})
		} else if !p.collisionsCapWarned {
			p.collisionsCapWarned = true
			r.logger.Warn("incident collisions cap reached; extra collisions dropped", "cap", incidentMaxCollisions)
		}
		newEnd := tMS + incidentPostWindowMS
		if newEnd > p.hardEndMS {
			newEnd = p.hardEndMS
		}
		if newEnd > p.endMS {
			p.endMS = newEnd
		}
		return
	}

	if len(r.clips) >= incidentMaxClipsPerSession {
		if !r.clipLimitWarned {
			r.clipLimitWarned = true
			r.logger.Warn("incident clip cap reached; further collisions not captured", "cap", incidentMaxClipsPerSession)
		}
		return
	}

	p := &incidentPending{
		playerIdx:   player,
		t0MS:        tMS,
		windowStart: tMS - incidentPreWindowMS,
		endMS:       tMS + incidentPostWindowMS,
		hardEndMS:   tMS - incidentPreWindowMS + incidentMergedWindowMaxMS,
		collisions:  [][2]int{{int(v1), int(v2)}},
	}
	if r.latestLapData != nil {
		p.lap = int(r.latestLapData.LapData[player].CurrentLapNum)
	}
	// Copy (not reference) the pre window out of the ring: the ring keeps rolling
	// during the post window and would overwrite these slots.
	for k := 0; k < r.ringLen; k++ {
		idx := (r.ringNext - r.ringLen + k + 2*incidentRingSlots) % incidentRingSlots
		t := r.ring[idx]
		if t.tMS >= p.windowStart && t.tMS <= tMS {
			p.ticks = append(p.ticks, t)
		}
	}
	r.pending = p
}

// onFlashback discards the open capture and the ring: pre-flashback frames belong
// to a rewound timeline. Finalized clips stay (single consistent timeline each).
func (r *incidentRecorder) onFlashback() {
	if r == nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.pending != nil {
		r.logger.Info("incident capture discarded (flashback)", "t0Ms", r.pending.t0MS)
	}
	r.resetCaptureLocked()
}

// snapshot finalizes any open capture (race end can precede the +1s deadline) and
// returns the session's clips. Non-destructive and idempotent: the save callback
// may retry after a failed save (processor rolls the saved flag back).
func (r *incidentRecorder) snapshot(sessionUID uint64) []dto.IncidentClip {
	if r == nil {
		return nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if sessionUID == 0 || r.sessionUID != sessionUID {
		return nil
	}
	if r.pending != nil {
		r.finalizeLocked()
	}
	if len(r.clips) == 0 {
		return nil
	}
	out := make([]dto.IncidentClip, len(r.clips))
	copy(out, r.clips)
	return out
}

// finalizeLocked turns the pending capture into a dto.IncidentClip: per-sample
// active-status radius selection, forced collision partners, nearest-K cap.
func (r *incidentRecorder) finalizeLocked() {
	p := r.pending
	r.pending = nil
	if p == nil || len(p.ticks) == 0 || len(r.clips) >= incidentMaxClipsPerSession {
		return
	}

	playerIdx := int(p.playerIdx)
	forced := make(map[int]bool, len(p.collisions)+1)
	for _, pair := range p.collisions {
		for _, idx := range pair {
			if idx != playerIdx {
				forced[idx] = true
			}
		}
	}

	// Min distance per car over the window. The active filter is per-sample
	// (ResultStatus 2|3 at that tick) so a partner retiring mid-window still
	// counts through its pre-impact samples. Player and partners bypass the
	// status filter entirely.
	type carStat struct {
		seen    bool
		minDist float64
	}
	var stats [packets.MaxCars]carStat
	for ti := range p.ticks {
		t := &p.ticks[ti]
		ps := &t.cars[playerIdx]
		if !ps.valid {
			continue
		}
		for i := 0; i < packets.MaxCars; i++ {
			cs := &t.cars[i]
			if !cs.valid {
				continue
			}
			if i != playerIdx && !forced[i] {
				if !cs.hasLapData || (cs.resultStatus != 2 && cs.resultStatus != 3) {
					continue
				}
			}
			d := sampleDistance(ps, cs)
			if st := &stats[i]; !st.seen || d < st.minDist {
				st.seen = true
				st.minDist = d
			}
		}
	}

	type candidate struct {
		idx     int
		minDist float64
	}
	var cands []candidate
	for i := 0; i < packets.MaxCars; i++ {
		if !stats[i].seen {
			continue
		}
		if i == playerIdx || forced[i] || stats[i].minDist <= incidentRadiusM {
			cands = append(cands, candidate{idx: i, minDist: stats[i].minDist})
		}
	}
	if len(cands) == 0 {
		return
	}
	sort.SliceStable(cands, func(a, b int) bool {
		ca, cb := cands[a], cands[b]
		if pa, pb := ca.idx == playerIdx, cb.idx == playerIdx; pa != pb {
			return pa
		}
		if fa, fb := forced[ca.idx], forced[cb.idx]; fa != fb {
			return fa
		}
		return ca.minDist < cb.minDist
	})
	if len(cands) > incidentMaxParticipants {
		cands = cands[:incidentMaxParticipants]
	}

	participants := make([]dto.IncidentParticipant, len(cands))
	column := make(map[int]int, len(cands))
	for j, c := range cands {
		name := ""
		if r.nameResolver != nil {
			name = clampRunes(r.nameResolver(uint8(c.idx)), incidentNameMaxRunes)
		}
		participants[j] = dto.IncidentParticipant{
			Idx:      c.idx,
			Name:     name,
			IsPlayer: c.idx == playerIdx,
			MinDistM: roundTo(c.minDist, 1),
		}
		column[c.idx] = j
	}

	frames := make([]dto.IncidentFrame, 0, len(p.ticks))
	for ti := range p.ticks {
		t := &p.ticks[ti]
		cars := make([][]float64, len(cands))
		any := false
		for vehIdx, j := range column {
			cs := &t.cars[vehIdx]
			if !cs.valid {
				continue
			}
			cars[j] = carFrameValues(cs)
			any = true
		}
		if !any {
			continue
		}
		frames = append(frames, dto.IncidentFrame{TMS: t.tMS, Cars: cars})
	}
	if len(frames) == 0 {
		return
	}

	windowStart := p.windowStart
	if windowStart < 0 {
		windowStart = 0 // session-start clip: pre window is whatever existed
	}
	r.clips = append(r.clips, dto.IncidentClip{
		SessionTimeMS:   p.t0MS,
		WindowStartMS:   windowStart,
		FrameIntervalMS: incidentFrameIntervalMS,
		Lap:             p.lap,
		Collisions:      p.collisions,
		Participants:    participants,
		Frames:          frames,
	})
	r.logger.Info("incident clip captured",
		"t0Ms", p.t0MS, "participants", len(participants), "frames", len(frames),
		"collisions", len(p.collisions), "clips", len(r.clips))
}

// carFrameValues encodes one sample as the fixed 14-value array (rounded to keep
// the JSON compact; values are finite by construction — see sampleFloatsFinite).
func carFrameValues(s *incidentCarSample) []float64 {
	return []float64{
		roundTo(float64(s.posX), 2), roundTo(float64(s.posY), 2), roundTo(float64(s.posZ), 2),
		roundTo(float64(s.velX), 2), roundTo(float64(s.velY), 2), roundTo(float64(s.velZ), 2),
		roundTo(float64(s.yaw), 3),
		roundTo(float64(s.gLat), 2), roundTo(float64(s.gLong), 2),
		float64(s.speedKmh),
		roundTo(float64(s.throttle), 2), roundTo(float64(s.brake), 2), roundTo(float64(s.steer), 2),
		float64(s.gear),
	}
}

func sampleDistance(a, b *incidentCarSample) float64 {
	dx := float64(a.posX) - float64(b.posX)
	dy := float64(a.posY) - float64(b.posY)
	dz := float64(a.posZ) - float64(b.posZ)
	return math.Sqrt(dx*dx + dy*dy + dz*dz)
}

func sampleFloatsFinite(s *incidentCarSample) bool {
	for _, v := range [...]float32{s.posX, s.posY, s.posZ, s.velX, s.velY, s.velZ, s.yaw, s.gLat, s.gLong, s.throttle, s.brake, s.steer} {
		f := float64(v)
		if math.IsNaN(f) || math.IsInf(f, 0) {
			return false
		}
	}
	return true
}

func frameDelta(a, b uint32) uint32 {
	if a >= b {
		return a - b
	}
	return b - a
}

func pairKey(v1, v2 uint8) [2]uint8 {
	if v1 < v2 {
		return [2]uint8{v1, v2}
	}
	return [2]uint8{v2, v1}
}

func roundTo(v float64, decimals int) float64 {
	scale := math.Pow10(decimals)
	return math.Round(v*scale) / scale
}

func clampRunes(s string, max int) string {
	runes := []rune(s)
	if len(runes) <= max {
		return s
	}
	return string(runes[:max])
}
