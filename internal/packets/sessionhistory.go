package packets

import (
	"encoding/binary"
	"errors"
)

const (
	MaxNumLapsInHistory  = 100
	MaxTyreStints        = 8
	LapHistoryDataSize   = 14 // uint32 + uint16 + uint8 + uint16 + uint8 + uint16 + uint8 + uint8
	TyreStintHistorySize = 3  // uint8 × 3
)

// LapHistoryData contains timing data for a single lap
type LapHistoryData struct {
	LapTimeInMS        uint32
	Sector1TimeMSPart  uint16
	Sector1TimeMinPart uint8
	Sector2TimeMSPart  uint16
	Sector2TimeMinPart uint8
	Sector3TimeMSPart  uint16
	Sector3TimeMinPart uint8
	LapValidBitFlags   uint8 // 0x01=lap, 0x02=S1, 0x04=S2, 0x08=S3
}

// Sector1Ms returns full sector 1 time in milliseconds
func (l *LapHistoryData) Sector1Ms() int {
	return int(l.Sector1TimeMinPart)*60000 + int(l.Sector1TimeMSPart)
}

// Sector2Ms returns full sector 2 time in milliseconds
func (l *LapHistoryData) Sector2Ms() int {
	return int(l.Sector2TimeMinPart)*60000 + int(l.Sector2TimeMSPart)
}

// Sector3Ms returns full sector 3 time in milliseconds
func (l *LapHistoryData) Sector3Ms() int {
	return int(l.Sector3TimeMinPart)*60000 + int(l.Sector3TimeMSPart)
}

// PacketSessionHistoryData contains session history for a single car
type PacketSessionHistoryData struct {
	Header            PacketHeader
	CarIdx            uint8
	NumLaps           uint8
	NumTyreStints     uint8
	BestLapTimeLapNum uint8
	BestSector1LapNum uint8
	BestSector2LapNum uint8
	BestSector3LapNum uint8
	LapHistoryData    [MaxNumLapsInHistory]LapHistoryData
}

func (p *PacketSessionHistoryData) validBest(lapNum uint8, flag uint8) *LapHistoryData {
	if p == nil || lapNum == 0 || lapNum > p.NumLaps || int(lapNum) > len(p.LapHistoryData) {
		return nil
	}
	lap := &p.LapHistoryData[lapNum-1]
	if lap.LapValidBitFlags&flag == 0 {
		return nil
	}
	return lap
}

// BestLapMS returns the official valid best, or zero when none is available.
func (p *PacketSessionHistoryData) BestLapMS() uint32 {
	if p == nil {
		return 0
	}
	if lap := p.validBest(p.BestLapTimeLapNum, 1); lap != nil {
		return lap.LapTimeInMS
	}
	return 0
}

// BestSectorMS uses the independent sector-valid bit, not whole-lap validity.
func (p *PacketSessionHistoryData) BestSectorMS(sector int) *int {
	if p == nil || sector < 1 || sector > 3 {
		return nil
	}
	lapNum := [...]uint8{p.BestSector1LapNum, p.BestSector2LapNum, p.BestSector3LapNum}[sector-1]
	lap := p.validBest(lapNum, 1<<sector)
	if lap == nil {
		return nil
	}
	value := [...]int{lap.Sector1Ms(), lap.Sector2Ms(), lap.Sector3Ms()}[sector-1]
	if value <= 0 {
		return nil
	}
	return &value
}

// ErrSessionHistoryPacketTooSmall is returned when session history packet is too small
var ErrSessionHistoryPacketTooSmall = errors.New("session history packet too small")

// ParseSessionHistoryPacket parses a session history packet from raw bytes
func ParseSessionHistoryPacket(data []byte, header *PacketHeader) (*PacketSessionHistoryData, error) {
	// header + 7 meta bytes + 100×14 lap data + 8×3 tyre stints = header + 1431
	expectedSize := PacketHeaderSize + 7 + (LapHistoryDataSize * MaxNumLapsInHistory) + (TyreStintHistorySize * MaxTyreStints)
	if len(data) < expectedSize {
		return nil, ErrSessionHistoryPacketTooSmall
	}

	packet := &PacketSessionHistoryData{
		Header: *header,
	}

	offset := PacketHeaderSize
	packet.CarIdx = data[offset]
	offset++
	packet.NumLaps = data[offset]
	offset++
	packet.NumTyreStints = data[offset]
	offset++
	packet.BestLapTimeLapNum = data[offset]
	offset++
	packet.BestSector1LapNum = data[offset]
	offset++
	packet.BestSector2LapNum = data[offset]
	offset++
	packet.BestSector3LapNum = data[offset]
	offset++

	for i := range MaxNumLapsInHistory {
		packet.LapHistoryData[i] = parseLapHistoryData(data[offset:])
		offset += LapHistoryDataSize
	}

	return packet, nil
}

func parseLapHistoryData(data []byte) LapHistoryData {
	return LapHistoryData{
		LapTimeInMS:        binary.LittleEndian.Uint32(data[0:]),
		Sector1TimeMSPart:  binary.LittleEndian.Uint16(data[4:]),
		Sector1TimeMinPart: data[6],
		Sector2TimeMSPart:  binary.LittleEndian.Uint16(data[7:]),
		Sector2TimeMinPart: data[9],
		Sector3TimeMSPart:  binary.LittleEndian.Uint16(data[10:]),
		Sector3TimeMinPart: data[12],
		LapValidBitFlags:   data[13],
	}
}
