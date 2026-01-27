package packets

// PacketID identifies the type of F1 25 UDP packet
type PacketID uint8

const (
	PacketIDMotion          PacketID = 0
	PacketIDSession         PacketID = 1
	PacketIDLapData         PacketID = 2
	PacketIDEvent           PacketID = 3
	PacketIDParticipants    PacketID = 4
	PacketIDCarSetups       PacketID = 5
	PacketIDCarTelemetry    PacketID = 6
	PacketIDCarStatus       PacketID = 7
	PacketIDFinalClass      PacketID = 8
	PacketIDLobbyInfo       PacketID = 9
	PacketIDCarDamage       PacketID = 10
	PacketIDSessionHistory  PacketID = 11
	PacketIDTyreSets        PacketID = 12
	PacketIDMotionEx        PacketID = 13
	PacketIDTimeTrial       PacketID = 14
)

// MaxCars is the maximum number of cars in an F1 session
const MaxCars = 22

// PacketHeaderSize is the size of the packet header in bytes
const PacketHeaderSize = 29

// MaxPacketSize is the maximum expected UDP packet size
const MaxPacketSize = 2048
