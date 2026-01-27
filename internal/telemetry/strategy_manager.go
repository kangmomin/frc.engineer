package telemetry

import (
	"sync"

	"frc.engineer/internal/packets"
)

// StintInfo records a completed stint on a single tire compound
type StintInfo struct {
	Compound string
	StartLap int
	Laps     int
}

// DriverStrategy tracks the current and historical tire strategy for one driver
type DriverStrategy struct {
	CurrentCompound  string
	CurrentStintLaps int
	StintHistory     []StintInfo
	NumPitStops      int
	initialized      bool
}

// StrategyManager monitors tire compound changes across all cars to build stint histories
type StrategyManager struct {
	mu      sync.RWMutex
	drivers [packets.MaxCars]DriverStrategy
}

// NewStrategyManager creates a new StrategyManager
func NewStrategyManager() *StrategyManager {
	return &StrategyManager{}
}

// Update processes the latest car status and lap data to detect compound changes
func (sm *StrategyManager) Update(carStatus *packets.PacketCarStatusData, lapData *packets.PacketLapData) {
	if carStatus == nil || lapData == nil {
		return
	}

	sm.mu.Lock()
	defer sm.mu.Unlock()

	for i := range packets.MaxCars {
		compound := tireCompoundString(carStatus.CarStatusData[i].VisualTyreCompound)
		currentLap := int(lapData.LapData[i].CurrentLapNum)
		tireAge := int(carStatus.CarStatusData[i].TyresAgeLaps)

		ds := &sm.drivers[i]

		// Detect session restart: lap counter decreased → reset driver state
		if ds.initialized && currentLap < ds.CurrentStintLaps {
			*ds = DriverStrategy{}
		}

		// Always update tire age even when compound is unknown
		if compound == "" || compound == "unknown" {
			ds.CurrentStintLaps = tireAge
			continue
		}

		if !ds.initialized {
			ds.CurrentCompound = compound
			ds.CurrentStintLaps = tireAge
			ds.initialized = true
			continue
		}

		// Compound changed → push previous stint to history
		if compound != ds.CurrentCompound {
			startLap := currentLap - ds.CurrentStintLaps
			if startLap < 1 {
				startLap = 1
			}
			ds.StintHistory = append(ds.StintHistory, StintInfo{
				Compound: ds.CurrentCompound,
				StartLap: startLap,
				Laps:     ds.CurrentStintLaps,
			})
			ds.CurrentCompound = compound
			ds.NumPitStops++
		}

		ds.CurrentStintLaps = tireAge
	}
}

// GetDriverStrategy returns a copy of the strategy data for a given driver index
func (sm *StrategyManager) GetDriverStrategy(idx int) DriverStrategy {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	if idx < 0 || idx >= packets.MaxCars {
		return DriverStrategy{}
	}
	ds := sm.drivers[idx]
	// Copy slice to avoid data races
	history := make([]StintInfo, len(ds.StintHistory))
	copy(history, ds.StintHistory)
	ds.StintHistory = history
	return ds
}
