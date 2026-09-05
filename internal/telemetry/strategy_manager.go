package telemetry

import (
	"sort"
	"strings"
	"sync"

	"frc.engineer/internal/packets"
)

const (
	maxRecentLapsPerDriver = 12
	minRecordedLapTimeMS   = 45_000
	maxRecordedLapTimeMS   = 240_000
	crossoverHistoryDepth  = 3
)

// StintInfo records a completed stint on a single tire compound. TireWearPct is
// the peak average tyre wear (0-100) observed during the stint, snapshotted when
// the stint closes.
type StintInfo struct {
	Compound    string
	StartLap    int
	Laps        int
	TireWearPct int
}

type completedLap struct {
	LapNum   int
	TimeMS   int
	Compound string
}

// DriverStrategy tracks the current and historical tire strategy for one driver
type DriverStrategy struct {
	CurrentCompound     string
	CurrentStintLaps    int
	StintHistory        []StintInfo
	NumPitStops         int
	RecentLaps          []completedLap
	initialized         bool
	lastSeenLapNum      int
	lastProcessedLapNum int
	lastSeenNumPitStops int
	currentStintWear    int // peak average tyre wear (0-100) of the running stint
	// ageAtFit is the tyre's TyresAgeLaps at the moment this compound was fitted.
	// A stint's laps-driven = CurrentStintLaps - ageAtFit, so mounting a *used* set
	// and swapping it off without driving (0 laps) records no ghost stint.
	ageAtFit int
}

// CrossoverPrediction summarizes the latest dry-vs-wet crossover model.
type CrossoverPrediction struct {
	Available          bool
	DryGroup           string
	WetGroup           string
	CurrentDeltaMS     float64
	TrendDeltaMSPerLap float64
	AvgLapTimeMS       float64
	DrySampleCount     int
	WetSampleCount     int
	HistoryDepth       int
	CurrentDryAvgMS    float64
	CurrentWetAvgMS    float64
	Reason             string
}

type crossoverLapBucket struct {
	drySumMS     float64
	dryCount     int
	wetSumMS     float64
	wetCount     int
	interCount   int
	fullWetCount int
}

type crossoverLapSnapshot struct {
	DryAvgMS     float64
	DryCount     int
	WetAvgMS     float64
	WetCount     int
	InterCount   int
	FullWetCount int
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

// Reset clears all per-car history when PitwallManager observes a new session.
func (sm *StrategyManager) Reset() {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	sm.drivers = [packets.MaxCars]DriverStrategy{}
}

// Update processes the latest car status and lap data to detect compound changes.
func (sm *StrategyManager) Update(carStatus *packets.PacketCarStatusData, lapData *packets.PacketLapData) {
	if carStatus == nil || lapData == nil {
		return
	}

	sm.mu.Lock()
	defer sm.mu.Unlock()

	for i := range packets.MaxCars {
		lap := lapData.LapData[i]
		status := carStatus.CarStatusData[i]
		compound := tireCompoundString(status.VisualTyreCompound)
		currentLap := int(lap.CurrentLapNum)
		tireAge := int(status.TyresAgeLaps)
		numPitStops := int(lap.NumPitStops)

		ds := &sm.drivers[i]

		if ds.initialized && currentLap < ds.lastSeenLapNum {
			*ds = DriverStrategy{}
		}

		if currentLap > ds.lastSeenLapNum {
			sm.recordCompletedLap(ds, lap, currentLap, numPitStops != ds.lastSeenNumPitStops, compound)
		}

		ds.lastSeenLapNum = currentLap
		ds.lastSeenNumPitStops = numPitStops

		// Always update tire age even when compound is unknown.
		if compound == "" || compound == "unknown" {
			ds.CurrentStintLaps = tireAge
			continue
		}

		if !ds.initialized {
			ds.CurrentCompound = compound
			ds.CurrentStintLaps = tireAge
			// ageAtFit stays 0 at init: without an observed fit event we attribute the
			// tyre's whole current age to this stint (matches pre-existing behaviour for
			// mid-stream joins / race starts). Only a real compound change captures a
			// used set's carried-over age below.
			ds.ageAtFit = 0
			ds.NumPitStops = numPitStops
			ds.initialized = true
			continue
		}

		// New fitting detected: compound changed, OR same compound with the tyre age
		// dropping (age cannot decrease within a stint, so a drop means a fresh/used
		// set of the SAME compound was mounted — without this leg ageAtFit would stay
		// stale and the NEXT compound change could silently drop a real multi-lap
		// stint via a negative laps-driven). Push the previous stint to history only
		// if it was actually driven >= 1 lap on this fitting. laps-driven =
		// CurrentStintLaps - ageAtFit excludes the carried-over age of a used set
		// (mounting then swapping off a used set without a lap records nothing; a
		// fresh set has ageAtFit 0).
		if compound != ds.CurrentCompound || tireAge < ds.CurrentStintLaps {
			lapsThisFitting := ds.CurrentStintLaps - ds.ageAtFit
			if lapsThisFitting >= 1 {
				startLap := currentLap - lapsThisFitting
				if startLap < 1 {
					startLap = 1
				}
				ds.StintHistory = append(ds.StintHistory, StintInfo{
					Compound:    ds.CurrentCompound,
					StartLap:    startLap,
					Laps:        lapsThisFitting,
					TireWearPct: ds.currentStintWear,
				})
			}
			ds.CurrentCompound = compound
			ds.ageAtFit = tireAge
			// Reset the peak-wear accumulator for the new stint. The fresh tyre's
			// low wear rebuilds the peak from here (UpdateTyreWear uses max, so an
			// early ~0% frame that arrives before this reset can't corrupt the
			// stint just closed).
			ds.currentStintWear = 0
		}

		ds.NumPitStops = numPitStops
		ds.CurrentStintLaps = tireAge
	}
}

// UpdateTyreWear feeds the latest per-car tyre wear into each running stint's peak
// accumulator. Called on every CarDamage packet. Uses the max (peak) of the
// 4-corner average so a fresh-tyre ~0% frame landing between the pit stop and the
// compound-change detection cannot lower the wear recorded for the stint that just
// closed.
func (sm *StrategyManager) UpdateTyreWear(cd *packets.PacketCarDamageData) {
	if cd == nil {
		return
	}
	sm.mu.Lock()
	defer sm.mu.Unlock()
	for i := range packets.MaxCars {
		w := cd.CarDamageData[i].TyresWear
		avg := int((float64(w[0])+float64(w[1])+float64(w[2])+float64(w[3]))/4 + 0.5)
		if avg < 0 {
			avg = 0
		} else if avg > 100 {
			avg = 100
		}
		if ds := &sm.drivers[i]; avg > ds.currentStintWear {
			ds.currentStintWear = avg
		}
	}
}

func (sm *StrategyManager) recordCompletedLap(
	ds *DriverStrategy,
	lap packets.LapData,
	currentLap int,
	pitStopChanged bool,
	compound string,
) {
	completedLapNum := currentLap - 1
	if completedLapNum <= ds.lastProcessedLapNum {
		return
	}
	ds.lastProcessedLapNum = completedLapNum

	if completedLapNum < 1 {
		return
	}

	lapTimeMS := int(lap.LastLapTimeInMS)
	if lapTimeMS < minRecordedLapTimeMS || lapTimeMS > maxRecordedLapTimeMS {
		return
	}
	if pitStopChanged || lap.PitStatus != 0 {
		return
	}
	if lap.ResultStatus != 2 && lap.ResultStatus != 3 {
		return
	}
	if compound == "" || compound == "unknown" {
		return
	}

	ds.RecentLaps = append(ds.RecentLaps, completedLap{
		LapNum:   completedLapNum,
		TimeMS:   lapTimeMS,
		Compound: compound,
	})
	if len(ds.RecentLaps) > maxRecentLapsPerDriver {
		ds.RecentLaps = append([]completedLap(nil), ds.RecentLaps[len(ds.RecentLaps)-maxRecentLapsPerDriver:]...)
	}
}

// GetDriverStrategy returns a copy of the strategy data for a given driver index.
func (sm *StrategyManager) GetDriverStrategy(idx int) DriverStrategy {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	if idx < 0 || idx >= packets.MaxCars {
		return DriverStrategy{}
	}
	return cloneDriverStrategy(sm.drivers[idx])
}

// GetCrossoverPrediction returns the latest dry-vs-wet crossover model.
func (sm *StrategyManager) GetCrossoverPrediction() CrossoverPrediction {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	buckets := make(map[int]*crossoverLapBucket)
	hasDry := false
	hasWet := false

	for i := range sm.drivers {
		driver := sm.drivers[i]
		for _, lap := range driver.RecentLaps {
			group := compoundTrackGroup(lap.Compound)
			if group == "" {
				continue
			}

			bucket := buckets[lap.LapNum]
			if bucket == nil {
				bucket = &crossoverLapBucket{}
				buckets[lap.LapNum] = bucket
			}

			switch group {
			case "dry":
				bucket.drySumMS += float64(lap.TimeMS)
				bucket.dryCount++
				hasDry = true
			case "wet":
				bucket.wetSumMS += float64(lap.TimeMS)
				bucket.wetCount++
				if lap.Compound == "wet" {
					bucket.fullWetCount++
				} else {
					bucket.interCount++
				}
				hasWet = true
			}
		}
	}

	if !hasDry || !hasWet {
		return CrossoverPrediction{
			Reason: "Need both slick and inter/wet runners on track.",
		}
	}

	lapNums := make([]int, 0, len(buckets))
	for lapNum := range buckets {
		lapNums = append(lapNums, lapNum)
	}
	sort.Sort(sort.Reverse(sort.IntSlice(lapNums)))

	history := make([]crossoverLapSnapshot, 0, crossoverHistoryDepth)
	for _, lapNum := range lapNums {
		bucket := buckets[lapNum]
		if bucket == nil || bucket.dryCount == 0 || bucket.wetCount == 0 {
			continue
		}

		history = append(history, crossoverLapSnapshot{
			DryAvgMS:     bucket.drySumMS / float64(bucket.dryCount),
			DryCount:     bucket.dryCount,
			WetAvgMS:     bucket.wetSumMS / float64(bucket.wetCount),
			WetCount:     bucket.wetCount,
			InterCount:   bucket.interCount,
			FullWetCount: bucket.fullWetCount,
		})
		if len(history) == crossoverHistoryDepth {
			break
		}
	}

	if len(history) < 2 {
		return CrossoverPrediction{
			DryGroup: "slick",
			WetGroup: "inter",
			Reason:   "Waiting for two matched dry-vs-wet laps.",
		}
	}

	current := history[0]
	currentDelta := current.DryAvgMS - current.WetAvgMS
	trendDelta := 0.0
	for i := 0; i < len(history)-1; i++ {
		currentGap := history[i].DryAvgMS - history[i].WetAvgMS
		previousGap := history[i+1].DryAvgMS - history[i+1].WetAvgMS
		trendDelta += currentGap - previousGap
	}
	trendDelta /= float64(len(history) - 1)

	totalSamples := current.DryCount + current.WetCount
	avgLapTimeMS := 0.0
	if totalSamples > 0 {
		avgLapTimeMS = ((current.DryAvgMS * float64(current.DryCount)) + (current.WetAvgMS * float64(current.WetCount))) / float64(totalSamples)
	}

	wetLabel := "inter"
	if current.FullWetCount > current.InterCount {
		wetLabel = "wet"
	}

	return CrossoverPrediction{
		Available:          true,
		DryGroup:           "slick",
		WetGroup:           wetLabel,
		CurrentDeltaMS:     currentDelta,
		TrendDeltaMSPerLap: trendDelta,
		AvgLapTimeMS:       avgLapTimeMS,
		DrySampleCount:     current.DryCount,
		WetSampleCount:     current.WetCount,
		HistoryDepth:       len(history),
		CurrentDryAvgMS:    current.DryAvgMS,
		CurrentWetAvgMS:    current.WetAvgMS,
	}
}

func cloneDriverStrategy(src DriverStrategy) DriverStrategy {
	dst := src
	if len(src.StintHistory) > 0 {
		dst.StintHistory = append([]StintInfo(nil), src.StintHistory...)
	}
	if len(src.RecentLaps) > 0 {
		dst.RecentLaps = append([]completedLap(nil), src.RecentLaps...)
	}
	return dst
}

func compoundTrackGroup(compound string) string {
	switch strings.ToLower(compound) {
	case "soft", "medium", "hard":
		return "dry"
	case "inter", "wet":
		return "wet"
	default:
		return ""
	}
}
