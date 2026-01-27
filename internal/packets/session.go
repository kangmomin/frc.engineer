package packets

import (
	"encoding/binary"
	"errors"
)

// PacketSessionData represents a simplified F1 25 Session packet (Packet ID 1)
// We only parse the essential fields needed for the pitwall.
// The full packet is ~680 bytes, but we extract key fields at known offsets.
type PacketSessionData struct {
	Header           PacketHeader
	Weather          uint8  // 0=clear, 1=light cloud, 2=overcast, 3=light rain, 4=heavy rain, 5=storm
	TrackTemperature int8   // Track temperature (celsius)
	AirTemperature   int8   // Air temperature (celsius)
	TotalLaps        uint8  // Total laps in race
	TrackLength      uint16 // Track length (meters)
	SessionType      uint8  // 0=unknown, 1=P1, 2=P2, 3=P3, 4=Short P, 5=Q1, 6=Q2, 7=Q3, 8=Short Q, 9=OSQ, 10=R, 11=R2, 12=R3, 13=Time Trial
	TrackID          int8   // -1=unknown, 0-29=track IDs
	SafetyCarStatus  uint8  // 0=no safety car, 1=full, 2=virtual, 3=formation lap
}

// Session packet field offsets (relative to start of packet)
const (
	sessionWeatherOffset          = PacketHeaderSize      // 29
	sessionTrackTempOffset        = PacketHeaderSize + 1  // 30
	sessionAirTempOffset          = PacketHeaderSize + 2  // 31
	sessionTotalLapsOffset        = PacketHeaderSize + 3  // 32
	sessionTrackLengthOffset      = PacketHeaderSize + 4  // 33-34
	sessionTypeOffset             = PacketHeaderSize + 6  // 35
	sessionTrackIDOffset          = PacketHeaderSize + 7  // 36
	sessionSafetyCarStatusOffset  = PacketHeaderSize + 19 + (21 * 5) // 153
)

// MinSessionPacketSize is the minimum size needed to parse essential session fields
// We need at least up to safetyCarStatus (offset 153 + 1 byte)
const MinSessionPacketSize = sessionSafetyCarStatusOffset + 1

// ErrSessionPacketTooSmall is returned when session packet is too small
var ErrSessionPacketTooSmall = errors.New("session packet too small")

// ParseSessionPacket parses a session packet from raw bytes.
// It extracts only the essential fields needed for the pitwall.
func ParseSessionPacket(data []byte, header *PacketHeader) (*PacketSessionData, error) {
	if len(data) < MinSessionPacketSize {
		return nil, ErrSessionPacketTooSmall
	}

	packet := &PacketSessionData{
		Header:           *header,
		Weather:          data[sessionWeatherOffset],
		TrackTemperature: int8(data[sessionTrackTempOffset]),
		AirTemperature:   int8(data[sessionAirTempOffset]),
		TotalLaps:        data[sessionTotalLapsOffset],
		TrackLength:      binary.LittleEndian.Uint16(data[sessionTrackLengthOffset:]),
		SessionType:      data[sessionTypeOffset],
		TrackID:          int8(data[sessionTrackIDOffset]),
		SafetyCarStatus:  data[sessionSafetyCarStatusOffset],
	}

	return packet, nil
}

// WeatherType represents weather conditions
type WeatherType uint8

const (
	WeatherClear      WeatherType = 0
	WeatherLightCloud WeatherType = 1
	WeatherOvercast   WeatherType = 2
	WeatherLightRain  WeatherType = 3
	WeatherHeavyRain  WeatherType = 4
	WeatherStorm      WeatherType = 5
)

// SessionType represents the type of session
type SessionType uint8

const (
	SessionUnknown   SessionType = 0
	SessionP1        SessionType = 1
	SessionP2        SessionType = 2
	SessionP3        SessionType = 3
	SessionShortP    SessionType = 4
	SessionQ1        SessionType = 5
	SessionQ2        SessionType = 6
	SessionQ3        SessionType = 7
	SessionShortQ    SessionType = 8
	SessionOSQ       SessionType = 9
	SessionRace      SessionType = 10
	SessionRace2     SessionType = 11
	SessionRace3     SessionType = 12
	SessionTimeTrial SessionType = 13
)

// SafetyCarStatus represents the safety car status
type SafetyCarStatus uint8

const (
	SafetyCarNone      SafetyCarStatus = 0
	SafetyCarFull      SafetyCarStatus = 1
	SafetyCarVirtual   SafetyCarStatus = 2
	SafetyCarFormation SafetyCarStatus = 3
)
