package packets

import (
	"encoding/binary"
	"errors"
	"math"
)

// PacketHeader is the common header for all F1 25 UDP packets (29 bytes)
type PacketHeader struct {
	PacketFormat            uint16  // 2025
	GameYear                uint8   // 25
	GameMajorVersion        uint8
	GameMinorVersion        uint8
	PacketVersion           uint8
	PacketID                PacketID // Packet type identifier
	SessionUID              uint64
	SessionTime             float32
	FrameIdentifier         uint32
	OverallFrameIdentifier  uint32
	PlayerCarIndex          uint8 // Index of player's car (0-21)
	SecondaryPlayerCarIndex uint8 // Index of secondary player's car (255 if not present)
}

// ErrPacketTooSmall is returned when the packet is smaller than the header size
var ErrPacketTooSmall = errors.New("packet too small for header")

// ParseHeader parses the packet header from raw bytes
func ParseHeader(data []byte) (*PacketHeader, error) {
	if len(data) < PacketHeaderSize {
		return nil, ErrPacketTooSmall
	}

	h := &PacketHeader{
		PacketFormat:            binary.LittleEndian.Uint16(data[0:2]),
		GameYear:                data[2],
		GameMajorVersion:        data[3],
		GameMinorVersion:        data[4],
		PacketVersion:           data[5],
		PacketID:                PacketID(data[6]),
		SessionUID:              binary.LittleEndian.Uint64(data[7:15]),
		SessionTime:             float32FromBytes(data[15:19]),
		FrameIdentifier:         binary.LittleEndian.Uint32(data[19:23]),
		OverallFrameIdentifier:  binary.LittleEndian.Uint32(data[23:27]),
		PlayerCarIndex:          data[27],
		SecondaryPlayerCarIndex: data[28],
	}

	return h, nil
}

// float32FromBytes converts 4 bytes to float32 using little endian
func float32FromBytes(b []byte) float32 {
	bits := binary.LittleEndian.Uint32(b)
	return math.Float32frombits(bits)
}
