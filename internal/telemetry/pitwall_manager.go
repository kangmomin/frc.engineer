package telemetry

import (
	"fmt"
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
	tyreSets          [packets.MaxCars]*packets.PacketTyreSetsData
	sessionHistory    [packets.MaxCars]*packets.PacketSessionHistoryData
	motionEx          *packets.PacketMotionExData
	playerIndex       uint8
	strategyMgr       *StrategyManager
	trackStore        *tracks.TrackStore
	recorder          *TrackRecorder
	dynamicsAnalyzer  *DynamicsAnalyzer
	ersEstimator      *ERSEstimator
	ersActualEnabled   bool
	ersCompareEnabled  bool
	trackMapSendCount  int  // remaining broadcasts to include trackMap
	lastTrackID        int8 // last track ID for change detection
	peakActiveCars     int  // high-water mark for NumActiveCars
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

// SetERSActualEnabled toggles population of actual ERS fields for downstream filtering.
func (pm *PitwallManager) SetERSActualEnabled(enabled bool) {
	pm.mu.Lock()
	pm.ersActualEnabled = enabled
	pm.mu.Unlock()
}

// ResendTrackMap forces trackMap to be included in the next few broadcasts.
// Call this when a new peer connects so they receive the track outline.
func (pm *PitwallManager) ResendTrackMap() {
	pm.mu.Lock()
	pm.trackMapSendCount = 8
	pm.mu.Unlock()
}

// UpdateSession stores the latest session packet
func (pm *PitwallManager) UpdateSession(s *packets.PacketSessionData) {
	pm.mu.Lock()
	if pm.session == nil || pm.session.SessionType != s.SessionType {
		fmt.Printf("[DEBUG] Session: type=%d timeLeft=%d duration=%d\n",
			s.SessionType, s.SessionTimeLeft, s.SessionDuration)
	}
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

// UpdateTyreSets stores the latest tyre sets packet for a specific car
func (pm *PitwallManager) UpdateTyreSets(ts *packets.PacketTyreSetsData) {
	if int(ts.CarIdx) >= packets.MaxCars {
		return
	}
	pm.mu.Lock()
	pm.tyreSets[ts.CarIdx] = ts
	pm.mu.Unlock()
}

// UpdateSessionHistory stores the latest session history packet for a specific car
func (pm *PitwallManager) UpdateSessionHistory(sh *packets.PacketSessionHistoryData) {
	if int(sh.CarIdx) >= packets.MaxCars {
		return
	}
	pm.mu.Lock()
	pm.sessionHistory[sh.CarIdx] = sh
	pm.mu.Unlock()
}

// BuildState constructs the PitwallState DTO from all cached packet data
func (pm *PitwallManager) BuildState() *dto.PitwallState {
	pm.mu.RLock()
	defer pm.mu.RUnlock()

	state := &dto.PitwallState{
		PlayerIndex:          int(pm.playerIndex),
		ERSEstimateEnabled:   true, // broadcaster filters per-peer via ViewERSEstimate
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
			SessionTimeLeft:        int(pm.session.SessionTimeLeft),
			SessionDuration:        int(pm.session.SessionDuration),
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
		// Weather forecast samples — current session only
		numForecast := int(pm.session.NumWeatherForecastSamples)
		if numForecast > 64 {
			numForecast = 64
		}
		if numForecast > 0 {
			forecasts := make([]dto.WeatherForecastDTO, 0, numForecast)
			for i := range numForecast {
				fs := &pm.session.WeatherForecastSamples[i]
				if fs.SessionType != pm.session.SessionType {
					continue
				}
				forecasts = append(forecasts, dto.WeatherForecastDTO{
					SessionType:     sessionTypeString(fs.SessionType),
					TimeOffset:      int(fs.TimeOffset),
					Weather:         weatherString(fs.Weather),
					TrackTemp:       float32(fs.TrackTemperature),
					TrackTempChange: int(fs.TrackTemperatureChange),
					AirTemp:         float32(fs.AirTemperature),
					AirTempChange:   int(fs.AirTemperatureChange),
					RainPercentage:  int(fs.RainPercentage),
				})
			}
			if len(forecasts) > 0 {
				si.WeatherForecast = forecasts
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

	// Track map from pre-loaded CSV data (included for first 8 broadcasts per track change)
	if pm.session != nil && pm.trackStore != nil {
		currentTrackID := pm.session.TrackID
		if int8(currentTrackID) != pm.lastTrackID {
			pm.lastTrackID = int8(currentTrackID)
			pm.trackMapSendCount = 8 // ~2 seconds at 4Hz
			// Clear per-car caches on session change
			pm.tyreSets = [packets.MaxCars]*packets.PacketTyreSetsData{}
			pm.sessionHistory = [packets.MaxCars]*packets.PacketSessionHistoryData{}
			pm.peakActiveCars = 0
		}
		if pm.trackMapSendCount > 0 {
			if td := pm.trackStore.Get(currentTrackID); td != nil {
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
			pm.trackMapSendCount--
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
				Yaw:   m.Yaw,
			}
		}
	}

	// Driver info (merge participants, lap data, car status)
	// Use high-water mark to prevent drivers from disappearing when NumActiveCars fluctuates
	numCars := packets.MaxCars
	if pm.participants != nil {
		active := int(pm.participants.NumActiveCars)
		if active > pm.peakActiveCars {
			pm.peakActiveCars = active
		}
		if pm.peakActiveCars > 0 && pm.peakActiveCars < numCars {
			numCars = pm.peakActiveCars
		}
	}
	if int(pm.playerIndex) >= numCars {
		numCars = int(pm.playerIndex) + 1
	}
	if numCars > packets.MaxCars {
		numCars = packets.MaxCars
	}

	if numCars > 0 {
		ersEstimates := pm.ersEstimator.Update(pm.session, pm.participants, pm.lapData, pm.telemetry, pm.carStatus, pm.playerIndex)
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
				d.PitStatus = int(ld.PitStatus)
				d.DriverStatus = int(ld.DriverStatus)
				d.ResultStatus = int(ld.ResultStatus)
				d.NumPitStops = int(ld.NumPitStops)
				d.LapDistance = sanitize(ld.LapDistance)
				d.PitStopTimer = float32(ld.PitStopTimerInMS) / 1000.0
				d.Sector1TimeMs = int(ld.Sector1TimeMinutes)*60000 + int(ld.Sector1TimeInMS)
				d.Sector2TimeMs = int(ld.Sector2TimeMinutes)*60000 + int(ld.Sector2TimeInMS)
				d.CurrentSector = int(ld.Sector)
				d.DeltaToCarInFront = int(ld.DeltaToCarInFrontMinutesPart)*60000 + int(ld.DeltaToCarInFrontMSPart)
				d.DeltaToRaceLeader = int(ld.DeltaToRaceLeaderMinutesPart)*60000 + int(ld.DeltaToRaceLeaderMSPart)
				d.TopSpeed = int(math.Round(float64(sanitize(ld.SpeedTrapFastestSpeed))))
				d.PitLaneTime = int(ld.PitLaneTimeInLaneInMS)
				d.Penalties = int(ld.Penalties)
				d.TotalWarnings = int(ld.TotalWarnings)
				d.CornerCuttingWarnings = int(ld.CornerCuttingWarnings)
				d.NumUnservedDriveThroughs = int(ld.NumUnservedDriveThroughs)
				d.NumUnservedStopGoPenalties = int(ld.NumUnservedStopGoPenalties)
				d.LapInvalid = ld.CurrentLapInvalid == 1
			}

			if pm.carStatus != nil {
				cs := &pm.carStatus.CarStatusData[i]
				d.TireCompound = tireCompoundString(cs.VisualTyreCompound)
				d.TireAge = int(cs.TyresAgeLaps)
				// d.FuelInTank – omitted from broadcast DTO
				d.FuelRemainingLaps = sanitize(cs.FuelRemainingLaps)
				// d.FuelMix – omitted from broadcast DTO
				d.ERSStoreEnergy = sanitize(cs.ERSStoreEnergy)
				d.ERSDeployMode = int(cs.ERSDeployMode)
				d.ERSDeployedThisLap = sanitize(cs.ERSDeployedThisLap)
				d.ERSHarvestedThisLap = sanitize(cs.ERSHarvestedThisLapMGUK + cs.ERSHarvestedThisLapMGUH)
				d.BrakeBias = int(cs.FrontBrakeBias)
				if pm.ersActualEnabled && ersActualAvailable(pm.participants, pm.playerIndex, i) {
					d.ERSActualPct = ersPercent(cs.ERSStoreEnergy)
					d.ERSActualReady = true
				}
			}
			d.ERSEstimatePct = ersEstimates[i].Percent
			d.ERSEstimateReady = ersEstimates[i].Ready

			if pm.carSetups != nil {
				setup := &pm.carSetups.CarSetupData[i]
				d.DiffOnThrottle = int(setup.OnThrottle)
				// d.DiffOffThrottle – omitted from broadcast DTO
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
				// Speed, Throttle, Brake, Gear, Steering – omitted from broadcast DTO
				for w := range 4 {
					g := g2d[w]
					d.TireSurfaceTemp[w] = int(ct.TyresSurfaceTemperature[g])
					d.TireInnerTemp[w] = int(ct.TyresInnerTemperature[g])
					// BrakeTemp – omitted from broadcast DTO
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

			if ts := pm.tyreSets[i]; ts != nil {
				fittedIdx := int(ts.FittedIdx)
				if fittedIdx >= 0 && fittedIdx < packets.MaxNumTyreSets {
					fitted := &ts.TyreSetData[fittedIdx]
					w, l, u := int(fitted.Wear), int(fitted.LifeSpan), int(fitted.UsableLife)
					d.TyreSetWear = &w
					d.TyreLifeSpan = &l
					d.TyreUsableLife = &u
				}
				// Aggregate available sets by compound
				counts := map[string]int{}
				for s := range packets.MaxNumTyreSets {
					set := &ts.TyreSetData[s]
					if set.Available == 1 && set.Fitted == 0 {
						compound := tireCompoundString(set.VisualTyreCompound)
						counts[compound]++
					}
				}
				if len(counts) > 0 {
					avail := make([]dto.TyreSetBrief, 0, len(counts))
					for _, c := range []string{"soft", "medium", "hard", "inter", "wet"} {
						if n, ok := counts[c]; ok {
							avail = append(avail, dto.TyreSetBrief{Compound: c, Count: n})
						}
					}
					d.AvailableSets = avail
				}
			}

			if sh := pm.sessionHistory[i]; sh != nil {
				numLaps := int(sh.NumLaps)
				// Best lap time
				blLap := int(sh.BestLapTimeLapNum)
				if blLap > 0 && blLap <= numLaps && blLap <= packets.MaxNumLapsInHistory {
					if t := sh.LapHistoryData[blLap-1].LapTimeInMS; t > 0 {
						d.BestLapTime = float32(t)
					}
				}
				// Best sector 1
				s1Lap := int(sh.BestSector1LapNum)
				if s1Lap > 0 && s1Lap <= numLaps && s1Lap <= packets.MaxNumLapsInHistory {
					s1 := sh.LapHistoryData[s1Lap-1].Sector1Ms()
					if s1 > 0 {
						d.BestSector1Ms = &s1
					}
				}
				// Best sector 2
				s2Lap := int(sh.BestSector2LapNum)
				if s2Lap > 0 && s2Lap <= numLaps && s2Lap <= packets.MaxNumLapsInHistory {
					s2 := sh.LapHistoryData[s2Lap-1].Sector2Ms()
					if s2 > 0 {
						d.BestSector2Ms = &s2
					}
				}
				// Best sector 3
				s3Lap := int(sh.BestSector3LapNum)
				if s3Lap > 0 && s3Lap <= numLaps && s3Lap <= packets.MaxNumLapsInHistory {
					s3 := sh.LapHistoryData[s3Lap-1].Sector3Ms()
					if s3 > 0 {
						d.BestSector3Ms = &s3
					}
				}
			}
		}

		playerIdx := int(pm.playerIndex)
		if playerIdx >= 0 && playerIdx < len(state.Drivers) {
			playerLeaderDelta := state.Drivers[playerIdx].DeltaToRaceLeader
			for i := range state.Drivers {
				state.Drivers[i].DeltaToPlayer = state.Drivers[i].DeltaToRaceLeader - playerLeaderDelta
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

// BuildPositions returns car positions from the latest motion packet.
// This is a lightweight alternative to BuildState for high-frequency broadcasting.
func (pm *PitwallManager) BuildPositions() []dto.CarPosition {
	pm.mu.RLock()
	defer pm.mu.RUnlock()

	if pm.motion == nil {
		return nil
	}

	numCars := packets.MaxCars
	if pm.participants != nil && int(pm.participants.NumActiveCars) < numCars {
		numCars = int(pm.participants.NumActiveCars)
	}

	positions := make([]dto.CarPosition, numCars)
	for i := range numCars {
		m := &pm.motion.CarMotionData[i]
		positions[i] = dto.CarPosition{
			Index: i,
			X:     m.WorldPositionX,
			Y:     m.WorldPositionY,
			Z:     m.WorldPositionZ,
			Yaw:   m.Yaw,
		}
	}
	return positions
}

// BuildRadarData returns a lightweight radar payload for the local overlay SSE stream.
func (pm *PitwallManager) BuildRadarData() *dto.RadarData {
	pm.mu.RLock()
	defer pm.mu.RUnlock()

	if pm.motion == nil {
		return nil
	}

	numCars := packets.MaxCars
	if pm.participants != nil && int(pm.participants.NumActiveCars) < numCars {
		numCars = int(pm.participants.NumActiveCars)
	}

	data := &dto.RadarData{
		PlayerIndex: int(pm.playerIndex),
		Cars:        make([]dto.RadarCarData, numCars),
	}
	for i := range numCars {
		m := &pm.motion.CarMotionData[i]
		car := dto.RadarCarData{
			Index: i,
			X:     m.WorldPositionX,
			Z:     m.WorldPositionZ,
			Yaw:   m.Yaw,
		}
		if pm.participants != nil {
			car.TeamID = int(pm.participants.Participants[i].TeamID)
		}
		data.Cars[i] = car
	}
	return data
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
