package telemetry

import (
	"testing"

	"frc.engineer/internal/packets"
	"frc.engineer/internal/udp"
)

func TestEventObserverReceivesUnhandledEventsAndPlayerInputs(t *testing.T) {
	hub := &dashboardTestHub{}
	p := NewProcessor(udp.NewParser(testLogger()), hub, 0, testLogger(), nil)
	var seen []string
	var buttons uint32
	p.SetEventObserver(func(player uint8, e *packets.PacketEventData) {
		seen = append(seen, e.EventStringCode)
		if b, ok := e.EventDetails.(*packets.ButtonsEvent); ok {
			buttons = b.ButtonStatus
		}
	})
	if in := p.PitwallManager().PlayerInputs(); in.Valid {
		t.Fatal("inputs must be invalid before telemetry")
	}
	dashboardFixture(t, p)
	mask := packets.UDPActionMask(3)
	p.processPacket(dashboardPacket(t, 3, []byte("BUTN"), byte(mask), byte(mask>>8), byte(mask>>16), byte(mask>>24)))
	p.processPacket(dashboardPacket(t, 3, []byte("SCAR"), 1, 0))
	if len(seen) != 2 || seen[0] != "BUTN" || seen[1] != "SCAR" || buttons != mask {
		t.Fatalf("observer missed events: %v buttons=%#x", seen, buttons)
	}
	in := p.PitwallManager().PlayerInputs()
	if !in.Valid || in.SpeedKPH != 200 || in.Gear != 5 || in.Throttle != 0.8 {
		t.Fatalf("player inputs wrong: %+v", in)
	}
}
