package telemetry

import (
	"math"
	"sync"

	"frc.engineer/internal/dto"
	"frc.engineer/internal/packets"
	"frc.engineer/internal/tracks"
)

// sanitize replaces NaN/Inf float32 with 0
func sanitize(v float32) float32 {
	if math.IsNaN(float64(v)) || math.IsInf(float64(v), 0) {
		return 0
	}
	return v
}

// PitwallManager aggregates data from multiple packet types into a unified PitwallState
type PitwallManager struct {
	mu sync.RWMutex

	session           *packets.PacketSessionData
	participants      *packets.PacketParticipantsData
	motion            *packets.PacketMotionData
	carStatus         *packets.PacketCarStatusData
	lapData           *packets.PacketLapData
	telemetry         *packets.PacketCarTelemetryData
	carDamage         *packets.PacketCarDamageData
	carSetups         *packets.PacketCarSetupData
	motionEx          *packets.PacketMotionExData
	playerIndex       uint8
	strategyMgr       *StrategyManager
	trackStore        *tracks.TrackStore
	recorder          *TrackRecorder
	dynamicsAnalyzer  *DynamicsAnalyzer
	ersEstimator      *ERSEstimator
	ersCompareEnabled bool
}

// NewPitwallManager creates a new PitwallManager
func NewPitwallManager(strategyMgr *StrategyManager, trackStore *tracks.TrackStore, recorder *TrackRecorder) *PitwallManager {
	return &PitwallManager{
		strategyMgr:      strategyMgr,
		trackStore:       trackStore,
		recorder:         recorder,
		dynamicsAnalyzer: NewDynamicsAnalyzer(),
		ersEstimator:     NewERSEstimator(trackStore),
	}
}

// SetRecorder sets the track recorder
func (pm *PitwallManager) SetRecorder(r *TrackRecorder) {
	pm.mu.Lock()
	pm.recorder = r
	pm.mu.Unlock()
}

// SetERSComparisonEnabled toggles sending actual-vs-estimate comparison fields.
func (pm *PitwallManager) SetERSComparisonEnabled(enabled bool) {
	pm.mu.Lock()
	pm.ersCompareEnabled = enabled
	pm.mu.Unlock()
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

// UpdateMotion stores the latest motion packet and feeds track recorder
func (pm *PitwallManager) UpdateMotion(m *packets.PacketMotionData, playerIndex uint8) {
	pm.mu.Lock()
	pm.motion = m
	pm.playerIndex = playerIndex

	// Capture recorder inputs under lock, call recorder outside lock
	var rec *TrackRecorder
	var trackID int8
	var trackName string
	var lapDist float32
	var lapNum uint8
	var wx, wy, wz float32
	var drs, sector int

	if pm.session != nil && pm.lapData != nil && int(playerIndex) < packets.MaxCars {
		idx := int(playerIndex)
		car := &m.CarMotionData[idx]
		ld := &pm.lapData.LapData[idx]

		if pm.recorder != nil {
			rec = pm.recorder
			trackID = pm.session.TrackID
			trackName = tracks.TrackName(trackID)
			lapDist = ld.LapDistance
			lapNum = ld.CurrentLapNum
			wx = car.WorldPositionX
			wy = car.WorldPositionY
			wz = car.WorldPositionZ
			sector = int(ld.Sector)

			if pm.telemetry != nil {
				drs = int(pm.telemetry.CarTelemetryData[idx].DRS)
			}
		}

		// Feed dynamics analyzer (under lock since it modifies state)
		if pm.telemetry != nil {
			tel := &pm.telemetry.CarTelemetryData[idx]
			pm.dynamicsAnalyzer.ProcessFrame(
				car.WorldVelocityX, car.WorldVelocityZ, car.Yaw,
				tel.Speed, tel.Steer, tel.Brake,
				ld.CurrentLapNum,
			)

		}
	}

	pm.mu.Unlock()

	if rec != nil {
		rec.RecordPoint(trackID, trackName, lapDist, lapNum, wx, wy, wz, drs, sector)
	}
}

// UpdateMotionEx stores the latest motion ex packet
func (pm *PitwallManager) UpdateMotionEx(m *packets.PacketMotionExData) {
	pm.mu.Lock()
	pm.motionEx = m
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
	carStatus := pm.carStatus
	pm.mu.Unlock()
	pm.strategyMgr.Update(carStatus, ld)
}

// UpdateTelemetry stores the latest telemetry packet (for tire temps)
func (pm *PitwallManager) UpdateTelemetry(t *packets.PacketCarTelemetryData) {
	pm.mu.Lock()
	pm.telemetry = t
	pm.mu.Unlock()
}

// UpdateCarSetups stores the latest car setups packet
func (pm *PitwallManager) UpdateCarSetups(cs *packets.PacketCarSetupData) {
	pm.mu.Lock()
	pm.carSetups = cs
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
		PlayerIndex:          int(pm.playerIndex),
		ERSComparisonEnabled: pm.ersCompareEnabled,
	}

	// Session info
	if pm.session != nil {
		si := &dto.SessionInfo{
			Weather:                weatherString(pm.session.Weather),
			TrackTemp:              float32(pm.session.TrackTemperature),
			AirTemp:                float32(pm.session.AirTemperature),
			SafetyCar:              safetyCarString(pm.session.SafetyCarStatus),
			SessionType:            sessionTypeString(pm.session.SessionType),
			TotalLaps:              int(pm.session.TotalLaps),
			TrackID:                pm.session.TrackID,
			TrackName:              tracks.TrackName(pm.session.TrackID),
			TrackLength:            int(pm.session.TrackLength),
			PitStopWindowIdealLap:  int(pm.session.PitStopWindowIdealLap),
			PitStopWindowLatestLap: int(pm.session.PitStopWindowLatestLap),
			PitStopRejoinPosition:  int(pm.session.PitStopRejoinPosition),
		}
		numZones := int(pm.session.NumMarshalZones)
		if numZones > 21 {
			numZones = 21
		}
		if numZones > 0 {
			si.MarshalZones = make([]dto.MarshalZoneDTO, numZones)
			for i := range numZones {
				mz := &pm.session.MarshalZones[i]
				si.MarshalZones[i] = dto.MarshalZoneDTO{
					Start: mz.ZoneStart,
					Flag:  mz.ZoneFlag,
				}
			}
		}
		// Weather forecast samples
		numForecast := int(pm.session.NumWeatherForecastSamples)
		if numForecast > 64 {
			numForecast = 64
		}
		if numForecast > 0 {
			si.WeatherForecast = make([]dto.WeatherForecastDTO, numForecast)
			for i := range numForecast {
				fs := &pm.session.WeatherForecastSamples[i]
				si.WeatherForecast[i] = dto.WeatherForecastDTO{
					SessionType:     sessionTypeString(fs.SessionType),
					TimeOffset:      int(fs.TimeOffset),
					Weather:         weatherString(fs.Weather),
					TrackTemp:       float32(fs.TrackTemperature),
					TrackTempChange: int(fs.TrackTemperatureChange),
					AirTemp:         float32(fs.AirTemperature),
					AirTempChange:   int(fs.AirTemperatureChange),
					RainPercentage:  int(fs.RainPercentage),
				}
			}
		}
		prediction := pm.strategyMgr.GetCrossoverPrediction()
		if prediction.Available || prediction.Reason != "" {
			si.CrossoverPrediction = &dto.CrossoverPredictionDTO{
				Available:          prediction.Available,
				DryGroup:           prediction.DryGroup,
				WetGroup:           prediction.WetGroup,
				CurrentDeltaMS:     prediction.CurrentDeltaMS,
				TrendDeltaMSPerLap: prediction.TrendDeltaMSPerLap,
				AvgLapTimeMS:       prediction.AvgLapTimeMS,
				DrySampleCount:     prediction.DrySampleCount,
				WetSampleCount:     prediction.WetSampleCount,
				HistoryDepth:       prediction.HistoryDepth,
				CurrentDryAvgMS:    prediction.CurrentDryAvgMS,
				CurrentWetAvgMS:    prediction.CurrentWetAvgMS,
				Reason:             prediction.Reason,
			}
		}
		state.Session = si
	}

	// Track map from pre-loaded CSV data
	if pm.session != nil && pm.trackStore != nil {
		if td := pm.trackStore.Get(pm.session.TrackID); td != nil {
			state.TrackMap = &dto.TrackMapDTO{
				Points: make([]dto.TrackPointDTO, len(td.Points)),
				MinX:   td.MinX,
				MaxX:   td.MaxX,
				MinZ:   td.MinZ,
				MaxZ:   td.MaxZ,
			}
			for i, p := range td.Points {
				state.TrackMap.Points[i] = dto.TrackPointDTO{
					X:      p.X,
					Z:      p.Z,
					Sector: p.Sector,
					DRS:    p.DRS,
				}
			}
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
	// Always include at least up to playerIndex+1 so the player is in the array
	numCars := packets.MaxCars
	if pm.participants != nil && int(pm.participants.NumActiveCars) < numCars {
		numCars = int(pm.participants.NumActiveCars)
	}
	if int(pm.playerIndex) >= numCars {
		numCars = int(pm.playerIndex) + 1
	}
	if numCars > packets.MaxCars {
		numCars = packets.MaxCars
	}

	if numCars > 0 {
		ersEstimates := pm.ersEstimator.Update(pm.session, pm.participants, pm.lapData, pm.telemetry, pm.carStatus)
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
				d.DriverStatus = int(ld.DriverStatus)
				d.NumPitStops = int(ld.NumPitStops)
				d.LapDistance = sanitize(ld.LapDistance)
				d.PitStopTimer = float32(ld.PitStopTimerInMS) / 1000.0
				d.Sector1TimeMs = int(ld.Sector1TimeMinutes)*60000 + int(ld.Sector1TimeInMS)
				d.Sector2TimeMs = int(ld.Sector2TimeMinutes)*60000 + int(ld.Sector2TimeInMS)
				d.CurrentSector = int(ld.Sector)
				d.DeltaToCarInFront = int(ld.DeltaToCarInFrontMinutesPart)*60000 + int(ld.DeltaToCarInFrontMSPart)
				d.DeltaToRaceLeader = int(ld.DeltaToRaceLeaderMinutesPart)*60000 + int(ld.DeltaToRaceLeaderMSPart)
				d.PitLaneTime = int(ld.PitLaneTimeInLaneInMS)
				d.Penalties = int(ld.Penalties)
				d.TotalWarnings = int(ld.TotalWarnings)
				d.CornerCuttingWarnings = int(ld.CornerCuttingWarnings)
				d.NumUnservedDriveThroughs = int(ld.NumUnservedDriveThroughs)
				d.NumUnservedStopGoPenalties = int(ld.NumUnservedStopGoPenalties)
			}

			if pm.carStatus != nil {
				cs := &pm.carStatus.CarStatusData[i]
				d.TireCompound = tireCompoundString(cs.VisualTyreCompound)
				d.TireAge = int(cs.TyresAgeLaps)
				d.FuelInTank = sanitize(cs.FuelInTank)
				d.FuelRemainingLaps = sanitize(cs.FuelRemainingLaps)
				d.FuelMix = int(cs.FuelMix)
				d.ERSStoreEnergy = sanitize(cs.ERSStoreEnergy)
				d.ERSDeployMode = int(cs.ERSDeployMode)
				d.ERSDeployedThisLap = sanitize(cs.ERSDeployedThisLap)
				d.ERSHarvestedThisLap = sanitize(cs.ERSHarvestedThisLapMGUK + cs.ERSHarvestedThisLapMGUH)
				d.BrakeBias = int(cs.FrontBrakeBias)
				if pm.ersCompareEnabled && ersActualAvailable(pm.participants, pm.playerIndex, i) {
					d.ERSActualPct = ersPercent(cs.ERSStoreEnergy)
					d.ERSActualReady = true
				}
			}
			d.ERSEstimatePct = ersEstimates[i].Percent
			d.ERSEstimateReady = ersEstimates[i].Ready

			if pm.carSetups != nil {
				setup := &pm.carSetups.CarSetupData[i]
				d.DiffOnThrottle = int(setup.OnThrottle)
				d.DiffOffThrottle = int(setup.OffThrottle)
			}

			// Stint history from strategy manager
			ds := pm.strategyMgr.GetDriverStrategy(i)
			if len(ds.StintHistory) > 0 {
				d.StintHistory = make([]dto.StintInfoDTO, len(ds.StintHistory))
				for si, s := range ds.StintHistory {
					d.StintHistory[si] = dto.StintInfoDTO{Compound: s.Compound, Laps: s.Laps}
				}
			}

			// Vehicle dynamics (player car only)
			if i == int(pm.playerIndex) {
				d.Dynamics = pm.dynamicsAnalyzer.GetLapDynamics()
			}

			// F1 game order: [RL, RR, FL, FR] -> DTO order: [FL, FR, RL, RR]
			var g2d = [4]int{2, 3, 0, 1}

			if pm.telemetry != nil {
				ct := &pm.telemetry.CarTelemetryData[i]
				d.Speed = ct.Speed
				d.Throttle = sanitize(ct.Throttle)
				d.Brake = sanitize(ct.Brake)
				d.Gear = ct.Gear
				d.Steering = sanitize(ct.Steer)
				for w := range 4 {
					g := g2d[w]
					d.TireSurfaceTemp[w] = int(ct.TyresSurfaceTemperature[g])
					d.TireInnerTemp[w] = int(ct.TyresInnerTemperature[g])
					d.BrakeTemp[w] = int(ct.BrakesTemperature[g])
				}
			}

			if pm.carDamage != nil {
				cd := &pm.carDamage.CarDamageData[i]
				d.Damage = &dto.CarDamage{
					FrontLeftWing:  clampDamage(cd.FrontLeftWingDamage),
					FrontRightWing: clampDamage(cd.FrontRightWingDamage),
					RearWing:       clampDamage(cd.RearWingDamage),
					Floor:          clampDamage(cd.FloorDamage),
					Diffuser:       clampDamage(cd.DiffuserDamage),
					Sidepod:        clampDamage(cd.SidepodDamage),
					Engine:         clampDamage(cd.EngineDamage),
					Gearbox:        clampDamage(cd.GearBoxDamage),
					DRSFault:       cd.DRSFault == 1,
					ERSFault:       cd.ERSFault == 1,
				}
				// Also populate tire wear from damage packet (game sends 0-100% float)
				for w := range 4 {
					wear := math.Round(float64(cd.TyresWear[g2d[w]]))
					if wear < 0 {
						wear = 0
					} else if wear > 100 {
						wear = 100
					}
					d.TireWear[w] = int(wear)
				}
			}
		}
	}

	return state
}

// GetDriverName returns the name for a vehicle index, or empty string if unknown.
func (pm *PitwallManager) GetDriverName(vehicleIdx uint8) string {
	pm.mu.RLock()
	defer pm.mu.RUnlock()
	if pm.participants == nil || int(vehicleIdx) >= len(pm.participants.Participants) {
		return ""
	}
	return pm.participants.Participants[vehicleIdx].GetName()
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
		10: "SS1", 11: "SS2", 12: "SS3", 13: "Short SS", 14: "OSS",
		15: "Race", 16: "Race 2", 17: "Race 3", 18: "Time Trial",
	}
	if t, ok := types[s]; ok {
		return t
	}
	return "unknown"
}

func clampDamage(v uint8) int {
	if v > 100 {
		return 100
	}
	return int(v)
}

func ersPercent(energy float32) int {
	const maxERSEnergy = 4_000_000.0
	pct := (float64(sanitize(energy)) / maxERSEnergy) * 100
	if pct < 0 {
		pct = 0
	} else if pct > 100 {
		pct = 100
	}
	return int(math.Round(pct))
}

func ersActualAvailable(participants *packets.PacketParticipantsData, playerIndex uint8, idx int) bool {
	if idx == int(playerIndex) {
		return true
	}
	if participants == nil || idx < 0 || idx >= len(participants.Participants) {
		return false
	}
	return participants.Participants[idx].YourTelemetry == 1
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
