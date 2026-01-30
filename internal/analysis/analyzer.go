package analysis

import (
	"bufio"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// AnalysisResult is the top-level result returned by the API.
type AnalysisResult struct {
	Laps   []LapSummary    `json:"laps"`
	Stints []StintAnalysis `json:"stints"`
	Speed  *SpeedAnalysis  `json:"speed,omitempty"`
}

// LapSummary holds per-lap timing info.
type LapSummary struct {
	LapNum    int     `json:"lapNum"`
	LapTimeMs uint32  `json:"lapTimeMs"`
	Sector1Ms uint32  `json:"sector1Ms"`
	Sector2Ms uint32  `json:"sector2Ms"`
	Sector3Ms uint32  `json:"sector3Ms"`
	Compound  string  `json:"compound"`
	TireAge   int     `json:"tireAge"`
	Valid     bool    `json:"valid"`
	TireWear  [4]float64 `json:"tireWear"` // FL, FR, RL, RR
}

// StintAnalysis summarises one stint.
type StintAnalysis struct {
	Compound  string     `json:"compound"`
	StartLap  int        `json:"startLap"`
	EndLap    int        `json:"endLap"`
	Laps      int        `json:"laps"`
	WearStart [4]float64 `json:"wearStart"`
	WearEnd   [4]float64 `json:"wearEnd"`
	WearRate  [4]float64 `json:"wearRate"` // per-lap average
}

// SpeedAnalysis holds per-distance speed data for the best lap and average across laps.
type SpeedAnalysis struct {
	Distances []float64 `json:"distances"` // distance axis (meters)
	BestSpeed []float64 `json:"bestSpeed"` // speed at each distance for best lap
	AvgSpeed  []float64 `json:"avgSpeed"`  // average speed at each distance across laps
	SlowZones []SlowZone `json:"slowZones"`
}

// SlowZone identifies a section that is significantly slower than average.
type SlowZone struct {
	DistanceStart float64 `json:"distanceStart"`
	DistanceEnd   float64 `json:"distanceEnd"`
	AvgSpeed      float64 `json:"avgSpeed"`
	BestSpeed     float64 `json:"bestSpeed"`
}

// ---- JSONL envelope structures ----

type packetEnvelope struct {
	TS        string          `json:"ts"`
	Frame     uint32          `json:"frame"`
	SessionTime float32       `json:"sessionTime"`
	PacketID  int             `json:"packetID"`
	Data      json.RawMessage `json:"data"`
}

// lap_data.jsonl
type lapDataPacket struct {
	Header  packetHeader `json:"Header"`
	LapData []lapDatum   `json:"LapData"`
}

type packetHeader struct {
	PlayerCarIndex int `json:"PlayerCarIndex"`
}

type lapDatum struct {
	LastLapTimeInMS          uint32  `json:"LastLapTimeInMS"`
	CurrentLapTimeInMS       uint32  `json:"CurrentLapTimeInMS"`
	Sector1TimeInMS          uint16  `json:"Sector1TimeInMS"`
	Sector2TimeInMS          uint16  `json:"Sector2TimeInMS"`
	Sector1TimeMSPart        uint16  `json:"Sector1TimeMSPart"`
	Sector2TimeMSPart        uint16  `json:"Sector2TimeMSPart"`
	LapDistance              float32 `json:"LapDistance"`
	CurrentLapNum            uint8   `json:"CurrentLapNum"`
	CurrentLapInvalid        uint8   `json:"CurrentLapInvalid"`
	Sector                   uint8   `json:"Sector"`
	BestOverallSector1TimeInMS uint32 `json:"BestOverallSector1TimeInMS"`
	BestOverallSector2TimeInMS uint32 `json:"BestOverallSector2TimeInMS"`
	BestOverallSector3TimeInMS uint32 `json:"BestOverallSector3TimeInMS"`
}

// telemetry.jsonl
type telemetryPacket struct {
	Header          packetHeader     `json:"Header"`
	CarTelemetryData []carTelemetry  `json:"CarTelemetryData"`
}

type carTelemetry struct {
	Speed    uint16  `json:"Speed"`
	Throttle float32 `json:"Throttle"`
	Brake    float32 `json:"Brake"`
	Gear     int8    `json:"Gear"`
}

// car_status.jsonl
type carStatusPacket struct {
	Header        packetHeader  `json:"Header"`
	CarStatusData []carStatus   `json:"CarStatusData"`
}

type carStatus struct {
	ActualTyreCompound  uint8 `json:"ActualTyreCompound"`
	VisualTyreCompound  uint8 `json:"VisualTyreCompound"`
	TyresAgeLaps        uint8 `json:"TyresAgeLaps"`
}

// ---- compound mapping ----

func compoundName(visual uint8) string {
	switch visual {
	case 16:
		return "Soft"
	case 17:
		return "Medium"
	case 18:
		return "Hard"
	case 7:
		return "Inter"
	case 8:
		return "Wet"
	default:
		return fmt.Sprintf("C%d", visual)
	}
}

// ---- Analyzer ----

// Analyze reads JSONL files from dir and produces an AnalysisResult.
// It expects dir to contain lap_data.jsonl, telemetry.jsonl, and car_status.jsonl.
func Analyze(dir string) (*AnalysisResult, error) {
	result := &AnalysisResult{}

	// 1. Parse lap_data → build per-lap timing
	laps, err := parseLapData(dir)
	if err != nil {
		return nil, fmt.Errorf("lap_data: %w", err)
	}

	// 2. Parse car_status → tire compound/age per frame
	tireInfo, err := parseTireData(dir)
	if err != nil {
		// Non-fatal: we can still return laps without tire info
		tireInfo = nil
	}

	// Merge tire info into laps
	if tireInfo != nil {
		mergeTireInfo(laps, tireInfo)
	}

	result.Laps = laps

	// 3. Build stints from lap data
	result.Stints = buildStints(laps)

	// 4. Parse telemetry → speed analysis
	speed, err := parseSpeedData(dir, laps)
	if err == nil && speed != nil {
		result.Speed = speed
	}

	return result, nil
}

// ---- lap data parsing ----

// parsedLapFrame holds one snapshot of a player's lap data
type parsedLapFrame struct {
	sessionTime float32
	lapNum      uint8
	lapTimeMs   uint32
	sector1Ms   uint16
	sector2Ms   uint16
	lapDist     float32
	invalid     bool
	sector      uint8
}

func parseLapData(dir string) ([]LapSummary, error) {
	path := filepath.Join(dir, "lap_data.jsonl")
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	var frames []parsedLapFrame
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 1024*1024), 1024*1024)

	for scanner.Scan() {
		var env packetEnvelope
		if err := json.Unmarshal(scanner.Bytes(), &env); err != nil {
			continue
		}
		var pkt lapDataPacket
		if err := json.Unmarshal(env.Data, &pkt); err != nil {
			continue
		}
		idx := pkt.Header.PlayerCarIndex
		if idx < 0 || idx >= len(pkt.LapData) {
			continue
		}
		ld := pkt.LapData[idx]
		frames = append(frames, parsedLapFrame{
			sessionTime: env.SessionTime,
			lapNum:      ld.CurrentLapNum,
			lapTimeMs:   ld.LastLapTimeInMS,
			sector1Ms:   ld.Sector1TimeInMS,
			sector2Ms:   ld.Sector2TimeInMS,
			lapDist:     ld.LapDistance,
			invalid:     ld.CurrentLapInvalid != 0,
			sector:      ld.Sector,
		})
	}

	if len(frames) == 0 {
		return nil, nil
	}

	// Build laps: detect when lapNum changes to extract the completed lap time
	type completedLap struct {
		lapNum    int
		lapTimeMs uint32
		sector1Ms uint32
		sector2Ms uint32
		sector3Ms uint32
		valid     bool
	}

	var completed []completedLap
	prevLapNum := int(frames[0].lapNum)

	for _, fr := range frames {
		curLap := int(fr.lapNum)
		if curLap > prevLapNum && fr.lapTimeMs > 0 {
			// The previous lap was completed
			s1 := uint32(fr.sector1Ms)
			s2 := uint32(fr.sector2Ms)
			var s3 uint32
			if fr.lapTimeMs > s1+s2 {
				s3 = fr.lapTimeMs - s1 - s2
			}
			completed = append(completed, completedLap{
				lapNum:    prevLapNum,
				lapTimeMs: fr.lapTimeMs,
				sector1Ms: s1,
				sector2Ms: s2,
				sector3Ms: s3,
				valid:     true, // we only know invalid for current lap
			})
		}
		prevLapNum = curLap
	}

	laps := make([]LapSummary, len(completed))
	for i, c := range completed {
		laps[i] = LapSummary{
			LapNum:    c.lapNum,
			LapTimeMs: c.lapTimeMs,
			Sector1Ms: c.sector1Ms,
			Sector2Ms: c.sector2Ms,
			Sector3Ms: c.sector3Ms,
			Valid:     c.valid,
		}
	}

	return laps, nil
}

// ---- tire data ----

type tireSnapshot struct {
	sessionTime float32
	compound    string
	visualComp  uint8
	age         int
}

func parseTireData(dir string) ([]tireSnapshot, error) {
	path := filepath.Join(dir, "car_status.jsonl")
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	var snaps []tireSnapshot
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 1024*1024), 1024*1024)

	for scanner.Scan() {
		var env packetEnvelope
		if err := json.Unmarshal(scanner.Bytes(), &env); err != nil {
			continue
		}
		var pkt carStatusPacket
		if err := json.Unmarshal(env.Data, &pkt); err != nil {
			continue
		}
		idx := pkt.Header.PlayerCarIndex
		if idx < 0 || idx >= len(pkt.CarStatusData) {
			continue
		}
		cs := pkt.CarStatusData[idx]
		if cs.VisualTyreCompound == 0 {
			continue
		}
		snaps = append(snaps, tireSnapshot{
			sessionTime: env.SessionTime,
			compound:    compoundName(cs.VisualTyreCompound),
			visualComp:  cs.VisualTyreCompound,
			age:         int(cs.TyresAgeLaps),
		})
	}

	return snaps, nil
}

func mergeTireInfo(laps []LapSummary, snaps []tireSnapshot) {
	if len(snaps) == 0 || len(laps) == 0 {
		return
	}
	// For each lap, find the last snapshot with matching tire age
	// Simple approach: use the last snapshot before compound changes
	snapIdx := 0
	for i := range laps {
		// Find snapshot closest to this lap's tire age
		bestAge := 0
		bestComp := ""
		for snapIdx < len(snaps) && snaps[snapIdx].age <= laps[i].LapNum {
			bestAge = snaps[snapIdx].age
			bestComp = snaps[snapIdx].compound
			snapIdx++
		}
		if snapIdx > 0 {
			snapIdx--
		}
		if bestComp != "" {
			laps[i].Compound = bestComp
			laps[i].TireAge = bestAge
		} else if len(snaps) > 0 {
			laps[i].Compound = snaps[0].compound
		}
	}
}

// ---- stint building ----

func buildStints(laps []LapSummary) []StintAnalysis {
	if len(laps) == 0 {
		return nil
	}

	var stints []StintAnalysis
	current := StintAnalysis{
		Compound: laps[0].Compound,
		StartLap: laps[0].LapNum,
		WearStart: laps[0].TireWear,
	}

	for i := 1; i < len(laps); i++ {
		if laps[i].Compound != current.Compound && laps[i].Compound != "" {
			// Stint change
			current.EndLap = laps[i-1].LapNum
			current.Laps = current.EndLap - current.StartLap + 1
			current.WearEnd = laps[i-1].TireWear
			calcWearRate(&current)
			stints = append(stints, current)

			current = StintAnalysis{
				Compound: laps[i].Compound,
				StartLap: laps[i].LapNum,
				WearStart: laps[i].TireWear,
			}
		}
	}

	// Close last stint
	last := laps[len(laps)-1]
	current.EndLap = last.LapNum
	current.Laps = current.EndLap - current.StartLap + 1
	current.WearEnd = last.TireWear
	calcWearRate(&current)
	stints = append(stints, current)

	return stints
}

func calcWearRate(s *StintAnalysis) {
	if s.Laps <= 0 {
		return
	}
	for i := 0; i < 4; i++ {
		s.WearRate[i] = (s.WearEnd[i] - s.WearStart[i]) / float64(s.Laps)
	}
}

// ---- speed analysis ----

type speedFrame struct {
	lapDist float32
	speed   uint16
	lapNum  uint8
}

func parseSpeedData(dir string, laps []LapSummary) (*SpeedAnalysis, error) {
	// We need both lap_data (for lapDist+lapNum) and telemetry (for speed)
	// They are separate packets at different frames. We correlate by frame.

	type frameData struct {
		lapDist float32
		speed   uint16
		lapNum  uint8
	}

	// Build frame→lapDist map from lap_data
	lapFrames := make(map[uint32]parsedLapFrame)
	{
		path := filepath.Join(dir, "lap_data.jsonl")
		f, err := os.Open(path)
		if err != nil {
			return nil, err
		}
		defer f.Close()
		scanner := bufio.NewScanner(f)
		scanner.Buffer(make([]byte, 1024*1024), 1024*1024)
		for scanner.Scan() {
			var env packetEnvelope
			if err := json.Unmarshal(scanner.Bytes(), &env); err != nil {
				continue
			}
			var pkt lapDataPacket
			if err := json.Unmarshal(env.Data, &pkt); err != nil {
				continue
			}
			idx := pkt.Header.PlayerCarIndex
			if idx < 0 || idx >= len(pkt.LapData) {
				continue
			}
			ld := pkt.LapData[idx]
			lapFrames[env.Frame] = parsedLapFrame{
				lapNum:  ld.CurrentLapNum,
				lapDist: ld.LapDistance,
			}
		}
	}

	// Build frame→speed map from telemetry
	telFrames := make(map[uint32]uint16)
	{
		path := filepath.Join(dir, "telemetry.jsonl")
		f, err := os.Open(path)
		if err != nil {
			return nil, err
		}
		defer f.Close()
		scanner := bufio.NewScanner(f)
		scanner.Buffer(make([]byte, 1024*1024), 1024*1024)
		for scanner.Scan() {
			var env packetEnvelope
			if err := json.Unmarshal(scanner.Bytes(), &env); err != nil {
				continue
			}
			var pkt telemetryPacket
			if err := json.Unmarshal(env.Data, &pkt); err != nil {
				continue
			}
			idx := pkt.Header.PlayerCarIndex
			if idx < 0 || idx >= len(pkt.CarTelemetryData) {
				continue
			}
			telFrames[env.Frame] = pkt.CarTelemetryData[idx].Speed
		}
	}

	// Merge by frame
	var merged []speedFrame
	for frame, lf := range lapFrames {
		speed, ok := telFrames[frame]
		if !ok {
			continue
		}
		if lf.lapDist < 0 {
			continue
		}
		merged = append(merged, speedFrame{
			lapDist: lf.lapDist,
			speed:   speed,
			lapNum:  lf.lapNum,
		})
	}

	if len(merged) == 0 {
		return nil, nil
	}

	// Find best lap
	bestLapNum := 0
	var bestLapTimeMs uint32 = math.MaxUint32
	for _, l := range laps {
		if l.LapTimeMs > 0 && l.LapTimeMs < bestLapTimeMs {
			bestLapTimeMs = l.LapTimeMs
			bestLapNum = l.LapNum
		}
	}

	// Bucket by distance (50m bins)
	const binSize = 50.0
	// Find max distance
	var maxDist float32
	for _, sf := range merged {
		if sf.lapDist > maxDist {
			maxDist = sf.lapDist
		}
	}
	numBins := int(maxDist/binSize) + 1
	if numBins <= 0 || numBins > 200 {
		// Cap at 200 bins (~10km track)
		if numBins > 200 {
			numBins = 200
		} else {
			return nil, nil
		}
	}

	type binData struct {
		totalSpeed float64
		count      int
	}

	bestBins := make([]binData, numBins)
	avgBins := make([]binData, numBins)

	for _, sf := range merged {
		bin := int(sf.lapDist / binSize)
		if bin < 0 || bin >= numBins {
			continue
		}
		spd := float64(sf.speed)
		avgBins[bin].totalSpeed += spd
		avgBins[bin].count++
		if int(sf.lapNum) == bestLapNum {
			bestBins[bin].totalSpeed += spd
			bestBins[bin].count++
		}
	}

	distances := make([]float64, numBins)
	bestSpeed := make([]float64, numBins)
	avgSpeed := make([]float64, numBins)

	for i := 0; i < numBins; i++ {
		distances[i] = float64(i)*binSize + binSize/2
		if bestBins[i].count > 0 {
			bestSpeed[i] = bestBins[i].totalSpeed / float64(bestBins[i].count)
		}
		if avgBins[i].count > 0 {
			avgSpeed[i] = avgBins[i].totalSpeed / float64(avgBins[i].count)
		}
	}

	// Identify slow zones: where avg speed < 80% of overall avg
	overallAvg := 0.0
	count := 0
	for _, s := range avgSpeed {
		if s > 0 {
			overallAvg += s
			count++
		}
	}
	if count > 0 {
		overallAvg /= float64(count)
	}

	threshold := overallAvg * 0.7
	var slowZones []SlowZone
	inSlow := false
	var currentZone SlowZone

	for i, s := range avgSpeed {
		if s > 0 && s < threshold {
			if !inSlow {
				inSlow = true
				currentZone = SlowZone{
					DistanceStart: distances[i] - binSize/2,
				}
			}
			currentZone.AvgSpeed += s
			if bestSpeed[i] > currentZone.BestSpeed {
				currentZone.BestSpeed = bestSpeed[i]
			}
		} else if inSlow {
			currentZone.DistanceEnd = distances[i-1] + binSize/2
			bins := int((currentZone.DistanceEnd - currentZone.DistanceStart) / binSize)
			if bins > 0 {
				currentZone.AvgSpeed /= float64(bins)
			}
			slowZones = append(slowZones, currentZone)
			inSlow = false
		}
	}
	if inSlow {
		currentZone.DistanceEnd = distances[len(distances)-1] + binSize/2
		bins := int((currentZone.DistanceEnd - currentZone.DistanceStart) / binSize)
		if bins > 0 {
			currentZone.AvgSpeed /= float64(bins)
		}
		slowZones = append(slowZones, currentZone)
	}

	return &SpeedAnalysis{
		Distances: distances,
		BestSpeed: bestSpeed,
		AvgSpeed:  avgSpeed,
		SlowZones: slowZones,
	}, nil
}

// ListSessions returns directory names under packetsDir.
type SessionInfo struct {
	UID       string `json:"uid"`
	Timestamp string `json:"timestamp"`
	Directory string `json:"directory"`
}

func ListSessions(packetsDir string) ([]SessionInfo, error) {
	entries, err := os.ReadDir(packetsDir)
	if err != nil {
		return nil, err
	}

	var sessions []SessionInfo
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		name := e.Name()
		// Format: {uid}_{date}_{time} e.g. "5362570775929466699_20260128_222712"
		parts := strings.SplitN(name, "_", 3)
		uid := ""
		ts := ""
		if len(parts) >= 1 {
			uid = parts[0]
		}
		if len(parts) >= 3 {
			ts = parts[1] + "_" + parts[2]
		} else if len(parts) == 2 {
			ts = parts[1]
		}

		// Only include directories that have at least lap_data.jsonl
		if _, err := os.Stat(filepath.Join(packetsDir, name, "lap_data.jsonl")); err != nil {
			continue
		}

		sessions = append(sessions, SessionInfo{
			UID:       uid,
			Timestamp: ts,
			Directory: name,
		})
	}

	// Sort by name descending (newest first)
	sort.Slice(sessions, func(i, j int) bool {
		return sessions[i].Directory > sessions[j].Directory
	})

	return sessions, nil
}
