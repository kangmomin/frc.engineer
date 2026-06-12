package packets

import (
	"encoding/binary"
	"errors"
	"fmt"
)

// MarshalZone represents a marshal zone on track
type MarshalZone struct {
	ZoneStart float32 // Fraction (0..1) of way through the lap the marshal zone starts
	ZoneFlag  int8    // -1=invalid, 0=none, 1=green, 2=blue, 3=yellow, 4=red
}

// WeatherForecastSample represents a single weather forecast entry
type WeatherForecastSample struct {
	SessionType            uint8 // Session type (same as PacketSessionData.SessionType)
	TimeOffset             uint8 // Minutes from now
	Weather                uint8 // 0=clear, 1=light cloud, 2=overcast, 3=light rain, 4=heavy rain, 5=storm
	TrackTemperature       int8  // Track temperature (celsius)
	TrackTemperatureChange int8  // -1=down, 0=same, 1=up
	AirTemperature         int8  // Air temperature (celsius)
	AirTemperatureChange   int8  // -1=down, 0=same, 1=up
	RainPercentage         uint8 // 0-100
}

// PacketSessionData represents a simplified F1 25 Session packet (Packet ID 1)
// We only parse the essential fields needed for the pitwall.
// The full packet is ~680 bytes, but we extract key fields at known offsets.
type PacketSessionData struct {
	Header                    PacketHeader
	Weather                   uint8  // 0=clear, 1=light cloud, 2=overcast, 3=light rain, 4=heavy rain, 5=storm
	TrackTemperature          int8   // Track temperature (celsius)
	AirTemperature            int8   // Air temperature (celsius)
	TotalLaps                 uint8  // Total laps in race
	TrackLength               uint16 // Track length (meters)
	SessionType               uint8  // 0=unknown, 1=P1, 2=P2, 3=P3, 4=Short P, 5=Q1, 6=Q2, 7=Q3, 8=Short Q, 9=OSQ, 10=R, 11=R2, 12=R3, 13=Time Trial
	TrackID                   int8   // -1=unknown. 항상 F1 25 canonical enum으로 정규화됨 (2026 wire 값은 파싱 시 변환)
	NumMarshalZones           uint8
	MarshalZones              [21]MarshalZone
	SafetyCarStatus           uint8 // 0=no safety car, 1=full, 2=virtual, 3=formation lap
	NumWeatherForecastSamples uint8
	WeatherForecastSamples    [64]WeatherForecastSample
	SessionTimeLeft           uint16 // Time left in session (seconds)
	SessionDuration           uint16 // Session duration (seconds)
	PitStopWindowIdealLap     uint8
	PitStopWindowLatestLap    uint8
	PitStopRejoinPosition     uint8
}

// Session packet field offsets (relative to start of packet)
const (
	sessionWeatherOffset                = PacketHeaderSize                 // 29
	sessionTrackTempOffset              = PacketHeaderSize + 1             // 30
	sessionAirTempOffset                = PacketHeaderSize + 2             // 31
	sessionTotalLapsOffset              = PacketHeaderSize + 3             // 32
	sessionTrackLengthOffset            = PacketHeaderSize + 4             // 33-34
	sessionTypeOffset                   = PacketHeaderSize + 6             // 35
	sessionTrackIDOffset                = PacketHeaderSize + 7             // 36
	sessionTimeLeftOffset               = PacketHeaderSize + 9             // 38-39
	sessionDurationOffset               = PacketHeaderSize + 11            // 40-41
	sessionNumMarshalZonesOffset        = PacketHeaderSize + 18            // 47
	sessionMarshalZonesOffset           = PacketHeaderSize + 19            // 48 (21 zones × 5 bytes each)
	marshalZoneSize                     = 5                                // float32 + int8
	sessionSafetyCarStatusOffset        = PacketHeaderSize + 19 + (21 * 5) // 153
	sessionNumForecastOffset            = PacketHeaderSize + 126           // 155
	sessionForecastOffset               = PacketHeaderSize + 127           // 156
	weatherForecastSampleSize           = 8
	sessionForecastAccuracyOffset       = sessionForecastOffset + (64 * weatherForecastSampleSize)
	sessionAIDifficultyOffset           = sessionForecastAccuracyOffset + 1
	sessionSeasonLinkIdentifierOffset   = sessionAIDifficultyOffset + 1
	sessionWeekendLinkIdentifierOffset  = sessionSeasonLinkIdentifierOffset + 4
	sessionSessionLinkIdentifierOffset  = sessionWeekendLinkIdentifierOffset + 4
	sessionPitStopWindowIdealLapOffset  = sessionSessionLinkIdentifierOffset + 4
	sessionPitStopWindowLatestLapOffset = sessionPitStopWindowIdealLapOffset + 1
	sessionPitStopRejoinPositionOffset  = sessionPitStopWindowLatestLapOffset + 1
)

// MinSessionPacketSize is the minimum size needed to parse essential session fields
// We need at least up to safetyCarStatus (offset 153 + 1 byte)
//
// 2026 Season Pack 참고: Session 패킷이 926바이트로 커졌지만 신규 필드
// (Active Aero zone 등)는 모두 패킷 말미에 추가됐다 — 우리가 읽는 앞부분
// 오프셋은 F1 25와 동일하다 (MacManley/f1-26-udp 필드 순서로 확인).
const MinSessionPacketSize = sessionSafetyCarStatusOffset + 1

// track2026ToCanonical maps the 2026 Season Pack track enum (the legacy full
// F1 enum, e.g. 9=Hungaroring/10=Spa, plus new 39-42 entries) onto the
// compacted F1 25 enum that the rest of the app (track store, lap storage,
// names) is keyed on. IDs absent from this table pass through unchanged.
var track2026ToCanonical = map[int8]int8{
	9:  8,  // Hungary
	10: 9,  // Belgium (Spa)
	11: 10, // Italy (Monza)
	12: 11, // Singapore
	13: 12, // Japan (Suzuka)
	14: 13, // UAE (Abu Dhabi)
	15: 14, // United States (Austin)
	26: 23, // Netherlands (Zandvoort)
	27: 24, // Italy (Imola)
	29: 25, // Saudi Arabia (Jeddah)
	30: 26, // United States (Miami)
	31: 28, // United States (Las Vegas)
	32: 27, // Qatar (Losail)
	// 39-42 (Reverse layouts, Madrid)는 충돌이 없어 그대로 통과한다.
}

// canonicalToWire2026 is the inverse of track2026ToCanonical, built once at init.
var canonicalToWire2026 = func() map[int8]int8 {
	inverse := make(map[int8]int8, len(track2026ToCanonical))
	for wire, canonical := range track2026ToCanonical {
		inverse[canonical] = wire
	}
	return inverse
}()

// CanonicalTrackID normalizes a wire trackId into the F1 25 canonical space.
func CanonicalTrackID(format uint16, id int8) int8 {
	if format != PacketFormat2026 {
		return id
	}
	if mapped, ok := track2026ToCanonical[id]; ok {
		return mapped
	}
	return id
}

// WireTrackID maps a canonical (F1 25) track id back onto the given format's
// wire enum — CanonicalTrackID의 역함수 (시뮬레이터/패킷 생성용).
func WireTrackID(format uint16, canonical int8) int8 {
	if format != PacketFormat2026 {
		return canonical
	}
	if wire, ok := canonicalToWire2026[canonical]; ok {
		return wire
	}
	return canonical
}

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
		TrackID:          CanonicalTrackID(header.PacketFormat, int8(data[sessionTrackIDOffset])),
		SessionTimeLeft:  binary.LittleEndian.Uint16(data[sessionTimeLeftOffset:]),
		SessionDuration:  binary.LittleEndian.Uint16(data[sessionDurationOffset:]),
		NumMarshalZones:  data[sessionNumMarshalZonesOffset],
		SafetyCarStatus:  data[sessionSafetyCarStatusOffset],
	}

	// DEBUG: dump raw bytes around sessionTimeLeft area (offsets 36-45)
	if packet.SessionTimeLeft == 0 && packet.SessionDuration == 0 && packet.SessionType >= 5 && packet.SessionType <= 14 {
		end := sessionDurationOffset + 6
		if end > len(data) {
			end = len(data)
		}
		fmt.Printf("[DEBUG] Session raw bytes [%d..%d]: % x  (type=%d)\n",
			sessionTrackIDOffset, end-1, data[sessionTrackIDOffset:end], packet.SessionType)
	}

	// Parse marshal zones
	numZones := int(packet.NumMarshalZones)
	if numZones > 21 {
		numZones = 21
	}
	for i := range numZones {
		off := sessionMarshalZonesOffset + i*marshalZoneSize
		packet.MarshalZones[i] = MarshalZone{
			ZoneStart: float32FromBytes(data[off : off+4]),
			ZoneFlag:  int8(data[off+4]),
		}
	}

	// Parse weather forecast samples (conditional — packet may be shorter)
	if len(data) > sessionNumForecastOffset {
		packet.NumWeatherForecastSamples = data[sessionNumForecastOffset]
		numSamples := int(packet.NumWeatherForecastSamples)
		if numSamples > 64 {
			numSamples = 64
		}
		for i := range numSamples {
			off := sessionForecastOffset + i*weatherForecastSampleSize
			if off+weatherForecastSampleSize > len(data) {
				break
			}
			packet.WeatherForecastSamples[i] = WeatherForecastSample{
				SessionType:            data[off],
				TimeOffset:             data[off+1],
				Weather:                data[off+2],
				TrackTemperature:       int8(data[off+3]),
				TrackTemperatureChange: int8(data[off+4]),
				AirTemperature:         int8(data[off+5]),
				AirTemperatureChange:   int8(data[off+6]),
				RainPercentage:         data[off+7],
			}
		}
	}

	if len(data) > sessionPitStopWindowIdealLapOffset {
		packet.PitStopWindowIdealLap = data[sessionPitStopWindowIdealLapOffset]
	}
	if len(data) > sessionPitStopWindowLatestLapOffset {
		packet.PitStopWindowLatestLap = data[sessionPitStopWindowLatestLapOffset]
	}
	if len(data) > sessionPitStopRejoinPositionOffset {
		packet.PitStopRejoinPosition = data[sessionPitStopRejoinPositionOffset]
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

// SessionType represents the type of session (F1 25)
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
	SessionSS1       SessionType = 10 // Sprint Shootout 1
	SessionSS2       SessionType = 11 // Sprint Shootout 2
	SessionSS3       SessionType = 12 // Sprint Shootout 3
	SessionShortSS   SessionType = 13 // Short Sprint Shootout
	SessionOSSS      SessionType = 14 // One-Shot Sprint Shootout
	SessionRace      SessionType = 15
	SessionRace2     SessionType = 16
	SessionRace3     SessionType = 17
	SessionTimeTrial SessionType = 18
)

// SafetyCarStatus represents the safety car status
type SafetyCarStatus uint8

const (
	SafetyCarNone      SafetyCarStatus = 0
	SafetyCarFull      SafetyCarStatus = 1
	SafetyCarVirtual   SafetyCarStatus = 2
	SafetyCarFormation SafetyCarStatus = 3
)
