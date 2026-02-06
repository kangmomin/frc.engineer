package packets

import (
	"encoding/binary"
	"errors"
	"math"
)

// LapData represents lap data for a single car (57 bytes per F1 25 spec)
type LapData struct {
	LastLapTimeInMS            uint32  // Last lap time in milliseconds
	CurrentLapTimeInMS         uint32  // Current lap time in milliseconds
	Sector1TimeInMS            uint16  // Sector 1 time in milliseconds
	Sector1TimeMinutes         uint8   // Sector 1 time minutes part
	Sector2TimeInMS            uint16  // Sector 2 time in milliseconds
	Sector2TimeMinutes         uint8   // Sector 2 time minutes part
	DeltaToCarInFrontMSPart    uint16  // Delta to car in front ms part
	DeltaToCarInFrontMinutesPart uint8 // Delta to car in front minutes part
	DeltaToRaceLeaderMSPart    uint16  // Delta to race leader ms part
	DeltaToRaceLeaderMinutesPart uint8 // Delta to race leader minutes part
	LapDistance                float32 // Distance vehicle is around current lap in metres
	TotalDistance              float32 // Total distance travelled in session in metres
	SafetyCarDelta             float32 // Safety car delta in seconds
	CarPosition                uint8   // Current position
	CurrentLapNum              uint8   // Current lap number
	PitStatus                  uint8   // 0 = none, 1 = pitting, 2 = in pit area
	NumPitStops                uint8   // Number of pit stops taken
	Sector                     uint8   // 0 = sector1, 1 = sector2, 2 = sector3
	CurrentLapInvalid          uint8   // 0 = valid, 1 = invalid
	Penalties                  uint8   // Accumulated time penalties in seconds
	TotalWarnings              uint8   // Total number of warnings
	CornerCuttingWarnings      uint8   // Number of corner cutting warnings
	NumUnservedDriveThroughs   uint8   // Number of unserved drive through penalties
	NumUnservedStopGoPenalties uint8   // Number of unserved stop go penalties
	GridPosition               uint8   // Grid position
	DriverStatus               uint8   // Driver status
	ResultStatus               uint8   // Result status
	PitLaneTimerActive         uint8   // Pit lane timer active
	PitLaneTimeInLaneInMS      uint16  // Time spent in pit lane in milliseconds
	PitStopTimerInMS           uint16  // Time of pit stop in milliseconds
	PitStopShouldServePen      uint8   // Whether pit stop should serve penalty
	SpeedTrapFastestSpeed      float32 // Speed trap fastest speed for this car (km/h)
	SpeedTrapFastestLap        uint8   // Lap number of fastest speed trap (255 = not set)
}

// LapDataSize is the size of a single LapData in bytes
const LapDataSize = 57

// PacketLapData is the full lap data packet
type PacketLapData struct {
	Header              PacketHeader
	LapData             [MaxCars]LapData
	TimeTrialPBCarIdx   uint8 // Index of personal best car in time trial (255 if invalid)
	TimeTrialRivalCarIdx uint8 // Index of rival car in time trial (255 if invalid)
}

// ErrLapDataPacketTooSmall is returned when lap data packet is too small
var ErrLapDataPacketTooSmall = errors.New("lap data packet too small")

// ParseLapDataPacket parses a lap data packet from raw bytes
func ParseLapDataPacket(data []byte, header *PacketHeader) (*PacketLapData, error) {
	expectedSize := PacketHeaderSize + (LapDataSize * MaxCars) + 2
	if len(data) < expectedSize {
		return nil, ErrLapDataPacketTooSmall
	}

	packet := &PacketLapData{
		Header: *header,
	}

	offset := PacketHeaderSize
	for i := 0; i < MaxCars; i++ {
		lap := parseLapData(data[offset:])
		packet.LapData[i] = lap
		offset += LapDataSize
	}

	packet.TimeTrialPBCarIdx = data[offset]
	packet.TimeTrialRivalCarIdx = data[offset+1]

	return packet, nil
}

// parseLapData parses a single car's lap data
func parseLapData(data []byte) LapData {
	lap := LapData{}
	offset := 0

	lap.LastLapTimeInMS = binary.LittleEndian.Uint32(data[offset:])
	offset += 4

	lap.CurrentLapTimeInMS = binary.LittleEndian.Uint32(data[offset:])
	offset += 4

	lap.Sector1TimeInMS = binary.LittleEndian.Uint16(data[offset:])
	offset += 2

	lap.Sector1TimeMinutes = data[offset]
	offset++

	lap.Sector2TimeInMS = binary.LittleEndian.Uint16(data[offset:])
	offset += 2

	lap.Sector2TimeMinutes = data[offset]
	offset++

	lap.DeltaToCarInFrontMSPart = binary.LittleEndian.Uint16(data[offset:])
	offset += 2

	lap.DeltaToCarInFrontMinutesPart = data[offset]
	offset++

	lap.DeltaToRaceLeaderMSPart = binary.LittleEndian.Uint16(data[offset:])
	offset += 2

	lap.DeltaToRaceLeaderMinutesPart = data[offset]
	offset++

	lap.LapDistance = math.Float32frombits(binary.LittleEndian.Uint32(data[offset:]))
	offset += 4

	lap.TotalDistance = math.Float32frombits(binary.LittleEndian.Uint32(data[offset:]))
	offset += 4

	lap.SafetyCarDelta = math.Float32frombits(binary.LittleEndian.Uint32(data[offset:]))
	offset += 4

	lap.CarPosition = data[offset]
	offset++

	lap.CurrentLapNum = data[offset]
	offset++

	lap.PitStatus = data[offset]
	offset++

	lap.NumPitStops = data[offset]
	offset++

	lap.Sector = data[offset]
	offset++

	lap.CurrentLapInvalid = data[offset]
	offset++

	lap.Penalties = data[offset]
	offset++

	lap.TotalWarnings = data[offset]
	offset++

	lap.CornerCuttingWarnings = data[offset]
	offset++

	lap.NumUnservedDriveThroughs = data[offset]
	offset++

	lap.NumUnservedStopGoPenalties = data[offset]
	offset++

	lap.GridPosition = data[offset]
	offset++

	lap.DriverStatus = data[offset]
	offset++

	lap.ResultStatus = data[offset]
	offset++

	lap.PitLaneTimerActive = data[offset]
	offset++

	lap.PitLaneTimeInLaneInMS = binary.LittleEndian.Uint16(data[offset:])
	offset += 2

	lap.PitStopTimerInMS = binary.LittleEndian.Uint16(data[offset:])
	offset += 2

	lap.PitStopShouldServePen = data[offset]
	offset++

	lap.SpeedTrapFastestSpeed = math.Float32frombits(binary.LittleEndian.Uint32(data[offset:]))
	offset += 4

	lap.SpeedTrapFastestLap = data[offset]

	return lap
}
