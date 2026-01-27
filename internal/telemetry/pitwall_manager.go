package telemetry

import (
	"sync"

	"frc.engineer/internal/dto"
	"frc.engineer/internal/packets"
)

// PitwallManager aggregates data from multiple packet types into a unified PitwallState
type PitwallManager struct {
	mu sync.RWMutex

	session      *packets.PacketSessionData
	participants *packets.PacketParticipantsData
	motion       *packets.PacketMotionData
	carStatus    *packets.PacketCarStatusData
	lapData      *packets.PacketLapData
	telemetry    *packets.PacketCarTelemetryData
	carDamage    *packets.PacketCarDamageData
	playerIndex  uint8
	strategyMgr  *StrategyManager
}

// NewPitwallManager creates a new PitwallManager
func NewPitwallManager(strategyMgr *StrategyManager) *PitwallManager {
	return &PitwallManager{
		strategyMgr: strategyMgr,
	}
}

// UpdateSession stores the latest session packet
func (pm *PitwallManager) UpdateSession(s *packets.PacketSessionData) {
	pm.mu.Lock()
	pm.session = s
	pm.mu.Unlock()
}

// UpdateParticipants stores the latest participants packet
func (pm *PitwallManager) UpdateParticipants(p *packets.PacketParticipantsData) {
	pm.mu.Lock()
	pm.participants = p
	pm.mu.Unlock()
}

// UpdateMotion stores the latest motion packet
func (pm *PitwallManager) UpdateMotion(m *packets.PacketMotionData, playerIndex uint8) {
	pm.mu.Lock()
	pm.motion = m
	pm.playerIndex = playerIndex
	pm.mu.Unlock()
}

// UpdateCarStatus stores the latest car status packet and updates strategy tracking
func (pm *PitwallManager) UpdateCarStatus(cs *packets.PacketCarStatusData) {
	pm.mu.Lock()
	pm.carStatus = cs
	lapData := pm.lapData
	pm.mu.Unlock()
	pm.strategyMgr.Update(cs, lapData)
}

// UpdateLapData stores the latest lap data (all 22 cars) for position/timing
func (pm *PitwallManager) UpdateLapData(ld *packets.PacketLapData) {
	pm.mu.Lock()
	pm.lapData = ld
	pm.mu.Unlock()
}

// UpdateTelemetry stores the latest telemetry packet (for tire temps)
func (pm *PitwallManager) UpdateTelemetry(t *packets.PacketCarTelemetryData) {
	pm.mu.Lock()
	pm.telemetry = t
	pm.mu.Unlock()
}

// UpdateCarDamage stores the latest car damage packet
func (pm *PitwallManager) UpdateCarDamage(cd *packets.PacketCarDamageData) {
	pm.mu.Lock()
	pm.carDamage = cd
	pm.mu.Unlock()
}

// BuildState constructs the PitwallState DTO from all cached packet data
func (pm *PitwallManager) BuildState() *dto.PitwallState {
	pm.mu.RLock()
	defer pm.mu.RUnlock()

	state := &dto.PitwallState{
		PlayerIndex: int(pm.playerIndex),
	}

	// Session info
	if pm.session != nil {
		state.Session = &dto.SessionInfo{
			Weather:     weatherString(pm.session.Weather),
			TrackTemp:   float32(pm.session.TrackTemperature),
			AirTemp:     float32(pm.session.AirTemperature),
			SafetyCar:   safetyCarString(pm.session.SafetyCarStatus),
			SessionType: sessionTypeString(pm.session.SessionType),
			TotalLaps:   int(pm.session.TotalLaps),
			TrackID:     pm.session.TrackID,
			TrackLength: int(pm.session.TrackLength),
		}
	}

	// Car positions from motion data
	if pm.motion != nil {
		state.Positions = make([]dto.CarPosition, packets.MaxCars)
		for i := range packets.MaxCars {
			m := &pm.motion.CarMotionData[i]
			state.Positions[i] = dto.CarPosition{
				Index: i,
				X:     m.WorldPositionX,
				Y:     m.WorldPositionY,
				Z:     m.WorldPositionZ,
			}
		}
	}

	// Driver info (merge participants, lap data, car status)
	numCars := packets.MaxCars
	if pm.participants != nil && int(pm.participants.NumActiveCars) < numCars {
		numCars = int(pm.participants.NumActiveCars)
	}

	if numCars > 0 {
		state.Drivers = make([]dto.DriverInfo, numCars)
		for i := range numCars {
			d := &state.Drivers[i]
			d.Index = i

			if pm.participants != nil {
				p := &pm.participants.Participants[i]
				d.Name = p.GetName()
				d.TeamID = int(p.TeamID)
			}

			if pm.lapData != nil {
				ld := &pm.lapData.LapData[i]
				d.Position = int(ld.CarPosition)
				d.CurrentLapNum = int(ld.CurrentLapNum)
				d.LastLapTime = float32(ld.LastLapTimeInMS)
				d.BestLapTime = 0
				d.PitStatus = int(ld.PitStatus)
				d.NumPitStops = int(ld.NumPitStops)
				d.LapDistance = ld.LapDistance
				d.PitStopTimer = float32(ld.PitStopTimerInMS) / 1000.0
				// Guard against int16 boundary values (-32768) which indicate invalid data
				if ld.DeltaToCarInFrontInMS != -32768 {
					d.DeltaToCarInFront = int(ld.DeltaToCarInFrontInMS)
				}
				if ld.DeltaToRaceLeaderInMS != -32768 {
					d.DeltaToRaceLeader = int(ld.DeltaToRaceLeaderInMS)
				}
				d.PitLaneTime = int(ld.PitLaneTimeInLaneInMS)
			}

			if pm.carStatus != nil {
				cs := &pm.carStatus.CarStatusData[i]
				d.TireCompound = tireCompoundString(cs.VisualTyreCompound)
				d.TireAge = int(cs.TyresAgeLaps)
				d.FuelInTank = cs.FuelInTank
				d.FuelRemainingLaps = cs.FuelRemainingLaps
				d.FuelMix = int(cs.FuelMix)
				d.ERSStoreEnergy = cs.ERSStoreEnergy
				d.ERSDeployMode = int(cs.ERSDeployMode)
				d.ERSDeployedThisLap = cs.ERSDeployedThisLap
				d.ERSHarvestedThisLap = cs.ERSHarvestedThisLapMGUK + cs.ERSHarvestedThisLapMGUH
			}

			// Stint history from strategy manager
			ds := pm.strategyMgr.GetDriverStrategy(i)
			if len(ds.StintHistory) > 0 {
				d.StintHistory = make([]dto.StintInfoDTO, len(ds.StintHistory))
				for si, s := range ds.StintHistory {
					d.StintHistory[si] = dto.StintInfoDTO{Compound: s.Compound, Laps: s.Laps}
				}
			}

			if pm.telemetry != nil {
				ct := &pm.telemetry.CarTelemetryData[i]
				for w := range 4 {
					d.TireTemp[w] = int(ct.TyresSurfaceTemperature[w])
				}
			}

			if pm.carDamage != nil {
				cd := &pm.carDamage.CarDamageData[i]
				d.Damage = &dto.CarDamage{
					FrontLeftWing:  int(cd.FrontLeftWingDamage),
					FrontRightWing: int(cd.FrontRightWingDamage),
					RearWing:       int(cd.RearWingDamage),
					Floor:          int(cd.FloorDamage),
					Diffuser:       int(cd.DiffuserDamage),
					Sidepod:        int(cd.SidepodDamage),
					Engine:         int(cd.EngineDamage),
					Gearbox:        int(cd.GearBoxDamage),
					DRSFault:       cd.DRSFault == 1,
					ERSFault:       cd.ERSFault == 1,
				}
				// Also populate tire wear from damage packet
				for w := range 4 {
					d.TireWear[w] = int(cd.TyresWear[w])
				}
			}
		}
	}

	return state
}

// HasData returns true if at least session or motion data has been received
func (pm *PitwallManager) HasData() bool {
	pm.mu.RLock()
	defer pm.mu.RUnlock()
	return pm.session != nil || pm.motion != nil
}

func weatherString(w uint8) string {
	switch w {
	case 0:
		return "clear"
	case 1:
		return "light_cloud"
	case 2:
		return "overcast"
	case 3:
		return "light_rain"
	case 4:
		return "heavy_rain"
	case 5:
		return "storm"
	default:
		return "unknown"
	}
}

func safetyCarString(s uint8) string {
	switch s {
	case 0:
		return "none"
	case 1:
		return "full"
	case 2:
		return "virtual"
	case 3:
		return "formation"
	default:
		return "unknown"
	}
}

func sessionTypeString(s uint8) string {
	types := map[uint8]string{
		0: "unknown", 1: "P1", 2: "P2", 3: "P3", 4: "Short P",
		5: "Q1", 6: "Q2", 7: "Q3", 8: "Short Q", 9: "OSQ",
		10: "Race", 11: "Race 2", 12: "Race 3", 13: "Time Trial",
	}
	if t, ok := types[s]; ok {
		return t
	}
	return "unknown"
}

func tireCompoundString(v uint8) string {
	switch v {
	case 16:
		return "soft"
	case 17:
		return "medium"
	case 18:
		return "hard"
	case 7:
		return "inter"
	case 8:
		return "wet"
	default:
		return "unknown"
	}
}
