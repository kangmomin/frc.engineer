package packets

import (
	"encoding/binary"
	"errors"
	"math"
)

// CarStatusData represents status data for a single car (55 bytes)
type CarStatusData struct {
	TractionControl       uint8   // 0=off, 1=medium, 2=full
	AntiLockBrakes        uint8   // 0=off, 1=on
	FuelMix               uint8   // 0=lean, 1=standard, 2=rich, 3=max
	FrontBrakeBias        uint8   // Front brake bias percentage
	PitLimiterStatus      uint8   // 0=off, 1=on
	FuelInTank            float32 // Current fuel mass
	FuelCapacity          float32 // Fuel capacity
	FuelRemainingLaps     float32 // Fuel remaining in terms of laps
	MaxRPM                uint16  // Maximum RPM (divide by 10 for actual)
	IdleRPM               uint16  // Idle RPM (divide by 10 for actual)
	MaxGears              uint8   // Maximum gears
	DRSAllowed            uint8   // 0=not allowed, 1=allowed
	DRSActivationDistance uint16  // Distance to DRS activation zone in metres, 0=unknown
	ActualTyreCompound    uint8   // F1 Modern: 16=C5, 17=C4, 18=C3, 19=C2, 20=C1, 21=C0, 7=inter, 8=wet
	VisualTyreCompound    uint8   // F1 Visual: 16=soft, 17=medium, 18=hard, 7=inter, 8=wet
	TyresAgeLaps          uint8   // Age of tyres in laps
	VehicleFIAFlags       int8    // -1=invalid/unknown, 0=none, 1=green, 2=blue, 3=yellow
	EnginePowerICE        float32 // Engine power output in watts
	EnginePowerMGUK       float32 // MGU-K power output in watts
	ERSStoreEnergy        float32 // ERS energy store in joules
	ERSDeployMode         uint8   // 0=none, 1=medium, 2=hotlap, 3=overtake
	ERSHarvestedThisLapMGUK float32 // ERS harvested this lap by MGU-K
	ERSHarvestedThisLapMGUH float32 // ERS harvested this lap by MGU-H
	ERSDeployedThisLap    float32 // ERS deployed this lap
	NetworkPaused         uint8   // Whether car is paused in a network game
}

// CarStatusDataSize is the size of a single CarStatusData in bytes
const CarStatusDataSize = 55

// PacketCarStatusData is the full car status packet
type PacketCarStatusData struct {
	Header        PacketHeader
	CarStatusData [MaxCars]CarStatusData
}

// ErrCarStatusPacketTooSmall is returned when car status packet is too small
var ErrCarStatusPacketTooSmall = errors.New("car status packet too small")

// ParseCarStatusPacket parses a car status packet from raw bytes
func ParseCarStatusPacket(data []byte, header *PacketHeader) (*PacketCarStatusData, error) {
	expectedSize := PacketHeaderSize + (CarStatusDataSize * MaxCars)
	if len(data) < expectedSize {
		return nil, ErrCarStatusPacketTooSmall
	}

	packet := &PacketCarStatusData{
		Header: *header,
	}

	offset := PacketHeaderSize
	for i := range MaxCars {
		packet.CarStatusData[i] = parseCarStatusData(data[offset:])
		offset += CarStatusDataSize
	}

	return packet, nil
}

// parseCarStatusData parses a single car's status data
func parseCarStatusData(data []byte) CarStatusData {
	s := CarStatusData{}
	offset := 0

	s.TractionControl = data[offset]
	offset++

	s.AntiLockBrakes = data[offset]
	offset++

	s.FuelMix = data[offset]
	offset++

	s.FrontBrakeBias = data[offset]
	offset++

	s.PitLimiterStatus = data[offset]
	offset++

	s.FuelInTank = math.Float32frombits(binary.LittleEndian.Uint32(data[offset:]))
	offset += 4

	s.FuelCapacity = math.Float32frombits(binary.LittleEndian.Uint32(data[offset:]))
	offset += 4

	s.FuelRemainingLaps = math.Float32frombits(binary.LittleEndian.Uint32(data[offset:]))
	offset += 4

	s.MaxRPM = binary.LittleEndian.Uint16(data[offset:])
	offset += 2

	s.IdleRPM = binary.LittleEndian.Uint16(data[offset:])
	offset += 2

	s.MaxGears = data[offset]
	offset++

	s.DRSAllowed = data[offset]
	offset++

	s.DRSActivationDistance = binary.LittleEndian.Uint16(data[offset:])
	offset += 2

	s.ActualTyreCompound = data[offset]
	offset++

	s.VisualTyreCompound = data[offset]
	offset++

	s.TyresAgeLaps = data[offset]
	offset++

	s.VehicleFIAFlags = int8(data[offset])
	offset++

	s.EnginePowerICE = math.Float32frombits(binary.LittleEndian.Uint32(data[offset:]))
	offset += 4

	s.EnginePowerMGUK = math.Float32frombits(binary.LittleEndian.Uint32(data[offset:]))
	offset += 4

	s.ERSStoreEnergy = math.Float32frombits(binary.LittleEndian.Uint32(data[offset:]))
	offset += 4

	s.ERSDeployMode = data[offset]
	offset++

	s.ERSHarvestedThisLapMGUK = math.Float32frombits(binary.LittleEndian.Uint32(data[offset:]))
	offset += 4

	s.ERSHarvestedThisLapMGUH = math.Float32frombits(binary.LittleEndian.Uint32(data[offset:]))
	offset += 4

	s.ERSDeployedThisLap = math.Float32frombits(binary.LittleEndian.Uint32(data[offset:]))
	offset += 4

	s.NetworkPaused = data[offset]

	return s
}
