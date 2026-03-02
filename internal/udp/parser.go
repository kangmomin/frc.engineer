package udp

import (
	"log/slog"
	"sync/atomic"

	"frc.engineer/internal/packets"
)

// ParsedData represents parsed packet data for processing
type ParsedData struct {
	Header       *packets.PacketHeader
	Telemetry    *packets.PacketCarTelemetryData
	LapData      *packets.PacketLapData
	Motion       *packets.PacketMotionData
	MotionEx     *packets.PacketMotionExData
	Session      *packets.PacketSessionData
	Participants *packets.PacketParticipantsData
	CarStatus    *packets.PacketCarStatusData
	CarDamage    *packets.PacketCarDamageData
	CarSetups    *packets.PacketCarSetupData
	Event        *packets.PacketEventData
}

// Parser handles parsing of F1 25 UDP packets
type Parser struct {
	logger       *slog.Logger
	packetLogger atomic.Pointer[PacketLogger]
}

// NewParser creates a new packet parser
func NewParser(logger *slog.Logger) *Parser {
	return &Parser{
		logger: logger,
	}
}

// SetPacketLogger attaches (or detaches) a PacketLogger for recording packets to disk.
// Safe to call concurrently with Parse.
func (p *Parser) SetPacketLogger(pl *PacketLogger) {
	p.packetLogger.Store(pl)
}

// Parse parses a raw UDP packet and returns structured data
func (p *Parser) Parse(data []byte) (*ParsedData, error) {
	header, err := packets.ParseHeader(data)
	if err != nil {
		return nil, err
	}

	parsed := &ParsedData{
		Header: header,
	}

	packetName := packetIDName[header.PacketID]
	if packetName == "" {
		packetName = "unknown"
	}
	p.logger.Debug("packet received",
		"packetID", uint8(header.PacketID),
		"name", packetName,
		"size", len(data),
		"frame", header.FrameIdentifier,
		"sessionTime", header.SessionTime,
	)

	switch header.PacketID {
	case packets.PacketIDCarTelemetry:
		telemetry, err := packets.ParseCarTelemetryPacket(data, header)
		if err != nil {
			p.logger.Info("failed to parse telemetry packet", "error", err, "dataLen", len(data), "expectedSize", packets.PacketHeaderSize+(packets.CarTelemetryDataSize*packets.MaxCars)+3)
			return nil, err
		}
		parsed.Telemetry = telemetry

	case packets.PacketIDLapData:
		lapData, err := packets.ParseLapDataPacket(data, header)
		if err != nil {
			p.logger.Debug("failed to parse lap data packet", "error", err)
			return nil, err
		}
		parsed.LapData = lapData

	case packets.PacketIDMotion:
		motion, err := packets.ParseMotionPacket(data, header)
		if err != nil {
			p.logger.Debug("failed to parse motion packet", "error", err)
			return nil, err
		}
		parsed.Motion = motion

	case packets.PacketIDSession:
		session, err := packets.ParseSessionPacket(data, header)
		if err != nil {
			p.logger.Debug("failed to parse session packet", "error", err)
			return nil, err
		}
		parsed.Session = session

	case packets.PacketIDParticipants:
		participants, err := packets.ParseParticipantsPacket(data, header)
		if err != nil {
			p.logger.Debug("failed to parse participants packet", "error", err)
			return nil, err
		}
		parsed.Participants = participants

	case packets.PacketIDCarStatus:
		carStatus, err := packets.ParseCarStatusPacket(data, header)
		if err != nil {
			p.logger.Debug("failed to parse car status packet", "error", err)
			return nil, err
		}
		parsed.CarStatus = carStatus

	case packets.PacketIDCarSetups:
		carSetups, err := packets.ParseCarSetupPacket(data, header)
		if err != nil {
			p.logger.Debug("failed to parse car setup packet", "error", err)
			return nil, err
		}
		parsed.CarSetups = carSetups

	case packets.PacketIDCarDamage:
		carDamage, err := packets.ParseCarDamagePacket(data, header)
		if err != nil {
			p.logger.Debug("failed to parse car damage packet", "error", err)
			return nil, err
		}
		parsed.CarDamage = carDamage

	case packets.PacketIDMotionEx:
		motionEx, err := packets.ParseMotionExPacket(data, header)
		if err != nil {
			p.logger.Debug("failed to parse motion ex packet", "error", err)
			return nil, err
		}
		parsed.MotionEx = motionEx

	case packets.PacketIDEvent:
		event, err := packets.ParseEventPacket(data, header)
		if err != nil {
			p.logger.Debug("failed to parse event packet", "error", err)
			return nil, err
		}
		parsed.Event = event

	default:
		// 미처리 패킷: 로깅만 수행
		if pl := p.packetLogger.Load(); pl != nil {
			pl.Log(header, nil, data)
		}
		return nil, nil
	}

	if pl := p.packetLogger.Load(); pl != nil {
		pl.Log(header, parsed, data)
	}

	return parsed, nil
}

// GetPlayerTelemetry extracts the player's telemetry data from a parsed packet
func (p *Parser) GetPlayerTelemetry(parsed *ParsedData) *packets.CarTelemetryData {
	if parsed == nil || parsed.Telemetry == nil {
		return nil
	}

	idx := parsed.Header.PlayerCarIndex
	if int(idx) >= packets.MaxCars {
		return nil
	}

	return &parsed.Telemetry.CarTelemetryData[idx]
}

// GetPlayerLapData extracts the player's lap data from a parsed packet
func (p *Parser) GetPlayerLapData(parsed *ParsedData) *packets.LapData {
	if parsed == nil || parsed.LapData == nil {
		return nil
	}

	idx := parsed.Header.PlayerCarIndex
	if int(idx) >= packets.MaxCars {
		return nil
	}

	return &parsed.LapData.LapData[idx]
}
