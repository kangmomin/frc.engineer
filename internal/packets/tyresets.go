package packets

import (
	"encoding/binary"
	"errors"
)

// MaxNumTyreSets is 13 slick + 7 wet weather sets
const MaxNumTyreSets = 20

// TyreSetDataSize is the size of a single TyreSetData in bytes
// 7×uint8(7) + 1×int16(2) + 1×uint8(1) = 10 bytes
const TyreSetDataSize = 10

// TyreSetData represents data about one tyre set
type TyreSetData struct {
	ActualTyreCompound uint8 // Actual tyre compound used
	VisualTyreCompound uint8 // Visual tyre compound used
	Wear               uint8 // Tyre wear (percentage)
	Available          uint8 // Whether this set is currently available
	RecommendedSession uint8 // Recommended session for tyre set
	LifeSpan           uint8 // Laps left in this tyre set
	UsableLife         uint8 // Max number of laps recommended for this compound
	LapDeltaTime       int16 // Lap delta time in milliseconds compared to fitted set
	Fitted             uint8 // Whether the set is fitted or not
}

// PacketTyreSetsData contains extended tyre set data for a single car
type PacketTyreSetsData struct {
	Header      PacketHeader
	CarIdx      uint8
	TyreSetData [MaxNumTyreSets]TyreSetData
	FittedIdx   uint8
}

// ErrTyreSetsPacketTooSmall is returned when tyre sets packet is too small
var ErrTyreSetsPacketTooSmall = errors.New("tyre sets packet too small")

// ParseTyreSetsPacket parses a tyre sets packet from raw bytes
func ParseTyreSetsPacket(data []byte, header *PacketHeader) (*PacketTyreSetsData, error) {
	// header + carIdx(1) + 20×TyreSetData(200) + fittedIdx(1) = header + 202
	expectedSize := PacketHeaderSize + 1 + (TyreSetDataSize * MaxNumTyreSets) + 1
	if len(data) < expectedSize {
		return nil, ErrTyreSetsPacketTooSmall
	}

	packet := &PacketTyreSetsData{
		Header: *header,
	}

	offset := PacketHeaderSize
	packet.CarIdx = data[offset]
	offset++

	for i := range MaxNumTyreSets {
		packet.TyreSetData[i] = parseTyreSetData(data[offset:])
		offset += TyreSetDataSize
	}

	packet.FittedIdx = data[offset]

	return packet, nil
}

func parseTyreSetData(data []byte) TyreSetData {
	return TyreSetData{
		ActualTyreCompound: data[0],
		VisualTyreCompound: data[1],
		Wear:               data[2],
		Available:          data[3],
		RecommendedSession: data[4],
		LifeSpan:           data[5],
		UsableLife:         data[6],
		LapDeltaTime:       int16(binary.LittleEndian.Uint16(data[7:])),
		Fitted:             data[9],
	}
}
