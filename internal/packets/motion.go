package packets

import (
	"encoding/binary"
	"errors"
)

// CarMotionData represents motion data for a single car
// (wire size: 60 bytes in F1 25, 54 bytes in the 2026 Season Pack)
type CarMotionData struct {
	WorldPositionX     float32 // World X position (meters)
	WorldPositionY     float32 // World Y position (meters)
	WorldPositionZ     float32 // World Z position (meters)
	WorldVelocityX     float32 // Velocity X (meters/s)
	WorldVelocityY     float32 // Velocity Y (meters/s)
	WorldVelocityZ     float32 // Velocity Z (meters/s)
	WorldForwardDirX   int16   // Normalized * 32767
	WorldForwardDirY   int16
	WorldForwardDirZ   int16
	WorldRightDirX     int16   // Normalized * 32767
	WorldRightDirY     int16
	WorldRightDirZ     int16
	GForceLateral      float32 // G force lateral
	GForceLongitudinal float32 // G force longitudinal
	GForceVertical     float32 // G force vertical
	Yaw                float32 // Yaw angle (radians)
	Pitch              float32 // Pitch angle (radians)
	Roll               float32 // Roll angle (radians)
}

// CarMotionDataSize is the F1 25 wire size of a single CarMotionData in bytes.
// Use SpecFor(format).CarMotionSize for format-aware code.
const CarMotionDataSize = 60

// PacketMotionData is the full motion packet (Packet ID 0)
type PacketMotionData struct {
	Header        PacketHeader
	CarMotionData [MaxCars]CarMotionData
}

// ErrMotionPacketTooSmall is returned when motion packet is too small
var ErrMotionPacketTooSmall = errors.New("motion packet too small")

// ParseMotionPacket parses a motion packet from raw bytes
func ParseMotionPacket(data []byte, header *PacketHeader) (*PacketMotionData, error) {
	spec, ok := SpecFor(header.PacketFormat)
	if !ok {
		return nil, ErrMotionPacketTooSmall
	}
	is2026 := header.PacketFormat == PacketFormat2026

	expectedSize := PacketHeaderSize + (spec.CarMotionSize * spec.NumCars)
	if len(data) < expectedSize {
		return nil, ErrMotionPacketTooSmall
	}

	packet := &PacketMotionData{
		Header: *header,
	}

	offset := PacketHeaderSize
	for i := range spec.NumCars {
		packet.CarMotionData[i] = parseCarMotionData(data[offset:], is2026)
		offset += spec.CarMotionSize
	}

	return packet, nil
}

// gForceQuantScale converts the 2026 quantised int16 G-force values to float.
const gForceQuantScale = 1000.0

// parseCarMotionData parses a single car's motion data
func parseCarMotionData(data []byte, is2026 bool) CarMotionData {
	car := CarMotionData{}
	offset := 0

	car.WorldPositionX = readFloat32(data[offset:])
	offset += 4

	car.WorldPositionY = readFloat32(data[offset:])
	offset += 4

	car.WorldPositionZ = readFloat32(data[offset:])
	offset += 4

	car.WorldVelocityX = readFloat32(data[offset:])
	offset += 4

	car.WorldVelocityY = readFloat32(data[offset:])
	offset += 4

	car.WorldVelocityZ = readFloat32(data[offset:])
	offset += 4

	car.WorldForwardDirX = int16(binary.LittleEndian.Uint16(data[offset:]))
	offset += 2

	car.WorldForwardDirY = int16(binary.LittleEndian.Uint16(data[offset:]))
	offset += 2

	car.WorldForwardDirZ = int16(binary.LittleEndian.Uint16(data[offset:]))
	offset += 2

	car.WorldRightDirX = int16(binary.LittleEndian.Uint16(data[offset:]))
	offset += 2

	car.WorldRightDirY = int16(binary.LittleEndian.Uint16(data[offset:]))
	offset += 2

	car.WorldRightDirZ = int16(binary.LittleEndian.Uint16(data[offset:]))
	offset += 2

	if is2026 {
		// 2026 Season Pack: G-forces are quantised int16 (divide by 1000).
		car.GForceLateral = float32(int16(binary.LittleEndian.Uint16(data[offset:]))) / gForceQuantScale
		offset += 2
		car.GForceLongitudinal = float32(int16(binary.LittleEndian.Uint16(data[offset:]))) / gForceQuantScale
		offset += 2
		car.GForceVertical = float32(int16(binary.LittleEndian.Uint16(data[offset:]))) / gForceQuantScale
		offset += 2
	} else {
		car.GForceLateral = readFloat32(data[offset:])
		offset += 4
		car.GForceLongitudinal = readFloat32(data[offset:])
		offset += 4
		car.GForceVertical = readFloat32(data[offset:])
		offset += 4
	}

	car.Yaw = readFloat32(data[offset:])
	offset += 4

	car.Pitch = readFloat32(data[offset:])
	offset += 4

	car.Roll = readFloat32(data[offset:])

	return car
}
