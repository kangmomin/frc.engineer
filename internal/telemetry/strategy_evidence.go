package telemetry

import (
	"math"
	"sort"
	"strconv"
	"sync"

	"frc.engineer/internal/packets"
	"frc.engineer/internal/strategy"
	"frc.engineer/internal/udp"
)

// [Assumption] Status/damage freshness and status integration gaps are bounded
// at 1.2 seconds. Fast timing/controls must be within 150 milliseconds.
const strategySlowFreshSeconds = 1.2
const strategyFastFreshSeconds = .15

type strategyLapCapture struct {
	lap         strategy.Lap
	flags       map[string]bool
	startTime   float64
	energy      [3]strategy.EnergySector
	energyBad   bool
	energyLast  *strategyEnergySample
	statusKnown bool
}

type strategyStatusSample struct {
	at   float64
	data packets.CarStatusData
}

type strategyEnergySample struct {
	time, distance, deployed, harvested float64
}

type strategyCapture struct {
	mu            sync.Mutex
	evidence      strategy.Evidence
	uid           uint64
	player        uint8
	current       *strategyLapCapture
	session       *packets.PacketSessionData
	status        *packets.CarStatusData
	statusAt      float64
	pendingStatus *strategyStatusSample
	damage        *packets.CarDamageData
	damageAt      float64
	telemetry     *packets.CarTelemetryData
	telemetryAt   float64
	overtakeAt    float64
	overtakeKnown bool
	setup         *packets.CarSetupData
	setupRevision int
	lap           *packets.LapData
	lapAt         float64
	stint         int
	pendingStop   *strategy.Stop
	entryStops    uint8
	inPit         bool
}

func (c *strategyCapture) reset(uid uint64, player uint8) {
	c.evidence = strategy.Evidence{Version: strategy.EvidenceVersion, SessionUID: strconv.FormatUint(uid, 10), Laps: []strategy.Lap{}, Stops: []strategy.Stop{}, Reasons: []string{}}
	c.uid, c.player = uid, player
	c.current, c.session, c.status, c.damage, c.telemetry, c.setup, c.lap = nil, nil, nil, nil, nil, nil, nil
	c.setupRevision, c.stint = 0, 1
	c.statusAt, c.damageAt, c.telemetryAt, c.lapAt = 0, 0, 0, 0
	c.pendingStop = nil
	c.pendingStatus = nil
	c.overtakeKnown = false
	c.inPit = false
}

func (c *strategyCapture) reason(reason string) {
	for _, r := range c.evidence.Reasons {
		if r == reason {
			return
		}
	}
	c.evidence.Reasons = append(c.evidence.Reasons, reason)
	sort.Strings(c.evidence.Reasons)
}

func (c *strategyCapture) observe(p *udp.ParsedData) {
	if p == nil || p.Header == nil || p.Header.SessionUID == 0 || int(p.Header.PlayerCarIndex) >= packets.MaxCars {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	h := p.Header
	at := float64(h.SessionTime)
	if math.IsNaN(at) || math.IsInf(at, 0) {
		return
	}
	if c.uid != h.SessionUID || c.player != h.PlayerCarIndex {
		c.reset(h.SessionUID, h.PlayerCarIndex)
	}
	i := int(c.player)
	if p.Session != nil {
		s := p.Session
		rules := strategyRules(s.StrategyRules)
		old := c.evidence.Conditions
		if len(c.evidence.Laps) > 0 && (old.TotalLaps != int(s.TotalLaps) || old.Formula != int(s.Formula) ||
			(old.Rules != nil && rules != nil && *old.Rules != *rules)) {
			c.reason("conditions-change")
		}
		c.session = s
		c.evidence.Conditions = strategy.Conditions{PacketFormat: int(h.PacketFormat), GameYear: int(h.GameYear), GameMajor: int(h.GameMajorVersion), GameMinor: int(h.GameMinorVersion),
			Formula: int(s.Formula), SessionType: int(s.SessionType), TotalLaps: int(s.TotalLaps), TrackLengthM: int(s.TrackLength), TeamID: old.TeamID, Rules: rules}
		if c.current != nil {
			if int(s.Weather) != c.current.lap.Weather {
				c.current.flags["weather-change"] = true
			}
			if s.SafetyCarStatus != 0 {
				c.current.flags["safety-car"] = true
			}
		}
	}
	if p.Participants != nil {
		team := int(p.Participants.Participants[i].TeamID)
		if c.evidence.Conditions.TeamID != nil && *c.evidence.Conditions.TeamID != team && len(c.evidence.Laps) > 0 {
			c.reason("conditions-change")
		}
		c.evidence.Conditions.TeamID = &team
	}
	if p.CarSetups != nil {
		s := p.CarSetups.CarSetupData[i]
		// Fuel load and the live brake controls are not a new fixed chassis
		// setup. A wing/geometry/pressure change starts a new revision.
		s.FuelLoad = 0
		s.BrakeBias = 0
		s.EngineBraking = 0
		if c.setup == nil || *c.setup != s {
			c.setupRevision++
			if c.current != nil && c.setup != nil {
				c.current.flags["setup-change"] = true
			}
			c.setup = &s
		}
	}
	if p.CarDamage != nil {
		d := p.CarDamage.CarDamageData[i]
		c.damage = &d
		c.damageAt = at
		if c.current != nil && strategyDamaged(d) {
			c.current.flags["damage"] = true
		}
	}
	if p.Telemetry != nil {
		t := p.Telemetry.CarTelemetryData[i]
		c.telemetry = &t
		c.telemetryAt = at
		if c.current != nil && t.DRS == 1 {
			c.current.flags["traffic"] = true
		}
	}
	if p.CarTelemetry2 != nil {
		c.overtakeKnown, c.overtakeAt = true, at
		if c.current != nil && p.CarTelemetry2.CarTelemetry2Data[i].OvertakeActive != 0 {
			c.current.flags["traffic"] = true
		}
	}
	if p.CarStatus != nil {
		// Confirm the lap using timing at or after this status timestamp. A
		// status packet can arrive first in the new frame with reset counters.
		if c.lap != nil && at <= c.lapAt {
			c.applyStatus(at, p.CarStatus.CarStatusData[i])
		} else {
			c.pendingStatus = &strategyStatusSample{at, p.CarStatus.CarStatusData[i]}
		}
	}
	if p.Event != nil {
		switch p.Event.EventStringCode {
		case packets.EventFlashback:
			c.reason("flashback")
			if c.current != nil {
				c.current.flags["flashback"] = true
				c.current.energyBad = true
			}
		case packets.EventCollision:
			if e, ok := p.Event.EventDetails.(packets.CollisionEvent); ok && (e.Vehicle1Idx == c.player || e.Vehicle2Idx == c.player) {
				if c.current != nil {
					c.current.flags["incident"] = true
				}
			}
		case packets.EventPenalty:
			if e, ok := p.Event.EventDetails.(packets.PenaltyEvent); ok && e.VehicleIdx == c.player {
				if c.current != nil {
					c.current.flags["penalty"] = true
				}
			}
		}
	}
	if p.LapData != nil {
		c.observeLap(at, p.LapData.LapData[i])
	}
}

func strategyRules(r *packets.SessionStrategyRules) *strategy.Rules {
	if r == nil {
		return nil
	}
	return &strategy.Rules{EqualPerformance: r.EqualPerformance, GameMode: int(r.GameMode), RuleSet: int(r.RuleSet), SessionLength: int(r.SessionLength),
		SurfaceType: int(r.SurfaceType), LowFuelMode: int(r.LowFuelMode), TyreTemperature: int(r.TyreTemperature), PitLaneTyreSim: int(r.PitLaneTyreSim),
		ERSAssist: int(r.ERSAssist), PitAssist: int(r.PitAssist), PitReleaseAssist: int(r.PitReleaseAssist), PitStopExperience: int(r.PitStopExperience)}
}

func strategyValue(value float32, max float64) *float64 {
	v := float64(value)
	if math.IsNaN(v) || math.IsInf(v, 0) || v < 0 || v > max {
		return nil
	}
	return &v
}

func strategyDamaged(d packets.CarDamageData) bool {
	return d.FrontLeftWingDamage > 0 || d.FrontRightWingDamage > 0 || d.RearWingDamage > 0 || d.FloorDamage > 0 ||
		d.DiffuserDamage > 0 || d.SidepodDamage > 0 || d.EngineDamage > 0 || d.DRSFault != 0 || d.ERSFault != 0 ||
		d.TyresDamage[0] > 0 || d.TyresDamage[1] > 0 || d.TyresDamage[2] > 0 || d.TyresDamage[3] > 0
}

func (c *strategyCapture) startLap(at float64, l packets.LapData) {
	x := &strategyLapCapture{flags: map[string]bool{}, startTime: at - float64(l.CurrentLapTimeInMS)/1000}
	x.lap = strategy.Lap{Number: int(l.CurrentLapNum), Stint: c.stint, SetupRevision: c.setupRevision, Flags: []string{}}
	if l.CurrentLapTimeInMS > 1000 {
		x.flags["partial-lap"] = true
	}
	if l.CurrentLapNum == 1 {
		x.flags["race-start"] = true
	}
	if c.session != nil {
		x.lap.Weather = int(c.session.Weather)
		x.lap.TrackTemp = int(c.session.TrackTemperature)
	} else {
		x.flags["source-missing"] = true
	}
	if c.setup == nil || c.damage == nil || math.Abs(at-c.damageAt) > strategySlowFreshSeconds {
		x.flags["source-missing"] = true
	}
	if c.damage != nil && strategyDamaged(*c.damage) {
		x.flags["damage"] = true
	}
	c.current = x
}

func (c *strategyCapture) applyStatus(at float64, s packets.CarStatusData) {
	// Late packets from the preceding lap must not seed the new lap's age or
	// ERS store. Missing boundary coverage remains visible to the model.
	if at < c.statusAt || (c.current != nil && at < c.current.startTime-0.001) {
		return
	}
	if c.status != nil && (s.ActualTyreCompound != c.status.ActualTyreCompound || s.TyresAgeLaps < c.status.TyresAgeLaps) {
		c.stint++
	}
	c.status, c.statusAt = &s, at
	x := c.current
	if x == nil {
		return
	}
	if !x.statusKnown {
		x.statusKnown = true
		if at-x.startTime > strategySlowFreshSeconds {
			x.flags["source-missing"] = true
		}
		x.lap.Stint = c.stint
		x.lap.Compound, x.lap.Tyre = int(s.ActualTyreCompound), titleTyre(s.VisualTyreCompound)
		x.lap.TyreAge = int(s.TyresAgeLaps)
		x.lap.FuelKg = strategyValue(s.FuelInTank, 200)
		x.lap.ERSStartJ = strategyValue(s.ERSStoreEnergy, 20000000)
		x.lap.TractionControl, x.lap.ABS = int(s.TractionControl), int(s.AntiLockBrakes)
	}
	x.lap.EndCompound, x.lap.EndTyreAge = int(s.ActualTyreCompound), int(s.TyresAgeLaps)
	x.lap.FuelEndKg = strategyValue(s.FuelInTank, 200)
	x.lap.ERSEndJ = strategyValue(s.ERSStoreEnergy, 20000000)
	if s.NetworkPaused != 0 {
		x.flags["paused"] = true
	}
	if int(s.TractionControl) != x.lap.TractionControl || int(s.AntiLockBrakes) != x.lap.ABS {
		x.flags["conditions-change"] = true
	}
	c.energy(at, s)
}

func titleTyre(v uint8) string {
	switch v {
	case 16:
		return "Soft"
	case 17:
		return "Medium"
	case 18:
		return "Hard"
	case 7:
		return "Inter"
	case 8:
		return "Wet"
	}
	return ""
}

func (c *strategyCapture) observeLap(at float64, l packets.LapData) {
	if l.CurrentLapNum == 0 || c.session == nil || c.session.SessionType < 15 || c.session.SessionType > 17 {
		return
	}
	if c.lap != nil && (at < c.lapAt-1 || l.CurrentLapNum < c.lap.CurrentLapNum ||
		(l.CurrentLapNum == c.lap.CurrentLapNum && l.CurrentLapTimeInMS+500 < c.lap.CurrentLapTimeInMS)) {
		c.reason("flashback")
		c.current = nil
		c.pendingStop = nil
		c.evidence.Laps = []strategy.Lap{}
		c.evidence.Stops = []strategy.Stop{}
		c.status, c.pendingStatus = nil, nil
		c.statusAt = 0
	}
	boundary := at - float64(l.CurrentLapTimeInMS)/1000
	if c.pendingStatus != nil && c.pendingStatus.at < boundary && c.pendingStatus.at <= at {
		c.applyStatus(c.pendingStatus.at, c.pendingStatus.data)
		c.pendingStatus = nil
	}
	if c.current != nil && int(l.CurrentLapNum) > c.current.lap.Number {
		if int(l.CurrentLapNum) == c.current.lap.Number+1 && l.LastLapTimeInMS > 0 && c.current.lap.Number <= c.evidence.Conditions.TotalLaps {
			x := c.current
			x.lap.TimeMs = int(l.LastLapTimeInMS)
			if !x.statusKnown {
				x.flags["source-missing"] = true
			}
			if c.lap == nil || at-c.lapAt > .25 {
				x.flags["gap"] = true
			}
			if !x.energyBad {
				x.lap.Energy = make([]strategy.EnergySector, 3)
				for i, s := range x.energy {
					if s.DurationMs > 0 {
						s.MeanSpeedKph /= s.DurationMs
					}
					x.lap.Energy[i] = s
				}
			}
			for flag := range x.flags {
				x.lap.Flags = append(x.lap.Flags, flag)
			}
			sort.Strings(x.lap.Flags)
			if len(c.evidence.Laps) < strategy.MaxLaps {
				c.evidence.Laps = append(c.evidence.Laps, x.lap)
			}
		}
		c.current = nil
	}
	if int(l.CurrentLapNum) > c.evidence.Conditions.TotalLaps {
		c.lap = &l
		c.lapAt = at
		return
	}
	if c.current == nil {
		c.startLap(at, l)
	}
	x := c.current
	if c.lap != nil && at-c.lapAt > .25 {
		x.flags["gap"] = true
	}
	c.lap, c.lapAt = &l, at
	if c.pendingStatus != nil && c.pendingStatus.at <= at {
		c.applyStatus(c.pendingStatus.at, c.pendingStatus.data)
		c.pendingStatus = nil
	}
	if l.CurrentLapInvalid != 0 {
		x.flags["invalid"] = true
	}
	if c.session.SafetyCarStatus != 0 {
		x.flags["safety-car"] = true
	}
	if (at-x.startTime > strategySlowFreshSeconds && (!x.statusKnown || math.Abs(at-c.statusAt) > strategySlowFreshSeconds)) || c.damage == nil || math.Abs(at-c.damageAt) > strategySlowFreshSeconds {
		x.flags["source-missing"] = true
	}
	if c.evidence.Conditions.Formula == 13 && (!c.overtakeKnown || math.Abs(at-c.overtakeAt) > strategyFastFreshSeconds) {
		x.flags["source-missing"] = true
	}
	if l.PitStatus > 0 || c.inPit {
		x.flags["pit"] = true
	}
	gap := int(l.DeltaToCarInFrontMinutesPart)*60000 + int(l.DeltaToCarInFrontMSPart)
	// [Assumption] A reported car ahead within 2 seconds contaminates a clean
	// pace baseline. Unknown gaps in a non-leading car are not clean evidence.
	if l.CarPosition > 1 && (gap <= 2000) {
		x.flags["traffic"] = true
	}
	if l.NumUnservedDriveThroughs > 0 || l.NumUnservedStopGoPenalties > 0 {
		x.flags["penalty"] = true
	}
	if l.PitStatus > 0 && !c.inPit {
		c.pendingStop = &strategy.Stop{InLap: int(l.CurrentLapNum)}
		c.entryStops = l.NumPitStops
	}
	if l.PitStatus > 0 && c.pendingStop != nil {
		c.pendingStop.LaneMs = max(c.pendingStop.LaneMs, int(l.PitLaneTimeInLaneInMS))
		c.pendingStop.StationaryMs = max(c.pendingStop.StationaryMs, int(l.PitStopTimerInMS))
	}
	if l.PitStatus == 0 && c.inPit && c.pendingStop != nil {
		if l.NumPitStops > c.entryStops && int(l.CurrentLapNum)-c.pendingStop.InLap <= 1 && len(c.evidence.Stops) < strategy.MaxStops {
			c.pendingStop.OutLap = int(l.CurrentLapNum)
			c.evidence.Stops = append(c.evidence.Stops, *c.pendingStop)
		}
		c.pendingStop = nil
	}
	c.inPit = l.PitStatus > 0
	c.lap = &l
	c.lapAt = at
}

func (c *strategyCapture) energy(at float64, s packets.CarStatusData) {
	x := c.current
	if c.lap == nil || int(c.lap.CurrentLapNum) != x.lap.Number || c.evidence.Conditions.TrackLengthM <= 0 ||
		math.Abs(at-c.lapAt) > strategyFastFreshSeconds || c.telemetry == nil || math.Abs(at-c.telemetryAt) > strategyFastFreshSeconds {
		return
	}
	deployed := strategyValue(s.ERSDeployedThisLap, 100000000)
	harvested := strategyValue(s.ERSHarvestedThisLapMGUK+s.ERSHarvestedThisLapMGUH, 100000000)
	distance := float64(c.lap.LapDistance)
	if deployed == nil || harvested == nil || math.IsNaN(distance) || math.IsInf(distance, 0) {
		x.energyBad = true
		return
	}
	next := &strategyEnergySample{at, distance, *deployed, *harvested}
	previous := x.energyLast
	x.energyLast = next
	if previous == nil {
		return
	}
	dt := at - previous.time
	dd := distance - previous.distance
	if dt <= 0 {
		return
	}
	if dt > strategySlowFreshSeconds || dd < 0 || next.deployed < previous.deployed || next.harvested < previous.harvested {
		x.energyBad = true
		return
	}
	length := float64(c.evidence.Conditions.TrackLengthM)
	if distance < 0 || distance > length || previous.distance < 0 {
		x.energyBad = true
		return
	}
	from := max(0, min(2, int(previous.distance/length*3)))
	to := max(0, min(2, int(distance/length*3)))
	for segment := from; segment <= to; segment++ {
		fraction := 1.0
		if dd > 0 {
			overlap := math.Min(distance, float64(segment+1)*length/3) - math.Max(previous.distance, float64(segment)*length/3)
			fraction = math.Max(0, overlap/dd)
		}
		timeMs := dt * 1000 * fraction
		x.energy[segment].DurationMs += timeMs
		x.energy[segment].DeployedJ += (next.deployed - previous.deployed) * fraction
		x.energy[segment].HarvestedJ += (next.harvested - previous.harvested) * fraction
		x.energy[segment].MeanSpeedKph += float64(c.telemetry.Speed) * timeMs
	}
}

func (c *strategyCapture) snapshot(uid uint64) *strategy.Evidence {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.uid != uid || (len(c.evidence.Laps) == 0 && len(c.evidence.Reasons) == 0) {
		return nil
	}
	e := c.evidence
	e.Laps = append([]strategy.Lap{}, e.Laps...)
	e.Stops = append([]strategy.Stop{}, e.Stops...)
	e.Reasons = append([]string{}, e.Reasons...)
	if strategy.ValidateEvidence(&e) != nil {
		return nil
	}
	return &e
}
