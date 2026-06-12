package packets

// PacketID identifies the type of F1 25 UDP packet
type PacketID uint8

const (
	PacketIDMotion         PacketID = 0
	PacketIDSession        PacketID = 1
	PacketIDLapData        PacketID = 2
	PacketIDEvent          PacketID = 3
	PacketIDParticipants   PacketID = 4
	PacketIDCarSetups      PacketID = 5
	PacketIDCarTelemetry   PacketID = 6
	PacketIDCarStatus      PacketID = 7
	PacketIDFinalClass     PacketID = 8
	PacketIDLobbyInfo      PacketID = 9
	PacketIDCarDamage      PacketID = 10
	PacketIDSessionHistory PacketID = 11
	PacketIDTyreSets       PacketID = 12
	PacketIDMotionEx       PacketID = 13
	PacketIDTimeTrial      PacketID = 14
	PacketIDLapPositions   PacketID = 15 // 2026 Season Pack 전용 (현재 미파싱)
	PacketIDCarTelemetry2  PacketID = 16 // 2026 Season Pack 전용 (Active Aero / Overtake)
)

// MaxCars is the maximum number of cars in a session across supported formats.
// F1 25 packets carry 22 entries, the 2026 Season Pack carries 24 — arrays are
// sized for the larger format and 2025 packets leave indices 22-23 zeroed.
const MaxCars = 24

// PacketHeaderSize is the size of the packet header in bytes
const PacketHeaderSize = 29

// MaxPacketSize is the maximum expected UDP packet size
const MaxPacketSize = 2048

// Supported packetFormat values from the packet header.
const (
	PacketFormat2025 uint16 = 2025
	PacketFormat2026 uint16 = 2026
)

// FormatSpec captures the per-format wire layout facts that differ between
// F1 25 and the 2026 Season Pack. Only packets whose per-car struct changed
// need a size entry here; everything else just scales by NumCars.
type FormatSpec struct {
	NumCars          int // cars per array packet (22 / 24)
	CarMotionSize    int // 60 / 54 (2026: G-forces quantised to int16)
	CarTelemetrySize int // 60 / 59 (2026: engineTemperature uint16 → uint8)
	CarStatusSize    int // 55 / 59 (2026: +ersHarvestLimitPerLap float32)
	ParticipantSize  int // 57 / 60 (2026: driverId/networkId/teamId uint8 → uint16)
}

var formatSpecs = map[uint16]FormatSpec{
	PacketFormat2025: {NumCars: 22, CarMotionSize: 60, CarTelemetrySize: 60, CarStatusSize: 55, ParticipantSize: 57},
	PacketFormat2026: {NumCars: 24, CarMotionSize: 54, CarTelemetrySize: 59, CarStatusSize: 59, ParticipantSize: 60},
}

// SpecFor returns the layout spec for a packetFormat value.
func SpecFor(format uint16) (FormatSpec, bool) {
	spec, ok := formatSpecs[format]
	return spec, ok
}

// IsSupportedFormat reports whether the packetFormat is one we can parse.
func IsSupportedFormat(format uint16) bool {
	_, ok := formatSpecs[format]
	return ok
}
