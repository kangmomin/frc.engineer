package telemetry

import (
	"math"

	"frc.engineer/internal/dto"
)

const (
	// Aero: straight detection thresholds
	aeroMinSpeed = 200.0 // km/h
	aeroMaxSteer = 0.05  // |steer| below this = straight

	// Transmission: corner exit wheelspin detection
	transMinThrottle = 0.5
	transMinSteer    = 0.1
	transSlipThresh  = 0.15 // WheelSlipRatio threshold for wheelspin

	// Suspension: bottoming detection
	suspBottomHeight = 0.005 // metres - aero height below this = bottoming
	suspVertGSpike   = 3.0   // |gForceVertical| spike threshold

	// Brakes: lockup detection
	brakeMinBrake     = 0.8
	brakeSlipThresh   = 0.15 // WheelSlipRatio threshold for lockup
)

// SetupAnalyzer processes telemetry + motion ex data per frame to produce
// setup-relevant metrics per lap. Must be called under PitwallManager's mu.
type SetupAnalyzer struct {
	currentLap uint8

	// Aero counters
	straightFrames    int
	straightSpeedSum  float64
	maxStraightSpeed  float64
	corneringGSum     float64
	corneringGFrames  int

	// Transmission counters
	cornerExitFrames   int
	wheelspinFrames    int

	// Suspension Geometry: temp balance accumulation
	tempBalanceSum    [4]float64 // inner - surface per wheel
	tempBalanceFrames int

	// Suspension counters
	totalFrames      int
	bottomingFrames  int
	vertGSpikeCount  int

	// Brakes counters
	heavyBrakeFrames    int
	frontLockupFrames   int
	rearLockupFrames    int

	// Tyres accumulation
	tyrePressureSum  [4]float64
	tyreInnerTempSum [4]float64
	tyreFrames       int

	completedLaps []dto.SetupLapAnalysisDTO
}

// NewSetupAnalyzer creates a new SetupAnalyzer.
func NewSetupAnalyzer() *SetupAnalyzer {
	return &SetupAnalyzer{}
}

// SetupFrameInput bundles all per-frame data needed by the setup analyzer.
type SetupFrameInput struct {
	Speed          uint16
	Steer          float32
	Throttle       float32
	Brake          float32
	GForceLateral  float32
	GForceVertical float32
	LapNum         uint8

	// From MotionEx
	WheelSlipRatio  [4]float32
	FrontAeroHeight float32
	RearAeroHeight  float32

	// From telemetry packet
	TireSurfaceTemp [4]uint8
	TireInnerTemp   [4]uint8
	TyrePressure    [4]float32
}

// ProcessFrame analyzes a single frame. Must be called under PitwallManager's mu.
func (sa *SetupAnalyzer) ProcessFrame(in SetupFrameInput) {
	if sa.currentLap != 0 && in.LapNum != sa.currentLap {
		sa.finalizeLap()
	}
	sa.currentLap = in.LapNum
	sa.totalFrames++

	speedKmh := float64(in.Speed)
	absSteer := math.Abs(float64(in.Steer))

	// === Aero: straight-line detection ===
	if speedKmh > aeroMinSpeed && absSteer < aeroMaxSteer {
		sa.straightFrames++
		sa.straightSpeedSum += speedKmh
		if speedKmh > sa.maxStraightSpeed {
			sa.maxStraightSpeed = speedKmh
		}
	}

	// Cornering G accumulation (any time we're turning)
	if absSteer > aeroMaxSteer && speedKmh > 50 {
		sa.corneringGFrames++
		sa.corneringGSum += math.Abs(float64(in.GForceLateral))
	}

	// === Transmission: corner exit wheelspin ===
	if float64(in.Throttle) > transMinThrottle && absSteer > transMinSteer {
		sa.cornerExitFrames++
		// Check rear wheels (indices 0=RL, 1=RR in game order)
		rearSlip := math.Max(math.Abs(float64(in.WheelSlipRatio[0])), math.Abs(float64(in.WheelSlipRatio[1])))
		if rearSlip > transSlipThresh {
			sa.wheelspinFrames++
		}
	}

	// === Suspension Geometry: inner-surface temp diff ===
	sa.tempBalanceFrames++
	for w := range 4 {
		diff := float64(in.TireInnerTemp[w]) - float64(in.TireSurfaceTemp[w])
		sa.tempBalanceSum[w] += diff
	}

	// === Suspension: bottoming & vert G spikes ===
	if in.FrontAeroHeight < suspBottomHeight || in.RearAeroHeight < suspBottomHeight {
		sa.bottomingFrames++
	}
	if math.Abs(float64(in.GForceVertical)) > suspVertGSpike {
		sa.vertGSpikeCount++
	}

	// === Brakes: lockup detection ===
	if float64(in.Brake) > brakeMinBrake {
		sa.heavyBrakeFrames++
		frontSlip := math.Max(math.Abs(float64(in.WheelSlipRatio[2])), math.Abs(float64(in.WheelSlipRatio[3])))
		rearSlip := math.Max(math.Abs(float64(in.WheelSlipRatio[0])), math.Abs(float64(in.WheelSlipRatio[1])))
		if frontSlip > brakeSlipThresh {
			sa.frontLockupFrames++
		}
		if rearSlip > brakeSlipThresh {
			sa.rearLockupFrames++
		}
	}

	// === Tyres: pressure & inner temp accumulation ===
	sa.tyreFrames++
	for w := range 4 {
		sa.tyrePressureSum[w] += float64(in.TyrePressure[w])
		sa.tyreInnerTempSum[w] += float64(in.TireInnerTemp[w])
	}
}

func (sa *SetupAnalyzer) finalizeLap() {
	lap := sa.buildCurrentLap()
	sa.completedLaps = append(sa.completedLaps, lap)
	sa.resetCounters()
}

func (sa *SetupAnalyzer) buildCurrentLap() dto.SetupLapAnalysisDTO {
	lap := dto.SetupLapAnalysisDTO{
		LapNum:          int(sa.currentLap),
		MaxStraightSpeed: sa.maxStraightSpeed,
		VertGSpikeCount: sa.vertGSpikeCount,
	}

	if sa.straightFrames > 0 {
		lap.AvgStraightSpeed = sa.straightSpeedSum / float64(sa.straightFrames)
	}
	if sa.corneringGFrames > 0 {
		lap.AvgCorneringG = sa.corneringGSum / float64(sa.corneringGFrames)
	}
	if sa.cornerExitFrames > 0 {
		lap.WheelspinPct = float64(sa.wheelspinFrames) / float64(sa.cornerExitFrames) * 100.0
	}
	if sa.tempBalanceFrames > 0 {
		for w := range 4 {
			lap.TempBalance[w] = sa.tempBalanceSum[w] / float64(sa.tempBalanceFrames)
		}
	}
	if sa.totalFrames > 0 {
		lap.BottomingPct = float64(sa.bottomingFrames) / float64(sa.totalFrames) * 100.0
	}
	if sa.heavyBrakeFrames > 0 {
		lap.FrontLockupPct = float64(sa.frontLockupFrames) / float64(sa.heavyBrakeFrames) * 100.0
		lap.RearLockupPct = float64(sa.rearLockupFrames) / float64(sa.heavyBrakeFrames) * 100.0
	}
	if sa.tyreFrames > 0 {
		for w := range 4 {
			lap.AvgTyrePressure[w] = sa.tyrePressureSum[w] / float64(sa.tyreFrames)
			lap.AvgTyreInnerTemp[w] = sa.tyreInnerTempSum[w] / float64(sa.tyreFrames)
		}
	}

	return lap
}

func (sa *SetupAnalyzer) resetCounters() {
	sa.straightFrames = 0
	sa.straightSpeedSum = 0
	sa.maxStraightSpeed = 0
	sa.corneringGSum = 0
	sa.corneringGFrames = 0
	sa.cornerExitFrames = 0
	sa.wheelspinFrames = 0
	sa.tempBalanceSum = [4]float64{}
	sa.tempBalanceFrames = 0
	sa.totalFrames = 0
	sa.bottomingFrames = 0
	sa.vertGSpikeCount = 0
	sa.heavyBrakeFrames = 0
	sa.frontLockupFrames = 0
	sa.rearLockupFrames = 0
	sa.tyrePressureSum = [4]float64{}
	sa.tyreInnerTempSum = [4]float64{}
	sa.tyreFrames = 0
}

// GetSetupAnalysis returns completed laps plus the current in-progress lap.
// Must be called under PitwallManager's mu.
func (sa *SetupAnalyzer) GetSetupAnalysis() []dto.SetupLapAnalysisDTO {
	if sa.currentLap == 0 && len(sa.completedLaps) == 0 {
		return nil
	}

	current := sa.buildCurrentLap()
	result := make([]dto.SetupLapAnalysisDTO, len(sa.completedLaps), len(sa.completedLaps)+1)
	copy(result, sa.completedLaps)
	return append(result, current)
}
