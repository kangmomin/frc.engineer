package packets

import (
	"encoding/binary"
	"errors"
	"math"
)

// CarSetupData represents setup data for a single car (50 bytes)
type CarSetupData struct {
	FrontWing             uint8
	RearWing              uint8
	OnThrottle            uint8   // Differential adjustment on throttle (percentage)
	OffThrottle           uint8   // Differential adjustment off throttle (percentage)
	FrontCamber           float32
	RearCamber            float32
	FrontToe              float32
	RearToe               float32
	FrontSuspension       uint8
	RearSuspension        uint8
	FrontAntiRollBar      uint8
	RearAntiRollBar       uint8
	FrontSuspensionHeight uint8
	RearSuspensionHeight  uint8
	BrakePressure         uint8
	BrakeBias             uint8 // Brake bias (percentage)
	EngineBraking         uint8
	RearLeftTyrePressure  float32
	RearRightTyrePressure float32
	FrontLeftTyrePressure float32
	FrontRightTyrePressure float32
	Ballast               uint8
	FuelLoad              float32
}

// CarSetupDataSize is the size of a single CarSetupData in bytes
const CarSetupDataSize = 50

// PacketCarSetupData is the full car setups packet
type PacketCarSetupData struct {
	Header            PacketHeader
	CarSetupData      [MaxCars]CarSetupData
	NextFrontWingValue float32
}

// ErrCarSetupPacketTooSmall is returned when car setup packet is too small
var ErrCarSetupPacketTooSmall = errors.New("car setup packet too small")

// ParseCarSetupPacket parses a car setup packet from raw bytes
func ParseCarSetupPacket(data []byte, header *PacketHeader) (*PacketCarSetupData, error) {
	expectedSize := PacketHeaderSize + (CarSetupDataSize * MaxCars) + 4
	if len(data) < expectedSize {
		return nil, ErrCarSetupPacketTooSmall
	}

	packet := &PacketCarSetupData{
		Header: *header,
	}

	offset := PacketHeaderSize
	for i := range MaxCars {
		packet.CarSetupData[i] = parseCarSetupData(data[offset:])
		offset += CarSetupDataSize
	}

	packet.NextFrontWingValue = math.Float32frombits(binary.LittleEndian.Uint32(data[offset:]))

	return packet, nil
}

// parseCarSetupData parses a single car's setup data
func parseCarSetupData(data []byte) CarSetupData {
	s := CarSetupData{}
	offset := 0

	s.FrontWing = data[offset]
	offset++

	s.RearWing = data[offset]
	offset++

	s.OnThrottle = data[offset]
	offset++

	s.OffThrottle = data[offset]
	offset++

	s.FrontCamber = math.Float32frombits(binary.LittleEndian.Uint32(data[offset:]))
	offset += 4

	s.RearCamber = math.Float32frombits(binary.LittleEndian.Uint32(data[offset:]))
	offset += 4

	s.FrontToe = math.Float32frombits(binary.LittleEndian.Uint32(data[offset:]))
	offset += 4

	s.RearToe = math.Float32frombits(binary.LittleEndian.Uint32(data[offset:]))
	offset += 4

	s.FrontSuspension = data[offset]
	offset++

	s.RearSuspension = data[offset]
	offset++

	s.FrontAntiRollBar = data[offset]
	offset++

	s.RearAntiRollBar = data[offset]
	offset++

	s.FrontSuspensionHeight = data[offset]
	offset++

	s.RearSuspensionHeight = data[offset]
	offset++

	s.BrakePressure = data[offset]
	offset++

	s.BrakeBias = data[offset]
	offset++

	s.EngineBraking = data[offset]
	offset++

	s.RearLeftTyrePressure = math.Float32frombits(binary.LittleEndian.Uint32(data[offset:]))
	offset += 4

	s.RearRightTyrePressure = math.Float32frombits(binary.LittleEndian.Uint32(data[offset:]))
	offset += 4

	s.FrontLeftTyrePressure = math.Float32frombits(binary.LittleEndian.Uint32(data[offset:]))
	offset += 4

	s.FrontRightTyrePressure = math.Float32frombits(binary.LittleEndian.Uint32(data[offset:]))
	offset += 4

	s.Ballast = data[offset]
	offset++

	s.FuelLoad = math.Float32frombits(binary.LittleEndian.Uint32(data[offset:]))

	return s
}
