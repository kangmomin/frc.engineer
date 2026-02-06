package packets

import (
	"errors"
	"fmt"
)

// Event string codes (4 bytes each)
const (
	EventSessionStarted    = "SSTA"
	EventSessionEnded      = "SEND"
	EventFastestLap        = "FTLP"
	EventRetirement        = "RTMT"
	EventDRSEnabled        = "DRSE"
	EventDRSDisabled       = "DRSD"
	EventTeamMateInPits    = "TMPT"
	EventChequeredFlag     = "CHQF"
	EventRaceWinner        = "RCWN"
	EventPenalty           = "PENA"
	EventSpeedTrap         = "SPTP"
	EventStartLights       = "STLG"
	EventLightsOut         = "LGOT"
	EventDriveThroughServed = "DTSV"
	EventStopGoServed      = "SGSV"
	EventFlashback         = "FLBK"
	EventButtonStatus      = "BUTN"
	EventOvertake          = "OVTK"
	EventSafetyCarStatus   = "SCAR"
	EventCollision         = "COLL"
	EventRedFlag           = "RDFL"
)

// PacketEventData represents the event packet (Packet ID 3)
type PacketEventData struct {
	Header          PacketHeader
	EventStringCode string // 4-char event code
	EventDetails    EventDetails
}

// EventDetails is a union type for event-specific data
type EventDetails interface {
	eventDetails()
}

// PenaltyEvent contains penalty/warning details
type PenaltyEvent struct {
	PenaltyType      uint8
	InfringementType uint8
	VehicleIdx       uint8
	OtherVehicleIdx  uint8
	Time             uint8 // seconds
	LapNum           uint8
	PlacesGained     uint8
}

func (PenaltyEvent) eventDetails() {}

// SpeedTrapEvent contains speed trap data
type SpeedTrapEvent struct {
	VehicleIdx               uint8
	Speed                    float32
	IsOverallFastestInSession uint8
	IsDriverFastestInSession  uint8
	FastestVehicleIdxInSession uint8
	FastestSpeedInSession     float32
}

func (SpeedTrapEvent) eventDetails() {}

// RaceWinnerEvent contains the race winner
type RaceWinnerEvent struct {
	VehicleIdx uint8
}

func (RaceWinnerEvent) eventDetails() {}

// FastestLapEvent contains fastest lap data
type FastestLapEvent struct {
	VehicleIdx uint8
	LapTime    float32
}

func (FastestLapEvent) eventDetails() {}

// RetirementEvent contains retirement data
type RetirementEvent struct {
	VehicleIdx uint8
	Reason     uint8 // 0=invalid, 1=retired, 2=finished, 3=terminal damage, etc.
}

func (RetirementEvent) eventDetails() {}

// DRSDisabledEvent contains DRS disabled reason
type DRSDisabledEvent struct {
	Reason uint8 // 0=Wet track, 1=Safety car, 2=Red flag, 3=Min lap not reached
}

func (DRSDisabledEvent) eventDetails() {}

// StopGoServedEvent contains stop-go penalty served data
type StopGoServedEvent struct {
	VehicleIdx uint8
	StopTime   float32 // Time spent in stop-go (seconds)
}

func (StopGoServedEvent) eventDetails() {}

// OvertakeEvent contains overtake data
type OvertakeEvent struct {
	OvertakingVehicleIdx  uint8
	BeingOvertakenVehicleIdx uint8
}

func (OvertakeEvent) eventDetails() {}

// GenericVehicleEvent is used for simple events with just a vehicle index
type GenericVehicleEvent struct {
	VehicleIdx uint8
}

func (GenericVehicleEvent) eventDetails() {}

// SafetyCarEvent contains safety car status
type SafetyCarEvent struct {
	SafetyCarType uint8
	EventType     uint8
}

func (SafetyCarEvent) eventDetails() {}

// CollisionEvent contains collision data
type CollisionEvent struct {
	Vehicle1Idx uint8
	Vehicle2Idx uint8
}

func (CollisionEvent) eventDetails() {}

var ErrEventPacketTooSmall = errors.New("packet too small for event data")

// ParseEventPacket parses an event packet from raw bytes
func ParseEventPacket(data []byte, header *PacketHeader) (*PacketEventData, error) {
	// Header (29) + event code (4) = 33 minimum
	if len(data) < PacketHeaderSize+4 {
		return nil, ErrEventPacketTooSmall
	}

	offset := PacketHeaderSize
	eventCode := string(data[offset : offset+4])
	offset += 4

	pkt := &PacketEventData{
		Header:          *header,
		EventStringCode: eventCode,
	}

	// Parse event-specific details
	switch eventCode {
	case EventPenalty:
		if len(data) < offset+7 {
			return nil, fmt.Errorf("packet too small for penalty event details")
		}
		pkt.EventDetails = &PenaltyEvent{
			PenaltyType:      data[offset],
			InfringementType: data[offset+1],
			VehicleIdx:       data[offset+2],
			OtherVehicleIdx:  data[offset+3],
			Time:             data[offset+4],
			LapNum:           data[offset+5],
			PlacesGained:     data[offset+6],
		}

	case EventSpeedTrap:
		if len(data) < offset+12 {
			return nil, fmt.Errorf("packet too small for speed trap event details")
		}
		pkt.EventDetails = &SpeedTrapEvent{
			VehicleIdx:                data[offset],
			Speed:                     float32FromBytes(data[offset+1 : offset+5]),
			IsOverallFastestInSession: data[offset+5],
			IsDriverFastestInSession:  data[offset+6],
			FastestVehicleIdxInSession: data[offset+7],
			FastestSpeedInSession:     float32FromBytes(data[offset+8 : offset+12]),
		}

	case EventRaceWinner:
		if len(data) < offset+1 {
			return nil, fmt.Errorf("packet too small for race winner event details")
		}
		pkt.EventDetails = &RaceWinnerEvent{
			VehicleIdx: data[offset],
		}

	case EventFastestLap:
		if len(data) < offset+5 {
			return nil, fmt.Errorf("packet too small for fastest lap event details")
		}
		pkt.EventDetails = &FastestLapEvent{
			VehicleIdx: data[offset],
			LapTime:    float32FromBytes(data[offset+1 : offset+5]),
		}

	case EventRetirement:
		if len(data) < offset+2 {
			return nil, fmt.Errorf("packet too small for retirement event details")
		}
		pkt.EventDetails = &RetirementEvent{
			VehicleIdx: data[offset],
			Reason:     data[offset+1],
		}

	case EventOvertake:
		if len(data) < offset+2 {
			return nil, fmt.Errorf("packet too small for overtake event details")
		}
		pkt.EventDetails = &OvertakeEvent{
			OvertakingVehicleIdx:     data[offset],
			BeingOvertakenVehicleIdx: data[offset+1],
		}

	case EventDriveThroughServed, EventTeamMateInPits:
		if len(data) < offset+1 {
			return nil, fmt.Errorf("packet too small for vehicle event details")
		}
		pkt.EventDetails = &GenericVehicleEvent{
			VehicleIdx: data[offset],
		}

	case EventStopGoServed:
		if len(data) < offset+5 {
			return nil, fmt.Errorf("packet too small for stop-go served event details")
		}
		pkt.EventDetails = &StopGoServedEvent{
			VehicleIdx: data[offset],
			StopTime:   float32FromBytes(data[offset+1 : offset+5]),
		}

	case EventDRSDisabled:
		if len(data) < offset+1 {
			return nil, fmt.Errorf("packet too small for DRS disabled event details")
		}
		pkt.EventDetails = &DRSDisabledEvent{
			Reason: data[offset],
		}

	case EventSafetyCarStatus:
		if len(data) < offset+2 {
			return nil, fmt.Errorf("packet too small for safety car event details")
		}
		pkt.EventDetails = &SafetyCarEvent{
			SafetyCarType: data[offset],
			EventType:     data[offset+1],
		}

	case EventCollision:
		if len(data) < offset+2 {
			return nil, fmt.Errorf("packet too small for collision event details")
		}
		pkt.EventDetails = &CollisionEvent{
			Vehicle1Idx: data[offset],
			Vehicle2Idx: data[offset+1],
		}

	case EventStartLights:
		if len(data) < offset+1 {
			return nil, fmt.Errorf("packet too small for start lights event details")
		}
		pkt.EventDetails = &GenericVehicleEvent{
			VehicleIdx: data[offset], // numLights reused as VehicleIdx field
		}

	default:
		// Events without details (SSTA, SEND, DRSE, CHQF, LGOT, RDFL, BUTN, FLBK)
	}

	return pkt, nil
}

// PenaltyTypeString returns a human-readable penalty type
func PenaltyTypeString(penaltyType uint8) string {
	switch penaltyType {
	case 0:
		return "Drive Through"
	case 1:
		return "Stop-Go"
	case 2:
		return "Grid Penalty"
	case 3:
		return "Penalty Reminder"
	case 4:
		return "Time Penalty"
	case 5:
		return "Warning"
	case 6:
		return "Disqualified"
	case 7:
		return "Removed from Formation Lap"
	case 8:
		return "Parked too long timer"
	case 9:
		return "Tyre Regulations"
	case 10:
		return "This lap invalidated"
	case 11:
		return "This and next lap invalidated"
	case 12:
		return "This lap invalidated without reason"
	case 13:
		return "This and next lap invalidated without reason"
	case 14:
		return "This and previous lap invalidated"
	case 15:
		return "This and previous lap invalidated without reason"
	case 16:
		return "Retired"
	case 17:
		return "Black Flag Timer"
	default:
		return fmt.Sprintf("Unknown Penalty (%d)", penaltyType)
	}
}

// InfringementTypeString returns a human-readable infringement type
func InfringementTypeString(infringementType uint8) string {
	switch infringementType {
	case 0:
		return "Blocking by slow driving"
	case 1:
		return "Blocking by wrong way driving"
	case 2:
		return "Reversing off the start line"
	case 3:
		return "Big collision"
	case 4:
		return "Small collision"
	case 5:
		return "Collision failed to hand back position (single)"
	case 6:
		return "Collision failed to hand back position (multiple)"
	case 7:
		return "Corner cutting gained time"
	case 8:
		return "Corner cutting overtake (single)"
	case 9:
		return "Corner cutting overtake (multiple)"
	case 10:
		return "Crossed pit exit lane"
	case 11:
		return "Ignoring blue flags"
	case 12:
		return "Ignoring yellow flags"
	case 13:
		return "Ignoring drive through"
	case 14:
		return "Too many drive throughs"
	case 15:
		return "Drive through reminder (serve within N laps)"
	case 16:
		return "Drive through reminder (serve this lap)"
	case 17:
		return "Pit lane speeding"
	case 18:
		return "Parked for too long"
	case 19:
		return "Ignoring tyre regulations"
	case 20:
		return "Too many penalties"
	case 21:
		return "Multiple warnings"
	case 22:
		return "Approaching disqualification"
	case 23:
		return "Tyre regulations (select single)"
	case 24:
		return "Tyre regulations (select multiple)"
	case 25:
		return "Lap invalidated (corner cutting)"
	case 26:
		return "Lap invalidated (running wide)"
	case 27:
		return "Corner cutting (ran wide, gained time minor)"
	case 28:
		return "Corner cutting (ran wide, gained time significant)"
	case 29:
		return "Corner cutting (ran wide, gained time extreme)"
	case 30:
		return "Lap invalidated (wall riding)"
	case 31:
		return "Lap invalidated (flashback used)"
	case 32:
		return "Lap invalidated (reset to track)"
	case 33:
		return "Blocking the pitlane"
	case 34:
		return "Jump start"
	case 35:
		return "Safety car to car collision"
	case 36:
		return "Safety car illegal overtake"
	case 37:
		return "Safety car exceeding allowed pace"
	case 38:
		return "Virtual safety car exceeding allowed pace"
	case 39:
		return "Formation lap below allowed speed"
	case 40:
		return "Formation lap parking"
	case 41:
		return "Retired mechanical failure"
	case 42:
		return "Retired terminally damaged"
	case 43:
		return "Safety car falling too far back"
	case 44:
		return "Black flag timer"
	case 45:
		return "Unserved stop-go penalty"
	case 46:
		return "Unserved drive-through penalty"
	case 47:
		return "Engine component change"
	case 48:
		return "Gearbox change"
	case 49:
		return "Parc fermé change"
	case 50:
		return "League grid penalty"
	case 51:
		return "Retry penalty"
	case 52:
		return "Illegal time gain"
	case 53:
		return "Mandatory pitstop"
	case 54:
		return "Attribute assigned"
	default:
		return fmt.Sprintf("Unknown Infringement (%d)", infringementType)
	}
}
