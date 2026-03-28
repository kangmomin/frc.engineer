package strategydata

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

var (
	numberPattern    = regexp.MustCompile(`[-+]?\d*\.?\d+`)
	turnPattern      = regexp.MustCompile(`(?i)turn\s+(\d+)`)
	pitWindowPattern = regexp.MustCompile(`\d+(?:-\d+)?`)
)

func LoadRawTrack(path string) (*RawTrackFile, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var raw RawTrackFile
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("unmarshal %s: %w", path, err)
	}
	return &raw, nil
}

func LoadRawTyreTemps(path string) (RawTyreTempDataset, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var raw RawTyreTempDataset
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("unmarshal %s: %w", path, err)
	}
	return raw, nil
}

func NormalizeTrack(raw *RawTrackFile) (*NormalizedTrackFile, error) {
	if raw == nil {
		return nil, fmt.Errorf("raw track is nil")
	}

	lapCount, err := parseOptionalInt(raw.TrackInfo.LapCount)
	if err != nil {
		return nil, fmt.Errorf("%s lap_count: %w", raw.Track, err)
	}

	circuitLengthKM, err := parseFloatValue(raw.TrackInfo.CircuitLength)
	if err != nil {
		return nil, fmt.Errorf("%s circuit_length: %w", raw.Track, err)
	}

	lapRecordMS, err := parseClockMS(raw.TrackInfo.LapRecord)
	if err != nil {
		return nil, fmt.Errorf("%s lap_record: %w", raw.Track, err)
	}

	pitLimitKPH, pitLimitMPH, err := parsePitLimit(raw.TrackInfo.PitLimit)
	if err != nil {
		return nil, fmt.Errorf("%s pit_limit: %w", raw.Track, err)
	}

	out := &NormalizedTrackFile{
		Track: raw.Track,
		Source: NormalizedSource{
			URL:       raw.URL,
			ScrapedAt: raw.ScrapedAt,
		},
		TrackInfo: NormalizedTrackInfo{
			LapCount:         lapCount,
			Laps50Pct:        raw.TrackInfo.Laps50Pct,
			CircuitLengthKM:  circuitLengthKM,
			LapRecordDisplay: raw.TrackInfo.LapRecord,
			LapRecordMS:      lapRecordMS,
			DRSZones:         raw.TrackInfo.DRSZones,
			PolePositionSide: normalizePolePosition(raw.TrackInfo.PolePosition),
			PitLimitKPH:      pitLimitKPH,
			PitLimitMPH:      pitLimitMPH,
		},
		TyreStrategy: NormalizedTyreStrategy{
			Compounds:     cloneStringMap(raw.TyreStrategy.Compounds),
			WearPerLap:    make(map[string]NormalizedRangeValue, len(raw.TyreStrategy.WearPerLap)),
			TyreLife50Pct: make(map[string]NormalizedLapValue, len(raw.TyreStrategy.TyreLife50Pct)),
		},
		SetupTypeDescriptions: normalizeDescriptionMap(raw.SetupTypeDescriptions),
		Setups: NormalizedSetups{
			Dry: make([]NormalizedSetup, 0, len(raw.Setups.Dry)),
			Wet: make([]NormalizedSetup, 0, len(raw.Setups.Wet)),
		},
	}

	for key, value := range raw.TyreStrategy.WearPerLap {
		minPct, maxPct, err := parsePercentRange(value.Value)
		if err != nil {
			return nil, fmt.Errorf("%s wear_per_lap.%s: %w", raw.Track, key, err)
		}
		out.TyreStrategy.WearPerLap[key] = NormalizedRangeValue{
			Display:     value.Value,
			MinPct:      minPct,
			MaxPct:      maxPct,
			Description: nullableString(value.Description),
		}
	}

	for key, value := range raw.TyreStrategy.TyreLife50Pct {
		out.TyreStrategy.TyreLife50Pct[key] = NormalizedLapValue{
			Laps:        value.Laps,
			Description: nullableString(value.Description),
		}
	}

	quali, err := normalizeQualiStrategy(raw.QualiStrategy)
	if err != nil {
		return nil, fmt.Errorf("%s quali_strategy: %w", raw.Track, err)
	}
	out.QualiStrategy = quali

	race, err := normalizeRaceStrategy(raw.RaceStrategy)
	if err != nil {
		return nil, fmt.Errorf("%s race_strategy: %w", raw.Track, err)
	}
	out.RaceStrategy = race

	for _, setup := range raw.Setups.Dry {
		normalized, err := normalizeSetup(setup)
		if err != nil {
			return nil, fmt.Errorf("%s dry setup %q: %w", raw.Track, setup.Name, err)
		}
		out.Setups.Dry = append(out.Setups.Dry, normalized)
	}

	for _, setup := range raw.Setups.Wet {
		normalized, err := normalizeSetup(setup)
		if err != nil {
			return nil, fmt.Errorf("%s wet setup %q: %w", raw.Track, setup.Name, err)
		}
		out.Setups.Wet = append(out.Setups.Wet, normalized)
	}

	if strings.TrimSpace(raw.ERSGuide.TrackMapURL) != "" {
		out.ERSGuide = &NormalizedERSGuide{TrackMapURL: raw.ERSGuide.TrackMapURL}
	}
	out.HotlapVideoURL = nullableString(raw.HotlapVideo)

	return out, nil
}

func NormalizeTyreTemps(raw RawTyreTempDataset) (*NormalizedTyreTempDataset, error) {
	out := &NormalizedTyreTempDataset{
		Compounds: make(map[string]NormalizedTyreCompound, len(raw)),
	}

	keys := make([]string, 0, len(raw))
	for key := range raw {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	for _, compound := range keys {
		points := raw[compound]
		normalizedPoints := make([]NormalizedTyreTempPoint, 0, len(points))
		peakTemps := make([]int, 0, 2)

		for _, point := range points {
			tempC, err := parseIntValue(point.Temp)
			if err != nil {
				return nil, fmt.Errorf("%s temp %q: %w", compound, point.Temp, err)
			}
			gripPct, err := parseFloatValue(point.Grip)
			if err != nil {
				return nil, fmt.Errorf("%s grip %q: %w", compound, point.Grip, err)
			}

			normalizedPoints = append(normalizedPoints, NormalizedTyreTempPoint{
				TempC:   tempC,
				GripPct: gripPct,
				Zone:    strings.TrimSpace(point.Zone),
			})
			if strings.EqualFold(strings.TrimSpace(point.Zone), "peak") {
				peakTemps = append(peakTemps, tempC)
			}
		}

		out.Compounds[compound] = NormalizedTyreCompound{
			PeakTempsC: peakTemps,
			Points:     normalizedPoints,
		}
	}

	return out, nil
}

func NormalizeDirectory(inputRoot, outputRoot string, generatedAt time.Time) (*Manifest, error) {
	trackPaths, err := filepath.Glob(filepath.Join(inputRoot, "tracks", "*.json"))
	if err != nil {
		return nil, err
	}
	sort.Strings(trackPaths)

	if err := os.RemoveAll(outputRoot); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Join(outputRoot, "tracks"), 0o755); err != nil {
		return nil, err
	}

	tracks := make([]string, 0, len(trackPaths))
	for _, path := range trackPaths {
		raw, err := LoadRawTrack(path)
		if err != nil {
			return nil, err
		}
		normalized, err := NormalizeTrack(raw)
		if err != nil {
			return nil, err
		}

		outPath := filepath.Join(outputRoot, "tracks", filepath.Base(path))
		if err := writeJSON(outPath, normalized); err != nil {
			return nil, err
		}
		tracks = append(tracks, normalized.Track)
	}

	tyreTemps, err := LoadRawTyreTemps(filepath.Join(inputRoot, "tyre_temps.json"))
	if err != nil {
		return nil, err
	}
	normalizedTyreTemps, err := NormalizeTyreTemps(tyreTemps)
	if err != nil {
		return nil, err
	}
	if err := writeJSON(filepath.Join(outputRoot, "tyre_temps.json"), normalizedTyreTemps); err != nil {
		return nil, err
	}

	compoundKeys := make([]string, 0, len(normalizedTyreTemps.Compounds))
	for key := range normalizedTyreTemps.Compounds {
		compoundKeys = append(compoundKeys, key)
	}
	sort.Strings(compoundKeys)

	manifest := &Manifest{
		GeneratedAt:   generatedAt.UTC().Format(time.RFC3339),
		SourceRoot:    inputRoot,
		TrackCount:    len(tracks),
		Tracks:        tracks,
		TyreCompounds: compoundKeys,
	}
	if err := writeJSON(filepath.Join(outputRoot, "manifest.json"), manifest); err != nil {
		return nil, err
	}

	return manifest, nil
}

func normalizeQualiStrategy(raw RawQualiStrategy) (*NormalizedQualiStrategy, error) {
	if strings.TrimSpace(raw.FuelAmount.Value) == "" &&
		strings.TrimSpace(raw.OutlapTime.Value) == "" &&
		strings.TrimSpace(raw.StartingTyreTemps.Value) == "" &&
		strings.TrimSpace(raw.EnableERS.Value) == "" {
		return nil, nil
	}

	fuelKG, err := parseFloatValue(raw.FuelAmount.Value)
	if err != nil {
		return nil, err
	}
	outlapMS, err := parseClockMS(raw.OutlapTime.Value)
	if err != nil {
		return nil, err
	}
	startingTempC, err := parseIntValue(raw.StartingTyreTemps.Value)
	if err != nil {
		return nil, err
	}
	enableERSTurn, err := parseTurnReference(raw.EnableERS.Value)
	if err != nil {
		return nil, err
	}

	return &NormalizedQualiStrategy{
		FuelAmountKG:      fuelKG,
		OutlapTimeMS:      outlapMS,
		StartingTyreTempC: startingTempC,
		EnableERSTurn:     enableERSTurn,
		EnableERSDisplay:  raw.EnableERS.Value,
	}, nil
}

func normalizeRaceStrategy(raw RawRaceStrategy) (*NormalizedRaceStrategy, error) {
	if raw.Laps50Pct == 0 && raw.StartingFuel50Pct == nil && raw.PlanA == nil && raw.PlanB == nil && raw.Plan100Pct == nil && raw.PitStopTimeLost == nil && strings.TrimSpace(raw.Notes) == "" {
		return &NormalizedRaceStrategy{Available: false}, nil
	}

	out := &NormalizedRaceStrategy{
		Available: true,
		Laps50Pct: raw.Laps50Pct,
		Notes:     nullableString(raw.Notes),
	}

	if raw.StartingFuel50Pct != nil {
		value, err := parseFloatValue(raw.StartingFuel50Pct.Value)
		if err != nil {
			return nil, err
		}
		out.StartingFuel50PctKG = value
	}

	if raw.PitStopTimeLost != nil {
		value, err := parseFloatValue(raw.PitStopTimeLost.Value)
		if err != nil {
			return nil, err
		}
		out.PitStopTimeLostS = value
	}

	var err error
	if out.PlanA, err = normalizeRacePlan(raw.PlanA); err != nil {
		return nil, err
	}
	if out.PlanB, err = normalizeRacePlan(raw.PlanB); err != nil {
		return nil, err
	}
	if out.Plan100Pct, err = normalizeRacePlan(raw.Plan100Pct); err != nil {
		return nil, err
	}

	return out, nil
}

func normalizeRacePlan(raw *RawRacePlan) (*NormalizedRacePlan, error) {
	if raw == nil {
		return nil, nil
	}

	pitWindows, err := parsePitWindows(raw.PitWindow)
	if err != nil {
		return nil, err
	}

	return &NormalizedRacePlan{
		Tyres:            append([]string(nil), raw.Tyres...),
		PitWindowDisplay: raw.PitWindow,
		PitWindows:       pitWindows,
		Description:      nullableString(raw.Description),
	}, nil
}

func normalizeSetup(raw RawSetup) (NormalizedSetup, error) {
	var updatedDate *string
	if raw.Updated != nil && strings.TrimSpace(*raw.Updated) != "" {
		parsed, err := time.Parse("02/01/2006", strings.TrimSpace(*raw.Updated))
		if err != nil {
			return NormalizedSetup{}, err
		}
		iso := parsed.Format("2006-01-02")
		updatedDate = &iso
	}

	return NormalizedSetup{
		Name:                    raw.Name,
		ID:                      raw.ID,
		FrontWing:               raw.FrontWing,
		RearWing:                raw.RearWing,
		OnThrottleDifferential:  raw.OnThrottleDifferential,
		OffThrottleDifferential: raw.OffThrottleDifferential,
		FrontCamber:             raw.FrontCamber,
		RearCamber:              raw.RearCamber,
		FrontToe:                raw.FrontToe,
		RearToe:                 raw.RearToe,
		FrontSuspension:         raw.FrontSuspension,
		RearSuspension:          raw.RearSuspension,
		FrontAntiRollBar:        raw.FrontAntiRollBar,
		RearAntiRollBar:         raw.RearAntiRollBar,
		FrontRideHeight:         raw.FrontRideHeight,
		RearRideHeight:          raw.RearRideHeight,
		BrakeBias:               raw.BrakeBias,
		BrakePressure:           raw.BrakePressure,
		FrontRightPressure:      raw.FrontRightPressure,
		FrontLeftPressure:       raw.FrontLeftPressure,
		RearRightPressure:       raw.RearRightPressure,
		RearLeftPressure:        raw.RearLeftPressure,
		UpdatedDate:             updatedDate,
		Notes:                   nullableStringPtr(raw.Notes),
	}, nil
}

func normalizeDescriptionMap(input map[string]string) map[string]*string {
	out := make(map[string]*string, len(input))
	for key, value := range input {
		out[key] = nullableString(value)
	}
	return out
}

func parseOptionalInt(v any) (*int, error) {
	switch value := v.(type) {
	case nil:
		return nil, nil
	case float64:
		i := int(value)
		return &i, nil
	case string:
		trimmed := strings.TrimSpace(value)
		if trimmed == "" || strings.EqualFold(trimmed, "n/a") {
			return nil, nil
		}
		i, err := strconv.Atoi(trimmed)
		if err != nil {
			return nil, err
		}
		return &i, nil
	default:
		return nil, fmt.Errorf("unsupported type %T", v)
	}
}

func parsePitLimit(value string) (int, int, error) {
	parts := numberPattern.FindAllString(value, -1)
	if len(parts) < 2 {
		return 0, 0, fmt.Errorf("invalid pit limit %q", value)
	}

	kph, err := strconv.Atoi(parts[0])
	if err != nil {
		return 0, 0, err
	}
	mph, err := strconv.Atoi(parts[1])
	if err != nil {
		return 0, 0, err
	}
	return kph, mph, nil
}

func parsePercentRange(value string) (float64, float64, error) {
	trimmed := strings.ReplaceAll(strings.TrimSpace(value), " ", "")
	trimmed = strings.TrimSuffix(trimmed, "%")
	if trimmed == "" {
		return 0, 0, fmt.Errorf("invalid percent range %q", value)
	}

	if !strings.Contains(trimmed, "-") {
		v, err := strconv.ParseFloat(trimmed, 64)
		return v, v, err
	}

	parts := strings.SplitN(trimmed, "-", 2)
	minValue, err := strconv.ParseFloat(parts[0], 64)
	if err != nil {
		return 0, 0, err
	}
	maxValue, err := strconv.ParseFloat(parts[1], 64)
	if err != nil {
		return 0, 0, err
	}
	return minValue, maxValue, nil
}

func parseClockMS(value string) (int, error) {
	trimmed := strings.TrimSpace(value)
	parts := strings.Split(trimmed, ":")
	if len(parts) != 2 {
		return 0, fmt.Errorf("invalid clock value %q", value)
	}

	minutes, err := strconv.Atoi(parts[0])
	if err != nil {
		return 0, err
	}
	seconds, err := strconv.ParseFloat(parts[1], 64)
	if err != nil {
		return 0, err
	}
	return int(float64(minutes)*60_000 + seconds*1000), nil
}

func parseTurnReference(value string) (int, error) {
	match := turnPattern.FindStringSubmatch(value)
	if len(match) != 2 {
		return 0, fmt.Errorf("invalid turn reference %q", value)
	}
	return strconv.Atoi(match[1])
}

func parsePitWindows(value string) ([]NormalizedLapRange, error) {
	matches := pitWindowPattern.FindAllString(value, -1)
	if len(matches) == 0 {
		return nil, fmt.Errorf("invalid pit window %q", value)
	}

	windows := make([]NormalizedLapRange, 0, len(matches))
	for _, match := range matches {
		if strings.Contains(match, "-") {
			parts := strings.SplitN(match, "-", 2)
			startLap, err := strconv.Atoi(parts[0])
			if err != nil {
				return nil, err
			}
			endLap, err := strconv.Atoi(parts[1])
			if err != nil {
				return nil, err
			}
			windows = append(windows, NormalizedLapRange{StartLap: startLap, EndLap: endLap})
			continue
		}

		lap, err := strconv.Atoi(match)
		if err != nil {
			return nil, err
		}
		windows = append(windows, NormalizedLapRange{StartLap: lap, EndLap: lap})
	}
	return windows, nil
}

func parseFloatValue(value string) (float64, error) {
	match := numberPattern.FindString(value)
	if match == "" {
		return 0, fmt.Errorf("invalid numeric value %q", value)
	}
	return strconv.ParseFloat(match, 64)
}

func parseIntValue(value string) (int, error) {
	match := numberPattern.FindString(value)
	if match == "" {
		return 0, fmt.Errorf("invalid integer value %q", value)
	}
	return strconv.Atoi(strings.SplitN(match, ".", 2)[0])
}

func normalizePolePosition(value string) string {
	trimmed := strings.ToLower(strings.TrimSpace(value))
	switch {
	case strings.Contains(trimmed, "left"):
		return "left"
	case strings.Contains(trimmed, "right"):
		return "right"
	default:
		return trimmed
	}
}

func cloneStringMap(input map[string]string) map[string]string {
	out := make(map[string]string, len(input))
	for key, value := range input {
		out[key] = value
	}
	return out
}

func nullableString(value string) *string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func nullableStringPtr(value *string) *string {
	if value == nil {
		return nil
	}
	return nullableString(*value)
}

func writeJSON(path string, value any) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	return os.WriteFile(path, data, 0o644)
}
