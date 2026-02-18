package telemetry

import (
	"math"

	"frc.engineer/internal/dto"
)

const (
	minCorneringSteer  = 0.05  // minimum |steering| to count as cornering
	minCorneringSpeed  = 50.0  // km/h
	understeerMaxSlip  = 2.0   // degrees - low slip despite significant steering
	understeerMinSteer = 0.15  // minimum |steering| for understeer detection
	oversteerMinSlip   = 6.0   // degrees - excessive rear slip
	spinMinSlip        = 30.0  // degrees
	spinMinSpeed       = 30.0  // km/h
	lockupMinBrake     = 0.9
	lockupMinSpeed     = 80.0 // km/h
)

// DynamicsAnalyzer processes motion data at 60Hz to detect
// understeer, oversteer, spins, and lockups per lap.
type DynamicsAnalyzer struct {
	currentLap       uint8
	cornerFrames     int
	understeerFrames int
	oversteerFrames  int
	spinActive       bool
	lockupActive     bool
	spinCount        int
	lockupCount      int
	completedLaps    []dto.DynamicsLapDTO
}

// NewDynamicsAnalyzer creates a new DynamicsAnalyzer.
func NewDynamicsAnalyzer() *DynamicsAnalyzer {
	return &DynamicsAnalyzer{}
}

// ProcessFrame analyzes a single motion frame. Must be called under PitwallManager's mu.
func (da *DynamicsAnalyzer) ProcessFrame(
	velX, velZ, yaw float32,
	speed uint16,
	steer, brake float32,
	lapNum uint8,
) {
	// Detect lap change
	if da.currentLap != 0 && lapNum != da.currentLap {
		da.finalizeLap()
	}
	da.currentLap = lapNum

	speedKmh := float64(speed)

	// Body slip angle: angle between velocity vector and car heading
	slipAngle := math.Atan2(float64(velX), float64(velZ)) - float64(yaw)

	// Normalize to [-π, π]
	for slipAngle > math.Pi {
		slipAngle -= 2 * math.Pi
	}
	for slipAngle < -math.Pi {
		slipAngle += 2 * math.Pi
	}

	slipDeg := math.Abs(slipAngle) * 180.0 / math.Pi
	absSteer := math.Abs(float64(steer))

	// Spin detection (debounced)
	if slipDeg > spinMinSlip && speedKmh > spinMinSpeed {
		if !da.spinActive {
			da.spinActive = true
			da.spinCount++
		}
	} else {
		da.spinActive = false
	}

	// Lockup detection (debounced, approximate without individual wheel speeds)
	if float64(brake) > lockupMinBrake && speedKmh > lockupMinSpeed {
		if !da.lockupActive {
			da.lockupActive = true
			da.lockupCount++
		}
	} else {
		da.lockupActive = false
	}

	// Cornering classification
	if absSteer > minCorneringSteer && speedKmh > minCorneringSpeed {
		da.cornerFrames++

		if slipDeg > oversteerMinSlip {
			da.oversteerFrames++
		} else if slipDeg < understeerMaxSlip && absSteer > understeerMinSteer {
			da.understeerFrames++
		}
	}
}

func (da *DynamicsAnalyzer) finalizeLap() {
	lap := dto.DynamicsLapDTO{
		LapNum:      int(da.currentLap),
		LockupCount: da.lockupCount,
		SpinCount:   da.spinCount,
	}

	if da.cornerFrames > 0 {
		lap.UndersteerPct = float64(da.understeerFrames) / float64(da.cornerFrames) * 100.0
		lap.OversteerPct = float64(da.oversteerFrames) / float64(da.cornerFrames) * 100.0
	}

	da.completedLaps = append(da.completedLaps, lap)

	// Reset for new lap
	da.cornerFrames = 0
	da.understeerFrames = 0
	da.oversteerFrames = 0
	da.spinActive = false
	da.lockupActive = false
	da.spinCount = 0
	da.lockupCount = 0
}

// GetLapDynamics returns completed lap dynamics plus the current in-progress lap.
// Must be called under PitwallManager's mu.
func (da *DynamicsAnalyzer) GetLapDynamics() []dto.DynamicsLapDTO {
	if da.currentLap == 0 && len(da.completedLaps) == 0 {
		return nil
	}

	// Include current in-progress lap
	current := dto.DynamicsLapDTO{
		LapNum:      int(da.currentLap),
		LockupCount: da.lockupCount,
		SpinCount:   da.spinCount,
	}
	if da.cornerFrames > 0 {
		current.UndersteerPct = float64(da.understeerFrames) / float64(da.cornerFrames) * 100.0
		current.OversteerPct = float64(da.oversteerFrames) / float64(da.cornerFrames) * 100.0
	}

	result := make([]dto.DynamicsLapDTO, len(da.completedLaps), len(da.completedLaps)+1)
	copy(result, da.completedLaps)
	return append(result, current)
}
