package packets

import (
	"encoding/binary"
	"errors"
)

// CarTelemetry2Data carries the 2026-regulation car state for a single car
// (10 bytes). Sent only when the game runs the 2026 Season Pack UDP mode.
type CarTelemetry2Data struct {
	ActiveAeroMode               uint8  // 0 = corner mode (Z), 1 = straight mode (X)
	ActiveAeroAvailable          uint8  // 0 = unavailable, 1 = available
	ActiveAeroActivationDistance uint16 // Distance to activation zone in metres
	OvertakeAvailable            uint8  // 0 = unavailable, 1 = available (Manual Override)
	OvertakeActive               uint8  // 0 = inactive, 1 = active
	OvertakeActivationDistance   uint16 // Distance to activation zone in metres
	Regulations2026              uint8  // 0 = pre-2026 regulations car, 1 = 2026 regulations car
	DrivingWrongWay              uint8  // 0 = correct direction, 1 = wrong way
}

// CarTelemetry2DataSize is the wire size of a single CarTelemetry2Data in bytes.
const CarTelemetry2DataSize = 10

// PacketCarTelemetry2Data is the full Car Telemetry 2 packet (Packet ID 16,
// 269 bytes = 29 header + 24 * 10).
type PacketCarTelemetry2Data struct {
	Header            PacketHeader
	CarTelemetry2Data [MaxCars]CarTelemetry2Data
}

// ErrTelemetry2PacketTooSmall is returned when the packet is too small.
var ErrTelemetry2PacketTooSmall = errors.New("car telemetry 2 packet too small")

// ParseCarTelemetry2Packet parses a Car Telemetry 2 packet from raw bytes.
func ParseCarTelemetry2Packet(data []byte, header *PacketHeader) (*PacketCarTelemetry2Data, error) {
	spec, ok := SpecFor(header.PacketFormat)
	if !ok {
		return nil, ErrTelemetry2PacketTooSmall
	}

	expectedSize := PacketHeaderSize + (CarTelemetry2DataSize * spec.NumCars)
	if len(data) < expectedSize {
		return nil, ErrTelemetry2PacketTooSmall
	}

	packet := &PacketCarTelemetry2Data{
		Header: *header,
	}

	offset := PacketHeaderSize
	for i := range spec.NumCars {
		packet.CarTelemetry2Data[i] = parseCarTelemetry2Data(data[offset:])
		offset += CarTelemetry2DataSize
	}

	return packet, nil
}

func parseCarTelemetry2Data(data []byte) CarTelemetry2Data {
	return CarTelemetry2Data{
		ActiveAeroMode:               data[0],
		ActiveAeroAvailable:          data[1],
		ActiveAeroActivationDistance: binary.LittleEndian.Uint16(data[2:]),
		OvertakeAvailable:            data[4],
		OvertakeActive:               data[5],
		OvertakeActivationDistance:   binary.LittleEndian.Uint16(data[6:]),
		Regulations2026:              data[8],
		DrivingWrongWay:              data[9],
	}
}
