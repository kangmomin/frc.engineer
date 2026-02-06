package packets

import (
	"bytes"
	"encoding/binary"
	"errors"
)

// LiveryColour represents an RGB colour for car livery (3 bytes)
type LiveryColour struct {
	Red   uint8
	Green uint8
	Blue  uint8
}

// ParticipantData represents data for a single participant (57 bytes per F1 25 spec)
type ParticipantData struct {
	AIControlled    uint8          // Whether controlled by AI (1) or human (0)
	DriverID        uint8          // Driver ID (255 = player)
	NetworkID       uint8          // Network ID (unique for network game)
	TeamID          uint8          // Team ID (0=Mercedes, 1=Ferrari, 2=Red Bull, etc.)
	MyTeam          uint8          // My team flag
	RaceNumber      uint8          // Race number
	Nationality     uint8          // Nationality ID
	Name            [32]byte       // UTF-8 name string (32 bytes per F1 25 spec)
	YourTelemetry   uint8          // Player's telemetry setting (0=restricted, 1=public)
	ShowOnlineNames uint8          // Show online names flag
	TechLevel       uint16         // F1 World tech level
	Platform        uint8          // Gaming platform
	NumColours      uint8          // Number of valid livery colours
	LiveryColours   [4]LiveryColour // Car livery colours (12 bytes)
}

// ParticipantDataSize is the size of a single ParticipantData in bytes
const ParticipantDataSize = 57

// PacketParticipantsData is the full participants packet
type PacketParticipantsData struct {
	Header        PacketHeader
	NumActiveCars uint8 // Number of active cars
	Participants  [MaxCars]ParticipantData
}

// ErrParticipantsPacketTooSmall is returned when participants packet is too small
var ErrParticipantsPacketTooSmall = errors.New("participants packet too small")

// ParseParticipantsPacket parses a participants packet from raw bytes
func ParseParticipantsPacket(data []byte, header *PacketHeader) (*PacketParticipantsData, error) {
	expectedSize := PacketHeaderSize + 1 + (ParticipantDataSize * MaxCars)
	if len(data) < expectedSize {
		return nil, ErrParticipantsPacketTooSmall
	}

	packet := &PacketParticipantsData{
		Header:        *header,
		NumActiveCars: data[PacketHeaderSize],
	}

	offset := PacketHeaderSize + 1
	for i := range MaxCars {
		packet.Participants[i] = parseParticipantData(data[offset:])
		offset += ParticipantDataSize
	}

	return packet, nil
}

// parseParticipantData parses a single participant's data
func parseParticipantData(data []byte) ParticipantData {
	p := ParticipantData{}
	offset := 0

	p.AIControlled = data[offset]
	offset++

	p.DriverID = data[offset]
	offset++

	p.NetworkID = data[offset]
	offset++

	p.TeamID = data[offset]
	offset++

	p.MyTeam = data[offset]
	offset++

	p.RaceNumber = data[offset]
	offset++

	p.Nationality = data[offset]
	offset++

	copy(p.Name[:], data[offset:offset+32])
	offset += 32

	p.YourTelemetry = data[offset]
	offset++

	p.ShowOnlineNames = data[offset]
	offset++

	p.TechLevel = binary.LittleEndian.Uint16(data[offset:])
	offset += 2

	p.Platform = data[offset]
	offset++

	p.NumColours = data[offset]
	offset++

	for i := range 4 {
		p.LiveryColours[i] = LiveryColour{
			Red:   data[offset],
			Green: data[offset+1],
			Blue:  data[offset+2],
		}
		offset += 3
	}

	return p
}

// GetName returns the participant's name as a trimmed string
func (p *ParticipantData) GetName() string {
	// Trim null bytes and whitespace
	n := bytes.IndexByte(p.Name[:], 0)
	if n == -1 {
		n = len(p.Name)
	}
	return string(bytes.TrimSpace(p.Name[:n]))
}
