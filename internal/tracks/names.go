package tracks

import "strings"

const (
	FormatF125 = "F1 25"
	FormatF126 = "F1 26"
)

type trackDescriptor struct {
	id          int8
	displayName string
	storageKey  string
	aliases     []string
}

// TrackFormatPair is one public, canonical track/format combination.
type TrackFormatPair struct {
	TrackID    int
	Format     string
	SearchText string
}

var trackDescriptors = []trackDescriptor{
	{id: 0, displayName: "Australia", storageKey: "australia", aliases: []string{"melbourne", "albert_park"}},
	{id: 2, displayName: "China", storageKey: "china", aliases: []string{"shanghai"}},
	{id: 3, displayName: "Bahrain", storageKey: "bahrain", aliases: []string{"sakhir", "bahrain_international", "bahrain_international_circuit"}},
	{id: 4, displayName: "Spain", storageKey: "spain", aliases: []string{"catalunya", "barcelona"}},
	{id: 5, displayName: "Monaco", storageKey: "monaco", aliases: []string{"monte_carlo"}},
	{id: 6, displayName: "Canada", storageKey: "canada", aliases: []string{"montreal", "circuit_gilles_villeneuve"}},
	{id: 7, displayName: "United Kingdom", storageKey: "britain", aliases: []string{"great_britain", "united_kingdom", "silverstone", "silverstone_circuit"}},
	{id: 8, displayName: "Hungary", storageKey: "hungary", aliases: []string{"hungaroring"}},
	{id: 9, displayName: "Belgium", storageKey: "belgium", aliases: []string{"spa", "spa_francorchamps", "spa_francorchamps_circuit"}},
	{id: 10, displayName: "Italy (Monza)", storageKey: "italy_monza", aliases: []string{"italy", "monza", "autodromo_nazionale_monza"}},
	{id: 11, displayName: "Singapore", storageKey: "singapore", aliases: []string{"marina_bay", "marina_bay_street_circuit"}},
	{id: 12, displayName: "Japan", storageKey: "japan", aliases: []string{"suzuka"}},
	{id: 13, displayName: "United Arab Emirates", storageKey: "united_arab_emirates", aliases: []string{"uae", "abu_dhabi", "abu-dhabi", "yas_marina", "yas_marina_circuit"}},
	{id: 14, displayName: "United States (Austin)", storageKey: "united_states_austin", aliases: []string{"usa_austin", "texas", "cota", "circuit_of_the_americas"}},
	{id: 16, displayName: "Brazil", storageKey: "brazil", aliases: []string{"interlagos", "autodromo_jose_carlos_pace"}},
	{id: 17, displayName: "Austria", storageKey: "austria", aliases: []string{"red_bull_ring"}},
	{id: 19, displayName: "Mexico", storageKey: "mexico", aliases: []string{"autodromo_hermanos_rodriguez"}},
	{id: 20, displayName: "Azerbaijan", storageKey: "azerbaijan", aliases: []string{"baku", "baku_city_circuit"}},
	{id: 23, displayName: "Netherlands", storageKey: "netherlands", aliases: []string{"zandvoort"}},
	{id: 24, displayName: "Italy (Imola)", storageKey: "italy_imola", aliases: []string{"imola", "emilia_romagna", "autodromo_enzo_e_dino_ferrari"}},
	{id: 25, displayName: "Saudi Arabia", storageKey: "saudi_arabia", aliases: []string{"jeddah", "saudi-arabia", "jeddah_corniche", "jeddah_corniche_circuit"}},
	{id: 26, displayName: "United States (Miami)", storageKey: "united_states_miami", aliases: []string{"usa_miami", "miami", "miami_international_autodrome"}},
	{id: 27, displayName: "Qatar", storageKey: "qatar", aliases: []string{"losail", "lusail", "lusail_international_circuit"}},
	{id: 28, displayName: "United States (Las Vegas)", storageKey: "united_states_las_vegas", aliases: []string{"usa_las_vegas", "las_vegas", "las-vegas", "las_vegas_strip_circuit"}},
	// 2026 Season Pack 신규 트랙. ID는 packets.CanonicalTrackID 변환 후의 값
	// (2026 wire enum과 동일 — F1 25 공간과 충돌 없음).
	{id: 39, displayName: "United Kingdom (Reverse)", storageKey: "britain_reverse", aliases: []string{"silverstone_reverse"}},
	{id: 40, displayName: "Austria (Reverse)", storageKey: "austria_reverse", aliases: []string{"red_bull_ring_reverse"}},
	{id: 41, displayName: "Netherlands (Reverse)", storageKey: "netherlands_reverse", aliases: []string{"zandvoort_reverse"}},
	{id: 42, displayName: "Spain (Madrid)", storageKey: "madrid", aliases: []string{"madring", "circuito_de_madring", "madrid_circuit"}},
}

var (
	trackDescriptorsByID = make(map[int8]trackDescriptor, len(trackDescriptors))
	trackDescriptorByKey = make(map[string]trackDescriptor, len(trackDescriptors)*4)
)

func init() {
	for _, desc := range trackDescriptors {
		trackDescriptorsByID[desc.id] = desc
		registerTrackDescriptorKey(desc, desc.displayName)
		registerTrackDescriptorKey(desc, desc.storageKey)
		for _, alias := range desc.aliases {
			registerTrackDescriptorKey(desc, alias)
		}
	}
}

func registerTrackDescriptorKey(desc trackDescriptor, value string) {
	key := NormalizeRecordedTrackName(value)
	if key == "unknown" {
		return
	}
	if _, exists := trackDescriptorByKey[key]; !exists {
		trackDescriptorByKey[key] = desc
	}
}

func lookupTrackDescriptor(name string) (trackDescriptor, bool) {
	key := NormalizeRecordedTrackName(name)
	if key == "unknown" {
		return trackDescriptor{}, false
	}
	desc, ok := trackDescriptorByKey[key]
	return desc, ok
}

// TrackName returns the canonical display name for a given trackID.
func TrackName(trackID int8) string {
	if desc, ok := trackDescriptorsByID[trackID]; ok {
		return desc.displayName
	}
	return "Unknown"
}

// TrackStorageKey returns the canonical filename-safe storage key for a given trackID.
func TrackStorageKey(trackID int8) string {
	if desc, ok := trackDescriptorsByID[trackID]; ok {
		return desc.storageKey
	}
	return "unknown"
}

// TrackSearchNames returns the canonical display name, storage key, and known
// aliases for a track. Callers can use it to match user-facing search text
// without maintaining a second track catalog.
func TrackSearchNames(trackID int) []string {
	desc, ok := trackDescriptorsByID[int8(trackID)]
	if !ok || int(desc.id) != trackID {
		return nil
	}
	return append([]string{desc.displayName, desc.storageKey}, desc.aliases...)
}

// IsSupportedTrackFormat reports whether a canonical track belongs to a public
// Hub format. The reverse layouts (39..42) only exist in the F1 26 pack.
func IsSupportedTrackFormat(trackID int, format string) bool {
	desc, ok := trackDescriptorsByID[int8(trackID)]
	if !ok || int(desc.id) != trackID {
		return false
	}
	return format == FormatF126 || (format == FormatF125 && desc.id < 39)
}

// SupportedTrackFormatPairs returns every public track/format pair in registry
// order. It is intentionally derived from trackDescriptors so consumers do not
// copy the catalog when adding a season-pack track.
func SupportedTrackFormatPairs() []TrackFormatPair {
	pairs := make([]TrackFormatPair, 0, len(trackDescriptors)*2)
	for _, desc := range trackDescriptors {
		if desc.id < 39 {
			pairs = append(pairs, TrackFormatPair{TrackID: int(desc.id), Format: FormatF125, SearchText: SearchText(int(desc.id))})
		}
		pairs = append(pairs, TrackFormatPair{TrackID: int(desc.id), Format: FormatF126, SearchText: SearchText(int(desc.id))})
	}
	return pairs
}

// SearchText returns a space-separated, canonical search corpus for a track.
// Keep both stored spellings and whitespace spellings so aliases such as
// "great_britain" also match a human query for "great britain".
func SearchText(trackID int) string {
	values := TrackSearchNames(trackID)
	if len(values) == 0 {
		return ""
	}
	seen := make(map[string]struct{}, len(values)*2)
	parts := make([]string, 0, len(values)*2)
	for _, value := range values {
		for _, candidate := range []string{value, strings.ReplaceAll(value, "_", " ")} {
			candidate = strings.ToLower(candidate)
			if candidate == "" {
				continue
			}
			if _, ok := seen[candidate]; ok {
				continue
			}
			seen[candidate] = struct{}{}
			parts = append(parts, candidate)
		}
	}
	return strings.Join(parts, " ")
}

// TrackDisplayName resolves arbitrary track labels or file basenames into the canonical display name.
func TrackDisplayName(name string) string {
	if desc, ok := lookupTrackDescriptor(name); ok {
		return desc.displayName
	}
	key := NormalizeRecordedTrackName(name)
	if key == "unknown" {
		return "Unknown"
	}
	return humanizeTrackKey(key)
}

func canonicalRecordedTrackName(name string) string {
	if desc, ok := lookupTrackDescriptor(name); ok {
		return desc.storageKey
	}
	return NormalizeRecordedTrackName(name)
}

func trackFileKeys(trackID int8) []string {
	desc, ok := trackDescriptorsByID[trackID]
	if !ok {
		return nil
	}
	keys := []string{desc.storageKey}
	for _, alias := range desc.aliases {
		key := NormalizeRecordedTrackName(alias)
		if key == "unknown" || key == desc.storageKey {
			continue
		}
		keys = append(keys, key)
	}
	return uniqueTrackKeys(keys)
}

func recordedFileKeysForName(name string) []string {
	if desc, ok := lookupTrackDescriptor(name); ok {
		keys := []string{desc.storageKey}
		for _, alias := range desc.aliases {
			key := NormalizeRecordedTrackName(alias)
			if key == "unknown" || key == desc.storageKey {
				continue
			}
			keys = append(keys, key)
		}
		return uniqueTrackKeys(keys)
	}

	key := NormalizeRecordedTrackName(name)
	if key == "unknown" {
		return nil
	}
	return []string{key}
}

func uniqueTrackKeys(values []string) []string {
	out := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out
}

func humanizeTrackKey(key string) string {
	parts := strings.Fields(strings.ReplaceAll(key, "_", " "))
	for i, part := range parts {
		if part == "" {
			continue
		}
		parts[i] = strings.ToUpper(part[:1]) + part[1:]
	}
	if len(parts) == 0 {
		return "Unknown"
	}
	return strings.Join(parts, " ")
}
