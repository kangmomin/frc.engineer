package packets

import "errors"

// MotionExDataSize is the size of the Motion Ex data after the header (244 bytes)
const MotionExDataSize = 244

// PacketMotionExData is the extended motion packet (Packet ID 13)
// Player car ONLY - 273 bytes total (29 header + 244 data)
// Wheel arrays order: RL, RR, FL, FR
type PacketMotionExData struct {
	Header                 PacketHeader
	SuspensionPosition     [4]float32
	SuspensionVelocity     [4]float32
	SuspensionAcceleration [4]float32
	WheelSpeed             [4]float32
	WheelSlipRatio         [4]float32
	WheelSlipAngle         [4]float32
	WheelLatForce          [4]float32
	WheelLongForce         [4]float32
	HeightOfCOGAboveGround float32
	LocalVelocityX         float32
	LocalVelocityY         float32
	LocalVelocityZ         float32
	AngularVelocityX       float32
	AngularVelocityY       float32
	AngularVelocityZ       float32
	AngularAccelerationX   float32
	AngularAccelerationY   float32
	AngularAccelerationZ   float32
	FrontWheelsAngle       float32
	WheelVertForce         [4]float32
	FrontAeroHeight        float32
	RearAeroHeight         float32
	FrontRollAngle         float32
	RearRollAngle          float32
	ChassisYaw             float32
	ChassisPitch           float32
	WheelCamber            [4]float32
	WheelCamberGain        [4]float32
}

// ErrMotionExPacketTooSmall is returned when motion ex packet is too small
var ErrMotionExPacketTooSmall = errors.New("motion ex packet too small")

// ParseMotionExPacket parses a motion ex packet from raw bytes
func ParseMotionExPacket(data []byte, header *PacketHeader) (*PacketMotionExData, error) {
	expectedSize := PacketHeaderSize + MotionExDataSize
	if len(data) < expectedSize {
		return nil, ErrMotionExPacketTooSmall
	}

	packet := &PacketMotionExData{
		Header: *header,
	}

	offset := PacketHeaderSize

	// 8 arrays of 4 float32 (suspension pos/vel/acc, wheel speed, slip ratio/angle, lat/long force)
	arrays := [...]*[4]float32{
		&packet.SuspensionPosition,
		&packet.SuspensionVelocity,
		&packet.SuspensionAcceleration,
		&packet.WheelSpeed,
		&packet.WheelSlipRatio,
		&packet.WheelSlipAngle,
		&packet.WheelLatForce,
		&packet.WheelLongForce,
	}
	for _, arr := range arrays {
		for i := range 4 {
			arr[i] = readFloat32(data[offset:])
			offset += 4
		}
	}

	// Single float32 fields
	packet.HeightOfCOGAboveGround = readFloat32(data[offset:])
	offset += 4
	packet.LocalVelocityX = readFloat32(data[offset:])
	offset += 4
	packet.LocalVelocityY = readFloat32(data[offset:])
	offset += 4
	packet.LocalVelocityZ = readFloat32(data[offset:])
	offset += 4
	packet.AngularVelocityX = readFloat32(data[offset:])
	offset += 4
	packet.AngularVelocityY = readFloat32(data[offset:])
	offset += 4
	packet.AngularVelocityZ = readFloat32(data[offset:])
	offset += 4
	packet.AngularAccelerationX = readFloat32(data[offset:])
	offset += 4
	packet.AngularAccelerationY = readFloat32(data[offset:])
	offset += 4
	packet.AngularAccelerationZ = readFloat32(data[offset:])
	offset += 4
	packet.FrontWheelsAngle = readFloat32(data[offset:])
	offset += 4

	for i := range 4 {
		packet.WheelVertForce[i] = readFloat32(data[offset:])
		offset += 4
	}

	packet.FrontAeroHeight = readFloat32(data[offset:])
	offset += 4
	packet.RearAeroHeight = readFloat32(data[offset:])
	offset += 4
	packet.FrontRollAngle = readFloat32(data[offset:])
	offset += 4
	packet.RearRollAngle = readFloat32(data[offset:])
	offset += 4
	packet.ChassisYaw = readFloat32(data[offset:])
	offset += 4
	packet.ChassisPitch = readFloat32(data[offset:])
	offset += 4

	for i := range 4 {
		packet.WheelCamber[i] = readFloat32(data[offset:])
		offset += 4
	}
	for i := range 4 {
		packet.WheelCamberGain[i] = readFloat32(data[offset:])
		offset += 4
	}

	return packet, nil
}
