package telemetry

import (
	"maps"
	"sort"
	"sync"

	"frc.engineer/internal/packets"
)

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
	lastLapNum   uint8
	lastDistance float32
	sessionUID   uint64
	trackID      int8

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

// LoadBestLapFromStorage loads the best lap for the current track from storage
// This should be called after setting the trackID via SetTrackID
func (d *DeltaCalculator) LoadBestLapFromStorage() error {
	d.mu.Lock()
	defer d.mu.Unlock()

	if d.onLoad == nil {
		return nil
	}

	if d.trackID == 0 {
		return nil
	}

	lap, err := d.onLoad(d.trackID)
	if err != nil {
		return err
	}

	if lap == nil {
		return nil
	}

	// Set the loaded best lap data
	d.bestLapData = lap
	d.bestLapTimeMS = lap.LapTimeMS

	// Reconstruct bucket-based times from telemetry points for backward compatibility
	if len(lap.DataPoints) > 0 {
		d.bestLapTimes = make(map[int]uint32)
		for _, point := range lap.DataPoints {
			bucket := int(point.LapDistance / distanceBucketSize)
			d.bestLapTimes[bucket] = point.LapTime
		}
	}

	return nil
}

// Reset clears all stored data (call when session changes)
func (d *DeltaCalculator) Reset() {
	d.mu.Lock()
	defer d.mu.Unlock()

	d.bestLapTimes = make(map[int]uint32)
	d.currentLapTimes = make(map[int]uint32)
	d.bestLapTimeMS = 0
	d.bestLapData = nil
	d.currentLapData = make([]TelemetryPoint, 0, 1000)
	d.lastLapNum = 0
	d.lastDistance = 0
	d.sessionUID = 0
	d.trackID = 0
}

// SetTrackID sets the current track ID and attempts to load best lap from storage
func (d *DeltaCalculator) SetTrackID(trackID int8) {
	d.mu.Lock()
	oldTrackID := d.trackID
	d.trackID = trackID
	onLoad := d.onLoad
	d.mu.Unlock()

	// If track changed and we have a load callback, try to load best lap
	if trackID != oldTrackID && trackID != 0 && onLoad != nil {
		lap, err := onLoad(trackID)
		if err == nil && lap != nil {
			d.mu.Lock()
			d.bestLapData = lap
			d.bestLapTimeMS = lap.LapTimeMS
			// Reconstruct bucket-based times
			if len(lap.DataPoints) > 0 {
				d.bestLapTimes = make(map[int]uint32)
				for _, point := range lap.DataPoints {
					bucket := int(point.LapDistance / distanceBucketSize)
					d.bestLapTimes[bucket] = point.LapTime
				}
			}
			d.mu.Unlock()
		}
	}
}

// Update updates the calculator with new lap data and returns the delta to personal best
func (d *DeltaCalculator) Update(header *packets.PacketHeader, lapData *packets.LapData) int32 {
	if lapData == nil || header == nil {
		return 0
	}

	d.mu.Lock()
	defer d.mu.Unlock()

	// Check for session change
	if header.SessionUID != d.sessionUID {
		d.bestLapTimes = make(map[int]uint32)
		d.currentLapTimes = make(map[int]uint32)
		d.bestLapTimeMS = 0
		d.bestLapData = nil
		d.currentLapData = make([]TelemetryPoint, 0, 1000)
		d.lastLapNum = 0
		d.lastDistance = 0
		d.sessionUID = header.SessionUID
	}

	// Check for new lap
	if lapData.CurrentLapNum != d.lastLapNum && d.lastLapNum > 0 {
		// Lap completed, check if it's a personal best
		if lapData.LastLapTimeInMS > 0 {
			if d.bestLapTimeMS == 0 || lapData.LastLapTimeInMS < d.bestLapTimeMS {
				d.bestLapTimeMS = lapData.LastLapTimeInMS
				// Copy current lap times to best lap times (legacy)
				d.bestLapTimes = make(map[int]uint32)
				maps.Copy(d.bestLapTimes, d.currentLapTimes)

				// Store full telemetry data
				d.bestLapData = NewLapTelemetry(d.trackID)
				// Calculate sector 3 from total lap time - sector1 - sector2
				sector3MS := uint16(0)
				totalSectors := uint32(lapData.Sector1TimeInMS) + uint32(lapData.Sector2TimeInMS)
				if lapData.LastLapTimeInMS > totalSectors {
					sector3MS = uint16(lapData.LastLapTimeInMS - totalSectors)
				}
				d.bestLapData.SetLapTimes(
					lapData.LastLapTimeInMS,
					lapData.Sector1TimeInMS,
					lapData.Sector2TimeInMS,
					sector3MS,
				)
				d.bestLapData.DataPoints = make([]TelemetryPoint, len(d.currentLapData))
				copy(d.bestLapData.DataPoints, d.currentLapData)

				// Persist to storage if callback is set
				if d.onSave != nil && d.trackID != 0 {
					// Run in goroutine to avoid blocking telemetry processing
					lapCopy := &LapTelemetry{
						TrackID:    d.bestLapData.TrackID,
						LapTimeMS:  d.bestLapData.LapTimeMS,
						Sector1MS:  d.bestLapData.Sector1MS,
						Sector2MS:  d.bestLapData.Sector2MS,
						Sector3MS:  d.bestLapData.Sector3MS,
						CreatedAt:  d.bestLapData.CreatedAt,
						DataPoints: make([]TelemetryPoint, len(d.bestLapData.DataPoints)),
					}
					copy(lapCopy.DataPoints, d.bestLapData.DataPoints)
					go d.onSave(d.trackID, lapCopy)
				}
			}
		}
		// Clear current lap data for new lap
		d.currentLapTimes = make(map[int]uint32)
		d.currentLapData = d.currentLapData[:0] // Reuse underlying array
	}

	d.lastLapNum = lapData.CurrentLapNum

	// Handle lap distance wrap-around (new lap starts at 0)
	distance := lapData.LapDistance
	if distance < 0 {
		distance = 0
	}

	// Store current lap time at this distance bucket (legacy)
	bucket := int(distance / distanceBucketSize)
	d.currentLapTimes[bucket] = lapData.CurrentLapTimeInMS
	d.lastDistance = distance

	// Calculate delta using precise interpolation if available
	if d.bestLapData != nil && len(d.bestLapData.DataPoints) >= 2 {
		return d.calculatePreciseDelta(distance, lapData.CurrentLapTimeInMS)
	}

	// Fallback to bucket-based delta
	return d.calculateBucketDelta(bucket, lapData.CurrentLapTimeInMS)
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
		LapDistance: distance,
		SessionTime: header.SessionTime,
		LapTime:     lapData.CurrentLapTimeInMS,
		Speed:       telemetry.Speed,
		Throttle:    telemetry.Throttle,
		Brake:       telemetry.Brake,
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
