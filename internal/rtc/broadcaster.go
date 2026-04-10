package rtc

import (
	"sync/atomic"

	"frc.engineer/internal/dto"
	"frc.engineer/internal/signaling"
)

// DataChannelBroadcaster implements broadcast.Broadcaster using WebRTC DataChannels.
type DataChannelBroadcaster struct {
	peerManager *PeerManager
	lastDrops   atomic.Int32
	lastTotal   atomic.Int32
}

// NewDataChannelBroadcaster wraps a PeerManager as a Broadcaster.
func NewDataChannelBroadcaster(pm *PeerManager) *DataChannelBroadcaster {
	return &DataChannelBroadcaster{peerManager: pm}
}

// DroppedCount returns the number of peers that had messages dropped in the last broadcast cycle.
func (b *DataChannelBroadcaster) DroppedCount() int {
	return int(b.lastDrops.Load())
}

// DropRatio returns the fraction of peers that had messages dropped (0.0–1.0).
func (b *DataChannelBroadcaster) DropRatio() float64 {
	total := b.lastTotal.Load()
	if total == 0 {
		return 0
	}
	return float64(b.lastDrops.Load()) / float64(total)
}

// Binary returns true — DataChannel uses msgpack binary frames.
func (b *DataChannelBroadcaster) Binary() bool { return true }

// BroadcastFast sends a message over the fast (unreliable) DataChannel to all peers.
func (b *DataChannelBroadcaster) BroadcastFast(message []byte) {
	b.peerManager.BroadcastAllFast(message)
}

// BroadcastPitwallState accepts a typed PitwallState struct directly,
// avoiding the double marshal/unmarshal that loses bool fields via interface{}.
func (b *DataChannelBroadcaster) BroadcastPitwallState(state interface{}) {
	pitwallState, ok := state.(dto.PitwallState)
	if !ok {
		return
	}

	variants := &pitwallBroadcastVariants{
		cache: make(map[string][]byte),
		state: pitwallState,
	}

	dropped, total := b.peerManager.BroadcastPerPeer(func(_ string, permissions signaling.Permissions, view string) []byte {
		return variants.resolve(permissions, view)
	})
	b.lastDrops.Store(int32(dropped))
	b.lastTotal.Store(int32(total))
}

// Broadcast sends the message to all connected peers via DataChannel.
// For non-pitwallState messages only (raceControl, battleAlert, etc.).
func (b *DataChannelBroadcaster) Broadcast(message []byte) {
	b.peerManager.BroadcastAll(message)
}

type pitwallBroadcastVariants struct {
	cache map[string][]byte
	state dto.PitwallState
}

func (v *pitwallBroadcastVariants) resolve(permissions signaling.Permissions, view string) []byte {
	if v == nil {
		return nil
	}

	if view == "" {
		view = "cockpit"
	}

	key := view
	if permissions.ViewERSEstimate {
		key += "|ers-est"
	}
	if permissions.ViewERSActual {
		key += "|ers"
	}
	if permissions.ViewPitStatus {
		key += "|pit"
	}
	if permissions.ViewTopSpeed {
		key += "|top"
	}
	if permissions.ViewPlayerDelta {
		key += "|player-delta"
	}
	if permissions.ViewAdvancedStrategy {
		key += "|adv-strategy"
	}
	if permissions.ViewCommentary {
		key += "|commentary"
	}
	if permissions.ViewQualifying {
		key += "|qualifying"
	}
	if permissions.ViewCombat {
		key += "|combat"
	}
	if cached, ok := v.cache[key]; ok {
		return cached
	}

	state := v.state
	// Deep copy Drivers slice to avoid mutating the shared original
	if len(state.Drivers) > 0 {
		copied := make([]dto.DriverInfo, len(state.Drivers))
		copy(copied, state.Drivers)
		state.Drivers = copied
	}
	// Deep copy Session to avoid pointer aliasing across variants
	if state.Session != nil {
		sessionCopy := *state.Session
		state.Session = &sessionCopy
	}
	state.ERSComparisonEnabled = permissions.ViewERSEstimate && permissions.ViewERSActual && hasERSActualData(state.Drivers)
	state.ERSEstimateEnabled = permissions.ViewERSEstimate || view == "combat"

	// Pre-compute combat car positions (player + ahead + behind)
	var combatPos [3]int // [player, ahead, behind]
	if view == "combat" && state.PlayerIndex >= 0 && state.PlayerIndex < len(state.Drivers) {
		pp := state.Drivers[state.PlayerIndex].Position
		combatPos = [3]int{pp, pp - 1, pp + 1}
	}

	for i := range state.Drivers {
		isCombatCar := view == "combat" && (state.Drivers[i].Position == combatPos[0] ||
			state.Drivers[i].Position == combatPos[1] ||
			state.Drivers[i].Position == combatPos[2])

		if !permissions.ViewERSEstimate && !isCombatCar {
			state.Drivers[i].ERSEstimatePct = 0
			state.Drivers[i].ERSEstimateReady = false
		}
		if !permissions.ViewERSActual {
			state.Drivers[i].ERSStoreEnergy = 0
			state.Drivers[i].ERSDeployMode = 0
			state.Drivers[i].ERSDeployedThisLap = 0
			state.Drivers[i].ERSHarvestedThisLap = 0
			state.Drivers[i].ERSActualPct = 0
			state.Drivers[i].ERSActualReady = false
		}
		if !permissions.ViewPitStatus {
			state.Drivers[i].PitStatus = 0
			state.Drivers[i].PitStopTimer = 0
			state.Drivers[i].PitLaneTime = 0
		}
		if !permissions.ViewTopSpeed {
			state.Drivers[i].TopSpeed = 0
		}
		if !permissions.ViewPlayerDelta {
			state.Drivers[i].DeltaToPlayer = 0
		}
		if !permissions.ViewCommentary && !permissions.ViewAdvancedStrategy {
			state.Drivers[i].TyreSetWear = nil
			state.Drivers[i].TyreLifeSpan = nil
			state.Drivers[i].TyreUsableLife = nil
			state.Drivers[i].AvailableSets = nil
			state.Drivers[i].BestSector1Ms = nil
			state.Drivers[i].BestSector2Ms = nil
			state.Drivers[i].BestSector3Ms = nil
			// Qualifying view needs DriverStatus for try/phase detection
			if view != "qualifying" {
				state.Drivers[i].DriverStatus = 0
			}
		}

		// View-based filtering: strip data not needed for current tab
		if view == "combat" {
			state.Drivers[i].StintHistory = nil
			state.Drivers[i].Dynamics = nil
			state.Drivers[i].ResultStatus = 0
			if !isCombatCar {
				// Non-combat cars: strip heavy fields, keep position basics
				state.Drivers[i].Speed = 0
				state.Drivers[i].Throttle = 0
				state.Drivers[i].Brake = 0
				state.Drivers[i].Steering = 0
				state.Drivers[i].BrakeTemp = [4]int{}
				state.Drivers[i].TireSurfaceTemp = [4]int{}
				state.Drivers[i].TireInnerTemp = [4]int{}
				state.Drivers[i].FuelInTank = 0
				state.Drivers[i].FuelRemainingLaps = 0
				state.Drivers[i].ERSDeployedThisLap = 0
				state.Drivers[i].ERSHarvestedThisLap = 0
				state.Drivers[i].Damage = nil
			}
		}
		if view != "commentary" {
			state.Drivers[i].ResultStatus = 0
		}
	}

	// MarshalZones only needed for commentary (flags) and qualifying
	if (view == "cockpit" || view == "combat") && state.Session != nil {
		state.Session.MarshalZones = nil
	}
	// Combat view: strip heavy session data not needed
	if view == "combat" && state.Session != nil {
		state.Session.WeatherForecast = nil
		state.Session.CrossoverPrediction = nil
	}
	// Combat view: no track map or positions needed
	if view == "combat" {
		state.TrackMap = nil
		state.Positions = nil
	}

	payload, err := dto.MsgpackMarshal(dto.WSResponse{
		Type: dto.MessageTypePitwallState,
		Data: state,
	})
	if err != nil {
		return nil
	}
	v.cache[key] = payload
	return payload
}

func hasERSActualData(drivers []dto.DriverInfo) bool {
	for _, driver := range drivers {
		if driver.ERSActualReady {
			return true
		}
	}
	return false
}
