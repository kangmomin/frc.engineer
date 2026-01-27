package packets

import (
	"encoding/binary"
	"errors"
	"math"
)

// CarTelemetryData represents telemetry data for a single car (~60 bytes)
type CarTelemetryData struct {
	Speed                   uint16     // Speed in km/h
	Throttle                float32    // 0.0 to 1.0
	Steer                   float32    // -1.0 (full left) to 1.0 (full right)
	Brake                   float32    // 0.0 to 1.0
	Clutch                  uint8      // 0 to 100
	Gear                    int8       // -1 = reverse, 0 = neutral, 1-8 = forward gears
	EngineRPM               uint16     // Engine RPM
	DRS                     uint8      // 0 = off, 1 = on
	RevLightsPercent        uint8      // Rev lights indicator (0-100)
	RevLightsBitValue       uint16     // Rev lights bit value
	BrakesTemperature       [4]uint16  // Brakes temperature (celsius) - RL, RR, FL, FR
	TyresSurfaceTemperature [4]uint8   // Tyres surface temperature (celsius)
	TyresInnerTemperature   [4]uint8   // Tyres inner temperature (celsius)
	EngineTemperature       uint16     // Engine temperature (celsius)
	TyresPressure           [4]float32 // Tyres pressure (PSI)
	SurfaceType             [4]uint8   // Driving surface type per wheel
}

// CarTelemetryDataSize is the size of a single CarTelemetryData in bytes
const CarTelemetryDataSize = 60

// PacketCarTelemetryData is the full telemetry packet
type PacketCarTelemetryData struct {
	Header                       PacketHeader
	CarTelemetryData             [MaxCars]CarTelemetryData
	MFDPanelIndex                uint8  // Index of MFD panel open
	MFDPanelIndexSecondaryPlayer uint8
	SuggestedGear                int8 // Suggested gear for player (-1 = none)
}

// ErrTelemetryPacketTooSmall is returned when telemetry packet is too small
var ErrTelemetryPacketTooSmall = errors.New("telemetry packet too small")

// ParseCarTelemetryPacket parses a car telemetry packet from raw bytes
func ParseCarTelemetryPacket(data []byte, header *PacketHeader) (*PacketCarTelemetryData, error) {
	expectedSize := PacketHeaderSize + (CarTelemetryDataSize * MaxCars) + 3
	if len(data) < expectedSize {
		return nil, ErrTelemetryPacketTooSmall
	}

	packet := &PacketCarTelemetryData{
		Header: *header,
	}

	offset := PacketHeaderSize
	for i := 0; i < MaxCars; i++ {
		car := parseCarTelemetryData(data[offset:])
		packet.CarTelemetryData[i] = car
		offset += CarTelemetryDataSize
	}

	packet.MFDPanelIndex = data[offset]
	packet.MFDPanelIndexSecondaryPlayer = data[offset+1]
	packet.SuggestedGear = int8(data[offset+2])

	return packet, nil
}

// parseCarTelemetryData parses a single car's telemetry data
func parseCarTelemetryData(data []byte) CarTelemetryData {
	car := CarTelemetryData{}
	offset := 0

	car.Speed = binary.LittleEndian.Uint16(data[offset:])
	offset += 2

	car.Throttle = readFloat32(data[offset:])
	offset += 4

	car.Steer = readFloat32(data[offset:])
	offset += 4

	car.Brake = readFloat32(data[offset:])
	offset += 4

	car.Clutch = data[offset]
	offset++

	car.Gear = int8(data[offset])
	offset++

	car.EngineRPM = binary.LittleEndian.Uint16(data[offset:])
	offset += 2

	car.DRS = data[offset]
	offset++

	car.RevLightsPercent = data[offset]
	offset++

	car.RevLightsBitValue = binary.LittleEndian.Uint16(data[offset:])
	offset += 2

	// Brakes temperature (4 x uint16)
	for i := 0; i < 4; i++ {
		car.BrakesTemperature[i] = binary.LittleEndian.Uint16(data[offset:])
		offset += 2
	}

	// Tyres surface temperature (4 x uint8)
	for i := 0; i < 4; i++ {
		car.TyresSurfaceTemperature[i] = data[offset]
		offset++
	}

	// Tyres inner temperature (4 x uint8)
	for i := 0; i < 4; i++ {
		car.TyresInnerTemperature[i] = data[offset]
		offset++
	}

	car.EngineTemperature = binary.LittleEndian.Uint16(data[offset:])
	offset += 2

	// Tyres pressure (4 x float32)
	for i := 0; i < 4; i++ {
		car.TyresPressure[i] = readFloat32(data[offset:])
		offset += 4
	}

	// Surface type (4 x uint8)
	for i := 0; i < 4; i++ {
		car.SurfaceType[i] = data[offset]
		offset++
	}

	return car
}

// readFloat32 reads a float32 from bytes using little endian
func readFloat32(b []byte) float32 {
	bits := binary.LittleEndian.Uint32(b)
	return math.Float32frombits(bits)
}
