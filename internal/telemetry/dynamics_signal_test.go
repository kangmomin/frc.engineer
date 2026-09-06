package telemetry

import (
	"bytes"
	"encoding/binary"
	"math"
	"testing"
	"time"

	"frc.engineer/internal/packets"
	"frc.engineer/internal/udp"
	"frc.engineer/internal/websocket"
)

func TestMalformedMotionReturnsFromProcessor(t *testing.T) {
	for _, tc := range []struct {
		name string
		yaw  float32
	}{
		{"infinite", float32(math.Inf(1))},
		{"negative_infinite", float32(math.Inf(-1))},
		{"nan", float32(math.NaN())},
		{"negative_large", -math.MaxFloat32},
		{"finite_large", math.MaxFloat32},
	} {
		t.Run(tc.name, func(t *testing.T) {
			logger := testLogger()
			p := NewProcessor(udp.NewParser(logger), websocket.NewHub(8, logger), 0, logger, nil)
			h := packets.PacketHeader{PacketFormat: 2025, SessionUID: 453, PlayerCarIndex: 0}
			p.pitwallManager.UpdateSession(&packets.PacketSessionData{Header: h, TrackID: 7, SessionType: 15})
			lap := &packets.PacketLapData{Header: h}
			lap.LapData[0].CurrentLapNum = 1
			p.pitwallManager.UpdateLapData(lap)
			tel := &packets.PacketCarTelemetryData{Header: h}
			tel.CarTelemetryData[0].Speed = 150
			p.pitwallManager.UpdateTelemetry(tel)
			motion := packets.PacketMotionData{Header: h}
			motion.CarMotionData[0].WorldVelocityZ = 40
			motion.CarMotionData[0].Yaw = tc.yaw
			var wire bytes.Buffer
			if err := binary.Write(&wire, binary.LittleEndian, h); err != nil {
				t.Fatal(err)
			}
			if err := binary.Write(&wire, binary.LittleEndian, motion.CarMotionData[:22]); err != nil {
				t.Fatal(err)
			}
			if len(wire.Bytes()) != 1349 {
				t.Fatalf("wire size %d", wire.Len())
			}
			parsed, err := udp.NewParser(logger).Parse(wire.Bytes())
			if err != nil || math.Float32bits(parsed.Motion.CarMotionData[0].Yaw) != math.Float32bits(tc.yaw) {
				t.Fatalf("canonical packet parse: %v", err)
			}
			done := make(chan struct{})
			go func() { p.processPacket(wire.Bytes()); close(done) }()
			select {
			case <-done:
				p.pitwallManager.BuildState() // The packet must also release the manager lock.
			case <-time.After(time.Second):
				t.Fatalf("single parsed %d-byte motion packet did not return: yaw=%g", wire.Len(), tc.yaw)
			}
		})
	}
}

func TestClassifyDynamicsRejectsCorruptInputs(t *testing.T) {
	for _, bad := range []float32{float32(math.NaN()), float32(math.Inf(1)), float32(math.Inf(-1))} {
		for field := range 5 {
			input := [5]float32{0, 40, 0, 0.2, 1}
			input[field] = bad
			if got := ClassifyDynamicsFrame(input[0], input[1], input[2], 150, input[3], input[4]); got != (DynamicsSignal{}) {
				t.Fatalf("field %d = %v produced %+v", field, bad, got)
			}
		}
	}
	if got := ClassifyDynamicsFrame(0, 40, 0, 150, 0.2, 1); !got.Cornering || !got.Understeer || !got.Lockup || got.Spin {
		t.Fatalf("normal corner classification changed: %+v", got)
	}
	if got := ClassifyDynamicsFrame(0, -40, float32(math.Pi), 150, 0.2, 0); !got.Understeer || got.Spin {
		t.Fatalf("float32 pi and angle wrap rejected: %+v", got)
	}
}
