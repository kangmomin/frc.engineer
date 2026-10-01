package telemetry

import "frc.engineer/internal/packets"

// PlayerInputs is the player's latest driving input snapshot. It is a local,
// in-process view (never broadcast) so that local consumers such as the
// virtual engineer can avoid talking while the driver is braking or turning.
type PlayerInputs struct {
	Valid       bool
	SpeedKPH    int
	Throttle    float32
	Brake       float32
	Steer       float32
	Gear        int8
	Sector      int
	LapDistance float32
	PitStatus   int
	PitLimiter  bool
}

// PlayerInputs returns the player's latest pedal/steering inputs. Valid is
// false until a telemetry packet with an in-range player index has arrived.
func (pm *PitwallManager) PlayerInputs() PlayerInputs {
	pm.mu.RLock()
	defer pm.mu.RUnlock()
	idx := int(pm.playerIndex)
	if pm.telemetry == nil || idx >= packets.MaxCars {
		return PlayerInputs{}
	}
	t := pm.telemetry.CarTelemetryData[idx]
	in := PlayerInputs{
		Valid:    true,
		SpeedKPH: int(t.Speed),
		Throttle: t.Throttle,
		Brake:    t.Brake,
		Steer:    t.Steer,
		Gear:     t.Gear,
	}
	if pm.lapData != nil {
		ld := pm.lapData.LapData[idx]
		in.Sector = int(ld.Sector)
		in.LapDistance = ld.LapDistance
		in.PitStatus = int(ld.PitStatus)
	}
	if pm.carStatus != nil {
		in.PitLimiter = pm.carStatus.CarStatusData[idx].PitLimiterStatus != 0
	}
	return in
}
