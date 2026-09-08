package analysis

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// AnalysisResult is the top-level result returned by the API.
type AnalysisResult struct {
	Session    *SessionMetadata    `json:"session,omitempty"`
	Laps       []LapSummary        `json:"laps"`
	Stints     []StintAnalysis     `json:"stints"`
	Speed      *SpeedAnalysis      `json:"speed,omitempty"`
	Comparison *ComparisonAnalysis `json:"comparison,omitempty"`
}

// LapSummary holds per-lap timing info.
type LapSummary struct {
	LapNum    int        `json:"lapNum"`
	LapTimeMs uint32     `json:"lapTimeMs"`
	Sector1Ms uint32     `json:"sector1Ms"`
	Sector2Ms uint32     `json:"sector2Ms"`
	Sector3Ms uint32     `json:"sector3Ms"`
	Compound  string     `json:"compound"`
	TireAge   int        `json:"tireAge"`
	Valid     bool       `json:"valid"`
	TireWear  [4]float64 `json:"tireWear"` // FL, FR, RL, RR

	// Capture boundaries are internal: tyre age is not an absolute lap number.
	endSessionTime           float32
	endRecordedAt            time.Time
	generationStart          time.Time
	generation               int
	playerIndex              int
	startOrdinal, endOrdinal int
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
	Distances []float64  `json:"distances"` // distance axis (meters)
	BestSpeed []float64  `json:"bestSpeed"` // speed at each distance for best lap
	AvgSpeed  []float64  `json:"avgSpeed"`  // average speed at each distance across laps
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
	TS          string          `json:"ts"`
	Frame       uint32          `json:"frame"`
	SessionTime float32         `json:"sessionTime"`
	PacketID    int             `json:"packetID"`
	Data        json.RawMessage `json:"data"`
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
	LastLapTimeInMS            uint32  `json:"LastLapTimeInMS"`
	CurrentLapTimeInMS         uint32  `json:"CurrentLapTimeInMS"`
	Sector1TimeInMS            uint16  `json:"Sector1TimeInMS"`
	Sector2TimeInMS            uint16  `json:"Sector2TimeInMS"`
	Sector1TimeMSPart          uint16  `json:"Sector1TimeMSPart"`
	Sector2TimeMSPart          uint16  `json:"Sector2TimeMSPart"`
	Sector1TimeMinutes         uint8   `json:"Sector1TimeMinutes"`
	Sector2TimeMinutes         uint8   `json:"Sector2TimeMinutes"`
	Sector1TimeMinPart         uint8   `json:"Sector1TimeMinPart"`
	Sector2TimeMinPart         uint8   `json:"Sector2TimeMinPart"`
	LapDistance                float32 `json:"LapDistance"`
	CurrentLapNum              uint8   `json:"CurrentLapNum"`
	CurrentLapInvalid          uint8   `json:"CurrentLapInvalid"`
	Sector                     uint8   `json:"Sector"`
	BestOverallSector1TimeInMS uint32  `json:"BestOverallSector1TimeInMS"`
	BestOverallSector2TimeInMS uint32  `json:"BestOverallSector2TimeInMS"`
	BestOverallSector3TimeInMS uint32  `json:"BestOverallSector3TimeInMS"`
}

// car_status.jsonl
type carStatusPacket struct {
	Header        packetHeader `json:"Header"`
	CarStatusData []carStatus  `json:"CarStatusData"`
}

type carStatus struct {
	ActualTyreCompound uint8 `json:"ActualTyreCompound"`
	VisualTyreCompound uint8 `json:"VisualTyreCompound"`
	TyresAgeLaps       uint8 `json:"TyresAgeLaps"`
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

	if meta, err := readSessionMetadata(dir); err == nil {
		result.Session = meta
	}

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

	// 4. Build comparison traces and derive speed analysis from the same merged samples.
	comparison, speed, err := buildComparisonAnalysis(dir, laps)
	if err == nil {
		result.Comparison = comparison
		result.Speed = speed
	}

	return result, nil
}

// ---- lap data parsing ----

// parsedLapFrame holds one snapshot of a player's lap data
type parsedLapFrame struct {
	recordedAt        time.Time
	identity          captureIdentity
	distance, elapsed *float64
	currentLapTimeMs  uint32
	playerIndex       int
	sessionTime       float32
	lapNum            uint8
	lapTimeMs         uint32
	sector1Ms         uint32
	sector2Ms         uint32
	lapDist           float32
	invalid           bool
	sector            uint8
}

func parseLapData(dir string) ([]LapSummary, error) {
	frames, err := readLapTimeline(context.Background(), dir, -1)
	if err != nil {
		return nil, err
	}
	return summarizeLapFrames(frames), nil
}

func summarizeLapFrames(frames []parsedLapFrame) []LapSummary {
	if len(frames) == 0 {
		return nil
	}

	var laps []LapSummary
	previous := frames[0]
	invalid := previous.invalid
	var s1, s2 uint32
	generation := 0
	var generationStart time.Time
	observeSectors := func(fr parsedLapFrame) {
		if fr.sector >= 1 && fr.sector1Ms > 0 {
			s1 = fr.sector1Ms
		}
		if fr.sector >= 2 && fr.sector2Ms > 0 {
			s2 = fr.sector2Ms
		}
	}
	observeSectors(previous)
	startOrdinal := 0
	for i, fr := range frames[1:] {
		ordinal := i + 1
		playerChanged := fr.playerIndex != previous.playerIndex || !sameUID(fr.identity, previous.identity)
		rewound := lapRewound(fr, previous)
		if rewound || playerChanged {
			// Discard abandoned completions and invalidate pre-flashback tyre
			// observations. Same-lap rewinds also reset invalid/sector state.
			for len(laps) > 0 && (playerChanged || laps[len(laps)-1].LapNum >= int(fr.lapNum)) {
				laps = laps[:len(laps)-1]
			}
			startOrdinal = ordinal
			generation++
			generationStart = fr.recordedAt
			s1, s2, invalid = 0, 0, fr.invalid
		} else if fr.lapNum != previous.lapNum {
			if previous.lapNum > 0 && int(fr.lapNum) == int(previous.lapNum)+1 && fr.lapTimeMs > 0 {
				// Prefer the completed lap's observations. Some legacy logs
				// retain completed sectors in the first frame after the line.
				if fr.sector == 0 && fr.currentLapTimeMs < 1000 {
					if s1 == 0 {
						s1 = fr.sector1Ms
					}
					if s2 == 0 {
						s2 = fr.sector2Ms
					}
				}
				var s3 uint32
				if s1 > 0 && s2 > 0 && fr.lapTimeMs > s1+s2 {
					s3 = fr.lapTimeMs - s1 - s2
				}
				laps = append(laps, LapSummary{
					LapNum: int(previous.lapNum), LapTimeMs: fr.lapTimeMs,
					Sector1Ms: s1, Sector2Ms: s2, Sector3Ms: s3, Valid: !invalid,
					endSessionTime: fr.sessionTime - float32(fr.currentLapTimeMs)/1000,
					endRecordedAt:  fr.recordedAt, generationStart: generationStart,
					generation: generation, playerIndex: previous.playerIndex,
					startOrdinal: startOrdinal, endOrdinal: ordinal,
				})
			}
			startOrdinal = ordinal
			s1, s2, invalid = 0, 0, fr.invalid
		} else {
			invalid = invalid || fr.invalid
		}
		observeSectors(fr)
		previous = fr
	}

	return laps
}

// ---- tire data ----

type tireSnapshot struct {
	recordedAt  time.Time
	generation  int
	playerIndex int
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
	generation := 0
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
		recordedAt, _ := time.Parse(time.RFC3339Nano, env.TS)
		if len(snaps) > 0 && env.SessionTime < snaps[len(snaps)-1].sessionTime {
			generation++
		}
		snaps = append(snaps, tireSnapshot{
			recordedAt: recordedAt, generation: generation, playerIndex: idx,
			sessionTime: env.SessionTime,
			compound:    compoundName(cs.VisualTyreCompound),
			visualComp:  cs.VisualTyreCompound,
			age:         int(cs.TyresAgeLaps),
		})
	}

	return snaps, scanner.Err()
}

func mergeTireInfo(laps []LapSummary, snaps []tireSnapshot) {
	for i := range laps {
		lap := &laps[i]
		for _, snap := range snaps {
			// A compound switched on the new lap belongs to that lap, even
			// when both packets share a capture timestamp or a reset tyre age.
			if snap.playerIndex != lap.playerIndex || snap.sessionTime >= lap.endSessionTime {
				continue
			}
			if !snap.recordedAt.IsZero() && !lap.endRecordedAt.IsZero() {
				if snap.recordedAt.After(lap.endRecordedAt) || snap.recordedAt.Before(lap.generationStart) {
					continue
				}
			} else if snap.generation != lap.generation {
				continue
			}
			lap.Compound, lap.TireAge = snap.compound, snap.age
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
		Compound:  laps[0].Compound,
		StartLap:  laps[0].LapNum,
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
				Compound:  laps[i].Compound,
				StartLap:  laps[i].LapNum,
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
