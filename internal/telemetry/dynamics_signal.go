package telemetry

import "math"

const (
	minCorneringSteer  = 0.05 // minimum |steering| to count as cornering
	minCorneringSpeed  = 50.0 // km/h
	understeerMaxSlip  = 2.0  // degrees - low slip despite significant steering
	understeerMinSteer = 0.15 // minimum |steering| for understeer detection
	oversteerMinSlip   = 6.0  // degrees - excessive rear slip
	spinMinSlip        = 30.0 // degrees
	spinMinSpeed       = 30.0 // km/h
	lockupMinBrake     = 0.9
	lockupMinSpeed     = 80.0 // km/h
)

// DynamicsSignal is the shared per-frame classification used by live and offline analysis.
type DynamicsSignal struct {
	Cornering  bool
	Understeer bool
	Oversteer  bool
	Spin       bool
	Lockup     bool
}

// ClassifyDynamicsFrame applies the same slip-angle heuristic used by the live telemetry analyzer.
func ClassifyDynamicsFrame(
	velX, velZ, yaw float32,
	speed uint16,
	steer, brake float32,
) DynamicsSignal {
	speedKmh := float64(speed)

	slipAngle := math.Atan2(float64(velX), float64(velZ)) - float64(yaw)
	for slipAngle > math.Pi {
		slipAngle -= 2 * math.Pi
	}
	for slipAngle < -math.Pi {
		slipAngle += 2 * math.Pi
	}

	slipDeg := math.Abs(slipAngle) * 180.0 / math.Pi
	absSteer := math.Abs(float64(steer))

	signal := DynamicsSignal{
		Spin:   slipDeg > spinMinSlip && speedKmh > spinMinSpeed,
		Lockup: float64(brake) > lockupMinBrake && speedKmh > lockupMinSpeed,
	}

	if absSteer > minCorneringSteer && speedKmh > minCorneringSpeed {
		signal.Cornering = true
		if slipDeg > oversteerMinSlip {
			signal.Oversteer = true
		} else if slipDeg < understeerMaxSlip && absSteer > understeerMinSteer {
			signal.Understeer = true
		}
	}

	return signal
}
