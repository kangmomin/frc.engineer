package telemetry

import (
	"math"
	"sync"

	"frc.engineer/internal/packets"
	"frc.engineer/internal/tracks"
)

const (
	// ERS 배터리 저장 용량. 2026 규정에서도 4MJ로 유지된다(FIA 기술 규정).
	// 2026 Season Pack 실게임 캡처에서 ERSStoreEnergy 최대값으로 재검증할 것.
	ersEstimateMaxEnergyJ        = 4_000_000.0
	ersEstimateDefaultEnergyJ    = ersEstimateMaxEnergyJ * 0.70
	ersEstimateBucketSizeM       = 100.0
	ersEstimateWarmupSteps       = 6
	ersEstimateProgressTolerance = 40.0
)

type ersPhase uint8

const (
	ersPhaseNeutral ersPhase = iota
	ersPhaseHarvest
	ersPhaseDeploy
	ersPhaseSustain
)

// ERSEstimate is the leaderboard-facing estimate snapshot for one car.
type ERSEstimate struct {
	Percent int
	Ready   bool
}

type ersBucketCalibration struct {
	deployRate     float64
	deploySamples  int
	harvestRate    float64
	harvestSamples int
}

type ersTrackProfile struct {
	bucketCount int
	drsBuckets  []bool
}

type ersCarState struct {
	initialized         bool
	energyJ             float64
	lastSessionTime     float64
	lastLapNum          int
	lastLapDistance     float64
	lastSpeed           float64
	lastDeployJ         float64
	lastHarvestJ        float64
	lastActualEnergyJ   float64
	lastActualKnown     bool
	lapStartEnergyJ     float64
	lapStartDeployJ     float64
	lapStartHarvestJ    float64
	validSteps          int
	completedLaps       int
	seenCounterMovement bool
}

// ERSEstimator tracks per-car ERS estimates and learns simple bucket rates from public telemetry.
type ERSEstimator struct {
	mu                 sync.Mutex
	trackStore         *tracks.TrackStore
	sessionUID         uint64
	trackID            int8
	trackProfile       ersTrackProfile
	bucketCalibration  []ersBucketCalibration
	calibrationSamples int
	peakActiveCars     int
	cars               [packets.MaxCars]ersCarState
}

// NewERSEstimator creates a new ERS estimator.
func NewERSEstimator(trackStore *tracks.TrackStore) *ERSEstimator {
	return &ERSEstimator{
		trackStore:        trackStore,
		trackProfile:      ersTrackProfile{bucketCount: 1, drsBuckets: []bool{false}},
		bucketCalibration: []ersBucketCalibration{{}},
	}
}

// Update advances the estimator and returns a full-car snapshot.
// carTelemetry2 is nil on F1 25; on the 2026 Season Pack it supplies the
// Overtake (Manual Override) state that replaces DRS as the deploy-boost signal.
func (e *ERSEstimator) Update(
	session *packets.PacketSessionData,
	participants *packets.PacketParticipantsData,
	lapData *packets.PacketLapData,
	telemetry *packets.PacketCarTelemetryData,
	carStatus *packets.PacketCarStatusData,
	carTelemetry2 *packets.PacketCarTelemetry2Data,
	playerIndex uint8,
) [packets.MaxCars]ERSEstimate {
	var out [packets.MaxCars]ERSEstimate
	if lapData == nil || telemetry == nil || carStatus == nil {
		return out
	}

	sessionUID := resolveEstimatorSessionUID(session, participants, lapData, telemetry, carStatus)
	if sessionUID == 0 {
		return out
	}
	sessionTime := resolveEstimatorSessionTime(session, participants, lapData, telemetry, carStatus)

	e.mu.Lock()
	defer e.mu.Unlock()

	if sessionUID != e.sessionUID {
		e.resetSession(sessionUID, session)
	} else if session != nil && (e.trackID != session.TrackID || len(e.bucketCalibration) == 0) {
		e.trackID = session.TrackID
		e.trackProfile = buildERSTrackProfile(e.trackStore, session.TrackID, float64(session.TrackLength))
		e.bucketCalibration = make([]ersBucketCalibration, e.trackProfile.bucketCount)
		e.calibrationSamples = 0
	}

	activeCars := packets.MaxCars
	if participants != nil && int(participants.NumActiveCars) > 0 {
		n := int(participants.NumActiveCars)
		if n > activeCars {
			n = activeCars
		}
		// Use high-water mark to prevent resetting cars when NumActiveCars fluctuates
		if n > e.peakActiveCars {
			e.peakActiveCars = n
		}
		if e.peakActiveCars > 0 {
			activeCars = e.peakActiveCars
		}
	}

	for i := 0; i < activeCars; i++ {
		lap := lapData.LapData[i]
		tel := telemetry.CarTelemetryData[i]
		status := carStatus.CarStatusData[i]

		// 배포 부스트 신호: F1 25는 DRS, 2026 모드는 Overtake(Manual Override).
		// OR-merge — 2026 모드에서도 pre-2026 규정 차량은 DRS를 쓸 수 있다
		// (processor/qualifying_overlay와 동일한 의미론).
		boostActive := tel.DRS == 1
		if carTelemetry2 != nil && carTelemetry2.CarTelemetry2Data[i].OvertakeActive == 1 {
			boostActive = true
		}

		lapNum := int(lap.CurrentLapNum)
		lapDistance := maxFloat64(float64(sanitize(lap.LapDistance)), 0)
		if lapNum <= 0 && lapDistance <= 0 && tel.Speed == 0 {
			e.cars[i] = ersCarState{}
			continue
		}

		car := &e.cars[i]
		deployTotal := maxFloat64(float64(sanitize(status.ERSDeployedThisLap)), 0)
		harvestTotal := maxFloat64(float64(sanitize(status.ERSHarvestedThisLapMGUK+status.ERSHarvestedThisLapMGUH)), 0)
		actualEnergy := clampFloat64(float64(sanitize(status.ERSStoreEnergy)), 0, ersEstimateMaxEnergyJ)
		hasActual := ersActualAvailable(participants, playerIndex, i)

		if car.initialized && lapNum > 0 && car.lastLapNum > 0 && lapNum < car.lastLapNum {
			e.cars[i] = ersCarState{}
			car = &e.cars[i]
		}

		if !car.initialized {
			e.initializeCar(car, lapNum, lapDistance, sessionTime, float64(tel.Speed), deployTotal, harvestTotal, actualEnergy, hasActual)
			out[i] = e.snapshotCar(car)
			continue
		}

		lapChanged := lapNum > car.lastLapNum
		progressValid := sessionTime > car.lastSessionTime && sessionTime-car.lastSessionTime <= 2.0
		progressValid = progressValid && (lapChanged || lapDistance+ersEstimateProgressTolerance >= car.lastLapDistance)

		if hasActual && car.lastActualKnown && progressValid && !lapChanged {
			bucket := e.bucketIndex(lapDistance)
			phase := classifyERSPhase(float64(tel.Throttle), float64(tel.Brake), float64(tel.Speed), float64(tel.Speed)-car.lastSpeed, int(status.ERSDeployMode), boostActive, e.trackProfile.drsBuckets[bucket])
			e.recordCalibration(bucket, phase, actualEnergy-car.lastActualEnergyJ, sessionTime-car.lastSessionTime)
		}

		if lapChanged {
			car.completedLaps++
			car.lapStartEnergyJ = car.energyJ
			car.lapStartDeployJ = deployTotal
			car.lapStartHarvestJ = harvestTotal
		}

		deployDelta := 0.0
		harvestDelta := 0.0
		if !lapChanged {
			deployDelta = maxFloat64(deployTotal-car.lastDeployJ, 0)
			harvestDelta = maxFloat64(harvestTotal-car.lastHarvestJ, 0)
		}

		if progressValid {
			if deployDelta > 0 || harvestDelta > 0 {
				car.energyJ = clampFloat64(car.energyJ+harvestDelta-deployDelta, 0, ersEstimateMaxEnergyJ)
			} else {
				bucket := e.bucketIndex(lapDistance)
				phase := classifyERSPhase(float64(tel.Throttle), float64(tel.Brake), float64(tel.Speed), float64(tel.Speed)-car.lastSpeed, int(status.ERSDeployMode), boostActive, e.trackProfile.drsBuckets[bucket])
				rate := estimateERSRate(phase, float64(tel.Throttle), float64(tel.Brake), float64(tel.Speed), int(status.ERSDeployMode), boostActive, e.trackProfile.drsBuckets[bucket])
				rate = e.applyCalibration(bucket, phase, rate)
				car.energyJ = clampFloat64(car.energyJ+(rate*(sessionTime-car.lastSessionTime)), 0, ersEstimateMaxEnergyJ)
			}
			car.validSteps++
		}

		if deployTotal > car.lastDeployJ+250 || harvestTotal > car.lastHarvestJ+250 {
			car.seenCounterMovement = true
		}

		if hasActual {
			car.energyJ = reanchorERSEnergy(car.energyJ, actualEnergy)
		}

		car.lastSessionTime = sessionTime
		car.lastLapNum = lapNum
		car.lastLapDistance = lapDistance
		car.lastSpeed = float64(tel.Speed)
		car.lastDeployJ = deployTotal
		car.lastHarvestJ = harvestTotal
		if hasActual {
			car.lastActualEnergyJ = actualEnergy
			car.lastActualKnown = true
		} else {
			car.lastActualEnergyJ = 0
			car.lastActualKnown = false
		}

		out[i] = e.snapshotCar(car)
	}

	return out
}

func (e *ERSEstimator) initializeCar(
	car *ersCarState,
	lapNum int,
	lapDistance float64,
	sessionTime float64,
	speed float64,
	deployTotal float64,
	harvestTotal float64,
	actualEnergy float64,
	hasActual bool,
) {
	initialEnergy := ersEstimateDefaultEnergyJ
	if hasActual {
		initialEnergy = actualEnergy
	}
	*car = ersCarState{
		initialized:       true,
		energyJ:           initialEnergy,
		lastSessionTime:   sessionTime,
		lastLapNum:        lapNum,
		lastLapDistance:   lapDistance,
		lastSpeed:         speed,
		lastDeployJ:       deployTotal,
		lastHarvestJ:      harvestTotal,
		lastActualEnergyJ: actualEnergy,
		lastActualKnown:   hasActual,
		lapStartEnergyJ:   initialEnergy,
		lapStartDeployJ:   deployTotal,
		lapStartHarvestJ:  harvestTotal,
	}
}

func (e *ERSEstimator) snapshotCar(car *ersCarState) ERSEstimate {
	// Ready after warmup steps — no need for deploy/harvest data or lap completion.
	// Restricted telemetry cars rely purely on throttle/brake/speed heuristics.
	ready := car.initialized && car.validSteps >= ersEstimateWarmupSteps
	return ERSEstimate{
		Percent: int(math.Round((car.energyJ / ersEstimateMaxEnergyJ) * 100)),
		Ready:   ready,
	}
}

func (e *ERSEstimator) resetSession(sessionUID uint64, session *packets.PacketSessionData) {
	e.sessionUID = sessionUID
	e.trackID = 0
	e.trackProfile = ersTrackProfile{bucketCount: 1, drsBuckets: []bool{false}}
	e.bucketCalibration = []ersBucketCalibration{{}}
	e.calibrationSamples = 0
	e.peakActiveCars = 0
	e.cars = [packets.MaxCars]ersCarState{}

	if session == nil {
		return
	}
	e.trackID = session.TrackID
	e.trackProfile = buildERSTrackProfile(e.trackStore, session.TrackID, float64(session.TrackLength))
	e.bucketCalibration = make([]ersBucketCalibration, e.trackProfile.bucketCount)
}

func (e *ERSEstimator) bucketIndex(lapDistance float64) int {
	if e.trackProfile.bucketCount <= 1 {
		return 0
	}
	idx := int(lapDistance / ersEstimateBucketSizeM)
	if idx < 0 {
		return 0
	}
	if idx >= e.trackProfile.bucketCount {
		return e.trackProfile.bucketCount - 1
	}
	return idx
}

func (e *ERSEstimator) applyCalibration(bucket int, phase ersPhase, defaultRate float64) float64 {
	if bucket < 0 || bucket >= len(e.bucketCalibration) {
		return defaultRate
	}
	calibration := e.bucketCalibration[bucket]
	switch phase {
	case ersPhaseDeploy:
		if calibration.deploySamples == 0 {
			return defaultRate
		}
		return -((math.Abs(defaultRate) * 0.55) + (calibration.deployRate * 0.45))
	case ersPhaseHarvest:
		if calibration.harvestSamples == 0 {
			return defaultRate
		}
		return (math.Abs(defaultRate) * 0.55) + (calibration.harvestRate * 0.45)
	default:
		return defaultRate
	}
}

func (e *ERSEstimator) recordCalibration(bucket int, phase ersPhase, deltaEnergy float64, dt float64) {
	if bucket < 0 || bucket >= len(e.bucketCalibration) || dt <= 0 {
		return
	}
	rate := math.Abs(deltaEnergy / dt)
	if rate < 250 || rate > 60_000 {
		return
	}

	calibration := &e.bucketCalibration[bucket]
	switch {
	case phase == ersPhaseDeploy && deltaEnergy < -250:
		updateERSEWMA(&calibration.deployRate, &calibration.deploySamples, rate)
		e.calibrationSamples++
	case phase == ersPhaseHarvest && deltaEnergy > 250:
		updateERSEWMA(&calibration.harvestRate, &calibration.harvestSamples, rate)
		e.calibrationSamples++
	}
}

func updateERSEWMA(rate *float64, samples *int, value float64) {
	if *samples == 0 {
		*rate = value
		*samples = 1
		return
	}
	*rate = (*rate * 0.75) + (value * 0.25)
	*samples++
}

func classifyERSPhase(throttle float64, brake float64, speed float64, speedDelta float64, deployMode int, drsOpen bool, trackDRS bool) ersPhase {
	if brake >= 0.18 || speedDelta <= -12 {
		return ersPhaseHarvest
	}
	if throttle >= 0.92 && speed >= 170 && (deployMode >= 2 || drsOpen || trackDRS) {
		return ersPhaseDeploy
	}
	if throttle >= 0.72 && speed >= 120 {
		return ersPhaseSustain
	}
	return ersPhaseNeutral
}

func estimateERSRate(phase ersPhase, throttle float64, brake float64, speed float64, deployMode int, drsOpen bool, trackDRS bool) float64 {
	switch phase {
	case ersPhaseHarvest:
		return 5_500 + (brake * 13_000) + (clampFloat64(220-speed, 0, 120) * 14)
	case ersPhaseDeploy:
		bonus := float64(deployMode) * 2_500
		if drsOpen {
			bonus += 2_500
		}
		if trackDRS {
			bonus += 1_000
		}
		return -(4_500 + (throttle * 5_500) + bonus)
	case ersPhaseSustain:
		return -(1_800 + (throttle * 2_800) + (float64(deployMode) * 900))
	default:
		if brake >= 0.05 {
			return 1_000 + (brake * 2_000)
		}
		if throttle <= 0.15 {
			return 450
		}
		return -180
	}
}

func buildERSTrackProfile(store *tracks.TrackStore, trackID int8, trackLength float64) ersTrackProfile {
	bucketCount := 1
	if trackLength > 0 {
		bucketCount = int(math.Ceil(trackLength / ersEstimateBucketSizeM))
		if bucketCount < 1 {
			bucketCount = 1
		}
	}
	profile := ersTrackProfile{
		bucketCount: bucketCount,
		drsBuckets:  make([]bool, bucketCount),
	}
	if store == nil || trackLength <= 0 {
		return profile
	}

	track := store.Get(trackID)
	if track == nil || len(track.Points) == 0 {
		return profile
	}

	lastIdx := len(track.Points) - 1
	if lastIdx <= 0 {
		return profile
	}

	for i, point := range track.Points {
		if point.DRS == 0 {
			continue
		}
		dist := (float64(i) / float64(lastIdx)) * trackLength
		bucket := int(dist / ersEstimateBucketSizeM)
		if bucket < 0 {
			bucket = 0
		}
		if bucket >= bucketCount {
			bucket = bucketCount - 1
		}
		profile.drsBuckets[bucket] = true
		if bucket > 0 {
			profile.drsBuckets[bucket-1] = true
		}
		if bucket+1 < bucketCount {
			profile.drsBuckets[bucket+1] = true
		}
	}

	return profile
}

func reanchorERSEnergy(estimate float64, actual float64) float64 {
	actual = clampFloat64(actual, 0, ersEstimateMaxEnergyJ)
	diff := math.Abs(estimate - actual)

	gain := 0.25
	switch {
	case diff >= 1_500_000:
		gain = 0.98
	case diff >= 600_000:
		gain = 0.85
	case diff >= 200_000:
		gain = 0.55
	}
	if actual <= 200_000 && estimate > actual {
		gain = math.Max(gain, 0.98)
	}

	return clampFloat64((estimate*(1-gain))+(actual*gain), 0, ersEstimateMaxEnergyJ)
}

func resolveEstimatorSessionUID(
	session *packets.PacketSessionData,
	participants *packets.PacketParticipantsData,
	lapData *packets.PacketLapData,
	telemetry *packets.PacketCarTelemetryData,
	carStatus *packets.PacketCarStatusData,
) uint64 {
	switch {
	case telemetry != nil:
		return telemetry.Header.SessionUID
	case lapData != nil:
		return lapData.Header.SessionUID
	case carStatus != nil:
		return carStatus.Header.SessionUID
	case participants != nil:
		return participants.Header.SessionUID
	case session != nil:
		return session.Header.SessionUID
	default:
		return 0
	}
}

func resolveEstimatorSessionTime(
	session *packets.PacketSessionData,
	participants *packets.PacketParticipantsData,
	lapData *packets.PacketLapData,
	telemetry *packets.PacketCarTelemetryData,
	carStatus *packets.PacketCarStatusData,
) float64 {
	var sessionTime float64
	if session != nil {
		sessionTime = math.Max(sessionTime, float64(session.Header.SessionTime))
	}
	if participants != nil {
		sessionTime = math.Max(sessionTime, float64(participants.Header.SessionTime))
	}
	if lapData != nil {
		sessionTime = math.Max(sessionTime, float64(lapData.Header.SessionTime))
	}
	if telemetry != nil {
		sessionTime = math.Max(sessionTime, float64(telemetry.Header.SessionTime))
	}
	if carStatus != nil {
		sessionTime = math.Max(sessionTime, float64(carStatus.Header.SessionTime))
	}
	return sessionTime
}

func clampFloat64(v, min, max float64) float64 {
	if v < min {
		return min
	}
	if v > max {
		return max
	}
	return v
}

func maxFloat64(v, min float64) float64 {
	if v < min {
		return min
	}
	return v
}
