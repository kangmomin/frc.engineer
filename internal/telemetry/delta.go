package telemetry

import (
	"maps"
	"math"
	"sort"
	"sync"

	"frc.engineer/internal/packets"
)

func sanitizeF32(v float32) float32 {
	if math.IsNaN(float64(v)) || math.IsInf(float64(v), 0) {
		return 0
	}
	return v
}

// SaveCallback is called when a new best lap is recorded
type SaveCallback func(trackID int8, lap *LapTelemetry) error

// LoadCallback is called to load a best lap from storage
type LoadCallback func(trackID int8) (*LapTelemetry, error)

// DeltaCalculator calculates delta times relative to personal best
type DeltaCalculator struct {
	mu sync.RWMutex

	// Legacy: bucket-based lap times (kept for backward compatibility)
	bestLapTimes    map[int]uint32 // distance bucket -> lap time at that point
	bestLapTimeMS   uint32         // Overall best lap time
	currentLapTimes map[int]uint32 // Current lap times by distance bucket

	// New: full telemetry storage for precise delta calculation
	bestLapData    *LapTelemetry    // Complete best lap telemetry
	currentLapData []TelemetryPoint // Current lap telemetry points

	// Track state
	lastLapNum       uint8
	lastDistance     float32
	sessionUID       uint64
	playerIndex      int
	trackID          int8
	generation       uint64
	lapInvalid       bool
	lapStartObserved bool
	sector1MS        uint32
	sector2MS        uint32

	// Minimum distance interval between samples (in metres)
	minSampleInterval float32

	// Storage callbacks
	onSave SaveCallback
	onLoad LoadCallback
}

const (
	// distanceBucketSize is the distance interval for sampling lap times (10 meters)
	distanceBucketSize = 10.0
	// defaultMinSampleInterval is the default minimum distance between telemetry samples
	defaultMinSampleInterval = 5.0
)

// NewDeltaCalculator creates a new delta calculator
func NewDeltaCalculator() *DeltaCalculator {
	return &DeltaCalculator{
		trackID:           -1,
		playerIndex:       -1,
		bestLapTimes:      make(map[int]uint32),
		currentLapTimes:   make(map[int]uint32),
		currentLapData:    make([]TelemetryPoint, 0, 1000),
		minSampleInterval: defaultMinSampleInterval,
	}
}

// SetStorageCallbacks sets the save and load callbacks for persisting best lap data
func (d *DeltaCalculator) SetStorageCallbacks(onSave SaveCallback, onLoad LoadCallback) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.onSave = onSave
	d.onLoad = onLoad
}

// LoadBestLapFromStorage runs disk I/O outside the calculator lock and only
// applies a result to the same session/track generation that requested it.
func (d *DeltaCalculator) LoadBestLapFromStorage() error {
	d.mu.RLock()
	load, trackID, generation := d.onLoad, d.trackID, d.generation
	d.mu.RUnlock()
	if load == nil || trackID < 0 {
		return nil
	}
	lap, err := load(trackID)
	if err != nil {
		return err
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	if generation != d.generation || trackID != d.trackID || lap == nil || lap.TrackID != trackID || lap.LapTimeMS == 0 {
		return nil
	}
	d.bestLapData = lap
	d.bestLapTimeMS = lap.LapTimeMS
	d.bestLapTimes = make(map[int]uint32)
	for _, point := range lap.DataPoints {
		d.bestLapTimes[int(point.LapDistance/distanceBucketSize)] = point.LapTime
	}
	return nil
}

func (d *DeltaCalculator) resetLapLocked() {
	d.currentLapTimes = make(map[int]uint32)
	d.currentLapData = nil
	d.lastLapNum, d.lastDistance = 0, 0
	d.lapInvalid, d.lapStartObserved = false, false
	d.sector1MS, d.sector2MS = 0, 0
}

func (d *DeltaCalculator) resetLocked() {
	d.generation++
	d.bestLapTimes = make(map[int]uint32)
	d.bestLapData, d.bestLapTimeMS = nil, 0
	d.trackID = -1 // Australia is track 0.
	d.playerIndex = -1
	d.resetLapLocked()
}

func (d *DeltaCalculator) Reset() {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.resetLocked()
	d.sessionUID = 0
}

// ObserveSession must precede SetTrackID and lap ingestion at the packet boundary.
func (d *DeltaCalculator) ObserveSession(uid uint64) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if uid != 0 && uid != d.sessionUID {
		d.resetLocked()
		d.sessionUID = uid
	}
}

// ObservePlayer discards an incomplete trace before another player's packets
// can complete it. The saved reference for this track remains available.
func (d *DeltaCalculator) ObservePlayer(index uint8) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.playerIndex != int(index) {
		d.resetLapLocked()
		d.playerIndex = int(index)
	}
}

func (d *DeltaCalculator) SetTrackID(trackID int8) {
	d.mu.Lock()
	if trackID == d.trackID {
		d.mu.Unlock()
		return
	}
	d.resetLocked()
	d.trackID = trackID
	d.mu.Unlock()
	_ = d.LoadBestLapFromStorage()
}

// Update observes EVERY lap packet, independently of dashboard throttling.
// Validity and completed sectors belong to the previous lap snapshot.
func (d *DeltaCalculator) Update(header *packets.PacketHeader, lap *packets.LapData) int32 {
	if lap == nil || header == nil {
		return 0
	}
	d.ObserveSession(header.SessionUID)
	d.ObservePlayer(header.PlayerCarIndex)
	d.mu.Lock()
	var saved *LapTelemetry
	save, trackID := d.onSave, d.trackID
	if lap.CurrentLapNum != d.lastLapNum && d.lastLapNum > 0 {
		if lap.CurrentLapNum == d.lastLapNum+1 && !d.lapInvalid && d.lapStartObserved && lap.LastLapTimeInMS > 0 &&
			(d.bestLapTimeMS == 0 || lap.LastLapTimeInMS < d.bestLapTimeMS) {
			d.bestLapTimeMS = lap.LastLapTimeInMS
			d.bestLapTimes = maps.Clone(d.currentLapTimes)
			best := NewLapTelemetry(d.trackID)
			var sector3 uint32
			if d.sector1MS > 0 && d.sector2MS > 0 && lap.LastLapTimeInMS > d.sector1MS+d.sector2MS {
				sector3 = lap.LastLapTimeInMS - d.sector1MS - d.sector2MS
			}
			best.SetLapTimes(lap.LastLapTimeInMS, d.sector1MS, d.sector2MS, sector3)
			best.DataPoints = append([]TelemetryPoint(nil), d.currentLapData...)
			d.bestLapData = best
			copy := *best
			copy.DataPoints = append([]TelemetryPoint(nil), best.DataPoints...)
			saved = &copy
		}
		d.resetLapLocked()
	}
	if d.lastLapNum == 0 {
		d.lapStartObserved = lap.LapDistance >= 0 && lap.LapDistance < 50 && lap.CurrentLapTimeInMS < 5000
	}
	// A same-lap flashback invalidates the captured trace until the next full lap.
	if lap.CurrentLapNum == d.lastLapNum && lap.LapDistance < d.lastDistance {
		d.lapStartObserved = false
	}
	d.lastLapNum = lap.CurrentLapNum
	d.lapInvalid = d.lapInvalid || lap.CurrentLapInvalid != 0
	d.sector1MS = uint32(lap.Sector1TimeMinutes)*60000 + uint32(lap.Sector1TimeInMS)
	d.sector2MS = uint32(lap.Sector2TimeMinutes)*60000 + uint32(lap.Sector2TimeInMS)
	distance := max(0, sanitizeF32(lap.LapDistance))
	d.currentLapTimes[int(distance/distanceBucketSize)] = lap.CurrentLapTimeInMS
	d.lastDistance = distance
	delta := d.deltaLocked(distance, lap.CurrentLapTimeInMS)
	d.mu.Unlock()
	// One completed best per lap, ordered by the processor. Callback I/O must not
	// hold d.mu, and an older asynchronous save must not overwrite a newer best.
	if saved != nil && save != nil && trackID >= 0 {
		_ = save(trackID, saved)
	}
	return delta
}

func (d *DeltaCalculator) deltaLocked(distance float32, lapTime uint32) int32 {
	if d.bestLapData != nil && len(d.bestLapData.DataPoints) >= 2 {
		return d.calculatePreciseDelta(distance, lapTime)
	}
	return d.calculateBucketDelta(int(distance/distanceBucketSize), lapTime)
}

func (d *DeltaCalculator) DeltaAt(lap *packets.LapData) int32 {
	if lap == nil {
		return 0
	}
	d.mu.RLock()
	defer d.mu.RUnlock()
	return d.deltaLocked(max(0, sanitizeF32(lap.LapDistance)), lap.CurrentLapTimeInMS)
}

// UpdateWithTelemetry updates with both lap data and telemetry data for full precision
func (d *DeltaCalculator) UpdateWithTelemetry(
	header *packets.PacketHeader,
	lapData *packets.LapData,
	telemetry *packets.CarTelemetryData,
) int32 {
	if lapData == nil || header == nil {
		return 0
	}

	// First do the standard update
	delta := d.Update(header, lapData)

	// Then add telemetry point if we have telemetry data
	if telemetry != nil {
		d.addTelemetryPoint(header, lapData, telemetry)
	}

	return delta
}

// addTelemetryPoint adds a telemetry point to the current lap data
func (d *DeltaCalculator) addTelemetryPoint(
	header *packets.PacketHeader,
	lapData *packets.LapData,
	telemetry *packets.CarTelemetryData,
) {
	d.mu.Lock()
	defer d.mu.Unlock()

	distance := lapData.LapDistance
	if distance < 0 {
		distance = 0
	}

	// Skip if distance is not monotonically increasing or too close to last sample
	// This ensures binary search works correctly during interpolation
	if len(d.currentLapData) > 0 {
		lastPoint := d.currentLapData[len(d.currentLapData)-1]
		// Skip non-monotonic distances (can happen during lap wrap or data anomalies)
		if distance <= lastPoint.LapDistance {
			return
		}
		// Skip if too close to last sample
		if distance-lastPoint.LapDistance < d.minSampleInterval {
			return
		}
	}

	point := TelemetryPoint{
		LapDistance: sanitizeF32(distance),
		SessionTime: sanitizeF32(header.SessionTime),
		LapTime:     lapData.CurrentLapTimeInMS,
		Speed:       telemetry.Speed,
		Throttle:    sanitizeF32(telemetry.Throttle),
		Brake:       sanitizeF32(telemetry.Brake),
		Gear:        telemetry.Gear,
	}

	d.currentLapData = append(d.currentLapData, point)
}

// calculatePreciseDelta uses linear interpolation for accurate delta calculation
func (d *DeltaCalculator) calculatePreciseDelta(distance float32, currentLapTime uint32) int32 {
	bestTime, ok := d.interpolateTime(distance)
	if !ok {
		return 0
	}
	return int32(currentLapTime) - int32(bestTime)
}

// calculateBucketDelta uses the legacy bucket-based delta calculation
func (d *DeltaCalculator) calculateBucketDelta(bucket int, currentLapTime uint32) int32 {
	if len(d.bestLapTimes) == 0 {
		return 0
	}

	bestTimeAtDistance, ok := d.bestLapTimes[bucket]
	if !ok {
		// Find closest bucket
		closestBucket := -1
		closestDiff := int(1000000)
		for b := range d.bestLapTimes {
			diff := bucket - b
			if diff < 0 {
				diff = -diff
			}
			if diff < closestDiff {
				closestDiff = diff
				closestBucket = b
			}
		}
		if closestBucket >= 0 {
			bestTimeAtDistance = d.bestLapTimes[closestBucket]
		} else {
			return 0
		}
	}

	// Delta = current - best (positive = slower, negative = faster)
	return int32(currentLapTime) - int32(bestTimeAtDistance)
}

// interpolateTime calculates the reference time at exact distance using linear interpolation
func (d *DeltaCalculator) interpolateTime(distance float32) (uint32, bool) {
	if d.bestLapData == nil || len(d.bestLapData.DataPoints) < 2 {
		return 0, false
	}

	points := d.bestLapData.DataPoints

	// Binary search to find the insertion point
	idx := sort.Search(len(points), func(i int) bool {
		return points[i].LapDistance >= distance
	})

	// Handle edge cases
	if idx == 0 {
		return points[0].LapTime, true
	}
	if idx >= len(points) {
		return points[len(points)-1].LapTime, true
	}

	// Linear interpolation between two adjacent points
	p1, p2 := points[idx-1], points[idx]
	distDiff := p2.LapDistance - p1.LapDistance
	if distDiff == 0 {
		return p1.LapTime, true
	}

	ratio := (distance - p1.LapDistance) / distDiff
	interpolatedTime := float32(p1.LapTime) + ratio*(float32(p2.LapTime)-float32(p1.LapTime))

	return uint32(interpolatedTime), true
}

// GetBestLapTime returns the best lap time in milliseconds
func (d *DeltaCalculator) GetBestLapTime() uint32 {
	d.mu.RLock()
	defer d.mu.RUnlock()
	return d.bestLapTimeMS
}

// GetBestLapData returns a deep copy of the best lap telemetry data (may be nil)
// This prevents data races by not exposing internal mutable state
func (d *DeltaCalculator) GetBestLapData() *LapTelemetry {
	d.mu.RLock()
	defer d.mu.RUnlock()

	if d.bestLapData == nil {
		return nil
	}

	// Return a deep copy to prevent data races
	copyData := &LapTelemetry{
		TrackID:   d.bestLapData.TrackID,
		LapTimeMS: d.bestLapData.LapTimeMS,
		Sector1MS: d.bestLapData.Sector1MS,
		Sector2MS: d.bestLapData.Sector2MS,
		Sector3MS: d.bestLapData.Sector3MS,
		CreatedAt: d.bestLapData.CreatedAt,
	}
	if len(d.bestLapData.DataPoints) > 0 {
		copyData.DataPoints = make([]TelemetryPoint, len(d.bestLapData.DataPoints))
		copy(copyData.DataPoints, d.bestLapData.DataPoints)
	}
	return copyData
}

// GetCurrentLapPointCount returns the number of telemetry points in current lap
func (d *DeltaCalculator) GetCurrentLapPointCount() int {
	d.mu.RLock()
	defer d.mu.RUnlock()
	return len(d.currentLapData)
}

// GetCurrentLapData returns a copy of the current lap telemetry points
func (d *DeltaCalculator) GetCurrentLapData() []TelemetryPoint {
	d.mu.RLock()
	defer d.mu.RUnlock()

	if len(d.currentLapData) == 0 {
		return nil
	}

	copyData := make([]TelemetryPoint, len(d.currentLapData))
	copy(copyData, d.currentLapData)
	return copyData
}

// HasPreciseData returns true if precise telemetry data is available for delta calculation
func (d *DeltaCalculator) HasPreciseData() bool {
	d.mu.RLock()
	defer d.mu.RUnlock()
	return d.bestLapData != nil && len(d.bestLapData.DataPoints) >= 2
}
