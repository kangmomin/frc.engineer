package packets

import (
	"encoding/binary"
	"errors"
)

// CarMotionData represents motion data for a single car (60 bytes)
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

// CarMotionDataSize is the size of a single CarMotionData in bytes
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
	expectedSize := PacketHeaderSize + (CarMotionDataSize * MaxCars)
	if len(data) < expectedSize {
		return nil, ErrMotionPacketTooSmall
	}

	packet := &PacketMotionData{
		Header: *header,
	}

	offset := PacketHeaderSize
	for i := range MaxCars {
		packet.CarMotionData[i] = parseCarMotionData(data[offset:])
		offset += CarMotionDataSize
	}

	return packet, nil
}

// parseCarMotionData parses a single car's motion data
func parseCarMotionData(data []byte) CarMotionData {
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

	car.GForceLateral = readFloat32(data[offset:])
	offset += 4

	car.GForceLongitudinal = readFloat32(data[offset:])
	offset += 4

	car.GForceVertical = readFloat32(data[offset:])
	offset += 4

	car.Yaw = readFloat32(data[offset:])
	offset += 4

	car.Pitch = readFloat32(data[offset:])
	offset += 4

	car.Roll = readFloat32(data[offset:])

	return car
}
