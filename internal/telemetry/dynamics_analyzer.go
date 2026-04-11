package telemetry

import "frc.engineer/internal/dto"

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

	signal := ClassifyDynamicsFrame(velX, velZ, yaw, speed, steer, brake)

	// Spin detection (debounced)
	if signal.Spin {
		if !da.spinActive {
			da.spinActive = true
			da.spinCount++
		}
	} else {
		da.spinActive = false
	}

	// Lockup detection (debounced, approximate without individual wheel speeds)
	if signal.Lockup {
		if !da.lockupActive {
			da.lockupActive = true
			da.lockupCount++
		}
	} else {
		da.lockupActive = false
	}

	// Cornering classification
	if signal.Cornering {
		da.cornerFrames++

		if signal.Oversteer {
			da.oversteerFrames++
		} else if signal.Understeer {
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
