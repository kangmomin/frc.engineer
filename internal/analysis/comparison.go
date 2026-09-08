package analysis

import (
	"errors"
	"math"
	"sort"

	"frc.engineer/internal/telemetry"
)

const (
	comparisonBinSize = 50.0
	maxComparisonBins = 200
)

// ComparisonAnalysis contains lap-by-lap traces used by the driver pack analysis UI.
type ComparisonAnalysis struct {
	Distances     []float64       `json:"distances"`
	DistanceBinM  float64         `json:"distanceBinM"`
	BestLapNum    int             `json:"bestLapNum"`
	BestLapTimeMs uint32          `json:"bestLapTimeMs"`
	Laps          []ComparisonLap `json:"laps"`
}

// ComparisonLap contains one completed lap plus its distance-bucket traces.
type ComparisonLap struct {
	LapNum        int      `json:"lapNum"`
	Valid         bool     `json:"valid"`
	LapTimeMs     uint32   `json:"lapTimeMs"`
	Sector1Ms     uint32   `json:"sector1Ms"`
	Sector2Ms     uint32   `json:"sector2Ms"`
	Sector3Ms     uint32   `json:"sector3Ms"`
	Compound      string   `json:"compound,omitempty"`
	TireAge       int      `json:"tireAge,omitempty"`
	UndersteerPct float64  `json:"understeerPct"`
	OversteerPct  float64  `json:"oversteerPct"`
	LockupCount   int      `json:"lockupCount"`
	SpinCount     int      `json:"spinCount"`
	Trace         LapTrace `json:"trace"`
}

// LapTrace contains the downsampled series displayed as overlays.
type LapTrace struct {
	Speed      []*float64 `json:"speed"`
	Throttle   []*float64 `json:"throttle"`
	Brake      []*float64 `json:"brake"`
	Understeer []*float64 `json:"understeer"`
	Oversteer  []*float64 `json:"oversteer"`
}

type comparisonFrame struct {
	frame   uint32
	lapNum  int
	lapDist float64
}

type comparisonTelemetry struct {
	speed    uint16
	throttle float32
	steer    float32
	brake    float32
}

type comparisonMotion struct {
	velX float32
	velZ float32
	yaw  float32
}

type comparisonBin struct {
	speedSum      float64
	speedCount    int
	throttleSum   float64
	throttleCount int
	brakeSum      float64
	brakeCount    int
	cornerCount   int
	underCount    int
	overCount     int
}

type lapComparisonAggregate struct {
	bins         []comparisonBin
	cornerCount  int
	underCount   int
	overCount    int
	lockupActive bool
	lockupCount  int
	spinActive   bool
	spinCount    int
}

func buildComparisonAnalysis(dir string, laps []LapSummary) (*ComparisonAnalysis, *SpeedAnalysis, error) {
	if len(laps) == 0 {
		return nil, nil, nil
	}

	sessionMeta, _ := readSessionMetadata(dir)
	completed := make(map[int]LapSummary, len(laps))
	bestLapNum, bestLapTime := fastestLap(laps)
	for _, lap := range laps {
		completed[lap.LapNum] = lap
	}

	frames, maxDist, telemetryFrames, motionFrames, err := readSafeComparisonInputs(dir, completed)
	if err != nil {
		return nil, nil, err
	}
	if len(frames) == 0 {
		return nil, nil, errors.New("comparison frames unavailable")
	}

	if sessionMeta != nil && sessionMeta.TrackLengthM > 0 && float64(sessionMeta.TrackLengthM) > maxDist {
		maxDist = float64(sessionMeta.TrackLengthM)
	}

	numBins := int(math.Ceil(maxDist/comparisonBinSize)) + 1
	if numBins < 1 {
		numBins = 1
	}
	if numBins > maxComparisonBins {
		numBins = maxComparisonBins
	}

	distances := make([]float64, numBins)
	for i := range distances {
		distances[i] = float64(i)*comparisonBinSize + comparisonBinSize/2
	}

	aggregates := make(map[int]*lapComparisonAggregate, len(laps))
	globalSpeed := make([]comparisonBin, numBins)
	sort.Slice(frames, func(i, j int) bool { return frames[i].frame < frames[j].frame })

	for _, frame := range frames {
		bin := int(frame.lapDist / comparisonBinSize)
		if bin < 0 || bin >= numBins {
			continue
		}

		agg := aggregates[frame.lapNum]
		if agg == nil {
			agg = &lapComparisonAggregate{bins: make([]comparisonBin, numBins)}
			aggregates[frame.lapNum] = agg
		}

		tel, hasTelemetry := lookupExactFrame(frame.frame, telemetryFrames)
		if hasTelemetry {
			agg.bins[bin].speedSum += float64(tel.speed)
			agg.bins[bin].speedCount++
			agg.bins[bin].throttleSum += float64(tel.throttle)
			agg.bins[bin].throttleCount++
			agg.bins[bin].brakeSum += float64(tel.brake)
			agg.bins[bin].brakeCount++

			globalSpeed[bin].speedSum += float64(tel.speed)
			globalSpeed[bin].speedCount++
		}

		motion, hasMotion := lookupExactFrame(frame.frame, motionFrames)
		if hasTelemetry && hasMotion {
			signal := telemetry.ClassifyDynamicsFrame(
				motion.velX,
				motion.velZ,
				motion.yaw,
				tel.speed,
				tel.steer,
				tel.brake,
			)
			if signal.Cornering {
				agg.cornerCount++
				agg.bins[bin].cornerCount++
				if signal.Understeer {
					agg.underCount++
					agg.bins[bin].underCount++
				}
				if signal.Oversteer {
					agg.overCount++
					agg.bins[bin].overCount++
				}
			}

			if signal.Lockup {
				if !agg.lockupActive {
					agg.lockupActive = true
					agg.lockupCount++
				}
			} else {
				agg.lockupActive = false
			}

			if signal.Spin {
				if !agg.spinActive {
					agg.spinActive = true
					agg.spinCount++
				}
			} else {
				agg.spinActive = false
			}
		}
	}

	comparison := &ComparisonAnalysis{
		Distances:     distances,
		DistanceBinM:  comparisonBinSize,
		BestLapNum:    bestLapNum,
		BestLapTimeMs: bestLapTime,
		Laps:          make([]ComparisonLap, 0, len(laps)),
	}

	for _, lap := range laps {
		entry := ComparisonLap{
			LapNum:    lap.LapNum,
			Valid:     lap.Valid,
			LapTimeMs: lap.LapTimeMs,
			Sector1Ms: lap.Sector1Ms,
			Sector2Ms: lap.Sector2Ms,
			Sector3Ms: lap.Sector3Ms,
			Compound:  lap.Compound,
			TireAge:   lap.TireAge,
			Trace:     emptyLapTrace(numBins),
		}

		if agg := aggregates[lap.LapNum]; agg != nil {
			if agg.cornerCount > 0 {
				entry.UndersteerPct = float64(agg.underCount) / float64(agg.cornerCount) * 100.0
				entry.OversteerPct = float64(agg.overCount) / float64(agg.cornerCount) * 100.0
			}
			entry.LockupCount = agg.lockupCount
			entry.SpinCount = agg.spinCount
			entry.Trace = finalizeLapTrace(agg.bins, numBins)
		}

		comparison.Laps = append(comparison.Laps, entry)
	}

	speed := buildSpeedFromComparison(distances, globalSpeed, aggregates[bestLapNum])
	if motionFrames == nil {
		return nil, speed, nil
	}
	return comparison, speed, nil
}

func buildSpeedFromComparison(
	distances []float64,
	globalBins []comparisonBin,
	bestLap *lapComparisonAggregate,
) *SpeedAnalysis {
	if len(distances) == 0 {
		return nil
	}

	bestSpeed := make([]float64, len(distances))
	avgSpeed := make([]float64, len(distances))
	for i := range distances {
		if globalBins[i].speedCount > 0 {
			avgSpeed[i] = globalBins[i].speedSum / float64(globalBins[i].speedCount)
		}
		if bestLap != nil && bestLap.bins[i].speedCount > 0 {
			bestSpeed[i] = bestLap.bins[i].speedSum / float64(bestLap.bins[i].speedCount)
		}
	}

	return &SpeedAnalysis{
		Distances: distances,
		BestSpeed: bestSpeed,
		AvgSpeed:  avgSpeed,
		SlowZones: buildSlowZones(distances, bestSpeed, avgSpeed),
	}
}

func buildSlowZones(distances, bestSpeed, avgSpeed []float64) []SlowZone {
	overallAvg := 0.0
	count := 0
	for _, value := range avgSpeed {
		if value > 0 {
			overallAvg += value
			count++
		}
	}
	if count == 0 {
		return nil
	}
	overallAvg /= float64(count)
	threshold := overallAvg * 0.7

	var slowZones []SlowZone
	var zone *SlowZone
	for i, value := range avgSpeed {
		if value > 0 && value < threshold {
			if zone == nil {
				zone = &SlowZone{DistanceStart: distances[i] - comparisonBinSize/2}
			}
			zone.AvgSpeed += value
			if bestSpeed[i] > zone.BestSpeed {
				zone.BestSpeed = bestSpeed[i]
			}
			continue
		}
		if zone == nil {
			continue
		}
		zone.DistanceEnd = distances[i-1] + comparisonBinSize/2
		bins := int((zone.DistanceEnd - zone.DistanceStart) / comparisonBinSize)
		if bins > 0 {
			zone.AvgSpeed /= float64(bins)
		}
		slowZones = append(slowZones, *zone)
		zone = nil
	}
	if zone != nil {
		zone.DistanceEnd = distances[len(distances)-1] + comparisonBinSize/2
		bins := int((zone.DistanceEnd - zone.DistanceStart) / comparisonBinSize)
		if bins > 0 {
			zone.AvgSpeed /= float64(bins)
		}
		slowZones = append(slowZones, *zone)
	}
	return slowZones
}

func fastestLap(laps []LapSummary) (int, uint32) {
	bestLapNum := 0
	bestLapTime := uint32(math.MaxUint32)
	for _, lap := range laps {
		if !lap.Valid || lap.LapTimeMs == 0 {
			continue
		}
		if lap.LapTimeMs < bestLapTime {
			bestLapTime = lap.LapTimeMs
			bestLapNum = lap.LapNum
		}
	}
	if bestLapNum != 0 {
		return bestLapNum, bestLapTime
	}
	if bestLapTime == uint32(math.MaxUint32) {
		bestLapTime = 0
	}
	return bestLapNum, bestLapTime
}

func emptyLapTrace(numBins int) LapTrace {
	return LapTrace{
		Speed:      make([]*float64, numBins),
		Throttle:   make([]*float64, numBins),
		Brake:      make([]*float64, numBins),
		Understeer: make([]*float64, numBins),
		Oversteer:  make([]*float64, numBins),
	}
}

func finalizeLapTrace(bins []comparisonBin, numBins int) LapTrace {
	trace := emptyLapTrace(numBins)
	for i := 0; i < numBins; i++ {
		if bins[i].speedCount > 0 {
			trace.Speed[i] = float64Ptr(bins[i].speedSum / float64(bins[i].speedCount))
		}
		if bins[i].throttleCount > 0 {
			trace.Throttle[i] = float64Ptr(bins[i].throttleSum / float64(bins[i].throttleCount))
		}
		if bins[i].brakeCount > 0 {
			trace.Brake[i] = float64Ptr(bins[i].brakeSum / float64(bins[i].brakeCount))
		}
		if bins[i].cornerCount > 0 {
			trace.Understeer[i] = float64Ptr(float64(bins[i].underCount) / float64(bins[i].cornerCount) * 100.0)
			trace.Oversteer[i] = float64Ptr(float64(bins[i].overCount) / float64(bins[i].cornerCount) * 100.0)
		}
	}
	return trace
}

func float64Ptr(value float64) *float64 {
	v := value
	return &v
}

func lookupExactFrame[T any](frame uint32, values map[uint32]T) (T, bool) {
	v, ok := values[frame]
	return v, ok
}
