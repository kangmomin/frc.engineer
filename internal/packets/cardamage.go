package packets

import (
	"encoding/binary"
	"errors"
	"math"
)

// CarDamageData represents damage data for a single car (42 bytes per F1 25 spec)
type CarDamageData struct {
	TyresWear             [4]float32 // RL, RR, FL, FR
	TyresDamage           [4]uint8   // RL, RR, FL, FR
	BrakesDamage          [4]uint8   // RL, RR, FL, FR
	FrontLeftWingDamage   uint8
	FrontRightWingDamage  uint8
	RearWingDamage        uint8
	FloorDamage           uint8
	DiffuserDamage        uint8
	SidepodDamage         uint8
	DRSFault              uint8 // 0=OK, 1=fault
	ERSFault              uint8 // 0=OK, 1=fault
	GearBoxDamage         uint8
	EngineDamage          uint8
	EngineMGUHWear        uint8
	EngineESWear          uint8
	EngineCEWear          uint8
	EngineICEWear         uint8
	EngineMGUKWear        uint8
	EngineTCWear          uint8
}

// CarDamageDataSize is the size of a single CarDamageData in bytes
// 4×float32(16) + 4×uint8(4) + 4×uint8(4) + 16×uint8(16) = 40 bytes
const CarDamageDataSize = 40

// PacketCarDamageData is the full car damage packet
type PacketCarDamageData struct {
	Header        PacketHeader
	CarDamageData [MaxCars]CarDamageData
}

// ErrCarDamagePacketTooSmall is returned when car damage packet is too small
var ErrCarDamagePacketTooSmall = errors.New("car damage packet too small")

// ParseCarDamagePacket parses a car damage packet from raw bytes
func ParseCarDamagePacket(data []byte, header *PacketHeader) (*PacketCarDamageData, error) {
	expectedSize := PacketHeaderSize + (CarDamageDataSize * MaxCars)
	if len(data) < expectedSize {
		return nil, ErrCarDamagePacketTooSmall
	}

	packet := &PacketCarDamageData{
		Header: *header,
	}

	offset := PacketHeaderSize
	for i := range MaxCars {
		packet.CarDamageData[i] = parseCarDamageData(data[offset:])
		offset += CarDamageDataSize
	}

	return packet, nil
}

func parseCarDamageData(data []byte) CarDamageData {
	d := CarDamageData{}
	offset := 0

	// Tyres wear (4 x float32) - RL, RR, FL, FR
	for i := range 4 {
		d.TyresWear[i] = math.Float32frombits(binary.LittleEndian.Uint32(data[offset:]))
		offset += 4
	}

	// Tyres damage (4 x uint8)
	for i := range 4 {
		d.TyresDamage[i] = data[offset]
		offset++
	}

	// Brakes damage (4 x uint8)
	for i := range 4 {
		d.BrakesDamage[i] = data[offset]
		offset++
	}

	d.FrontLeftWingDamage = data[offset]
	offset++
	d.FrontRightWingDamage = data[offset]
	offset++
	d.RearWingDamage = data[offset]
	offset++
	d.FloorDamage = data[offset]
	offset++
	d.DiffuserDamage = data[offset]
	offset++
	d.SidepodDamage = data[offset]
	offset++
	d.DRSFault = data[offset]
	offset++
	d.ERSFault = data[offset]
	offset++
	d.GearBoxDamage = data[offset]
	offset++
	d.EngineDamage = data[offset]
	offset++
	d.EngineMGUHWear = data[offset]
	offset++
	d.EngineESWear = data[offset]
	offset++
	d.EngineCEWear = data[offset]
	offset++
	d.EngineICEWear = data[offset]
	offset++
	d.EngineMGUKWear = data[offset]
	offset++
	d.EngineTCWear = data[offset]

	return d
}
