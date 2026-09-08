package telemetry

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"frc.engineer/internal/dto"
	"frc.engineer/internal/packets"
	"frc.engineer/internal/udp"
)

type dashboardTestHub struct {
	binary   bool
	messages [][]byte
	fast     [][]byte
	pitwall  int
}

func (h *dashboardTestHub) Binary() bool                        { return h.binary }
func (h *dashboardTestHub) Broadcast(b []byte)                  { h.messages = append(h.messages, b) }
func (h *dashboardTestHub) BroadcastFast(b []byte)              { h.fast = append(h.fast, b) }
func (h *dashboardTestHub) BroadcastPitwallState(_ interface{}) { h.pitwall++ }

// F1 25 wire fixtures exercise the actual parser and processor; the separate
// 24-car payload regression covers the F1 26 worst-case Pitwall envelope.
func dashboardPacket(t testing.TB, id packets.PacketID, body any, tail ...byte) []byte {
	t.Helper()
	var buf bytes.Buffer
	h := packets.PacketHeader{PacketFormat: 2025, GameYear: 25, SessionUID: 41, PacketID: id, PlayerCarIndex: 0}
	if err := binary.Write(&buf, binary.LittleEndian, h); err != nil {
		t.Fatal(err)
	}
	if err := binary.Write(&buf, binary.LittleEndian, body); err != nil {
		t.Fatal(err)
	}
	buf.Write(tail)
	return buf.Bytes()
}

func dashboardFixture(t testing.TB, p *Processor) []byte {
	t.Helper()
	session := make([]byte, packets.MinSessionPacketSize-packets.PacketHeaderSize)
	session[3], session[6], session[7] = 5, 15, 7
	binary.LittleEndian.PutUint16(session[4:6], 5000)
	p.processPacket(dashboardPacket(t, 1, session))
	tels := make([]packets.CarTelemetryData, 22)
	tels[0] = packets.CarTelemetryData{Speed: 200, Gear: 5, EngineRPM: 10000, Throttle: 0.8}
	tel := dashboardPacket(t, 6, tels, 255, 255, 0)
	p.processPacket(tel)
	laps := make([]packets.LapData, 22)
	laps[0] = packets.LapData{CurrentLapNum: 1, LapDistance: 10, CurrentLapTimeInMS: 100, CarPosition: 1}
	p.processPacket(dashboardPacket(t, 2, laps, 255, 255))
	return tel
}

func TestDashboardOptOutPreservesOtherOutputsAndPB(t *testing.T) {
	for _, binaryMode := range []bool{false, true} {
		for _, enabled := range []bool{true, false} {
			t.Run(fmt.Sprintf("binary=%t/enabled=%t", binaryMode, enabled), func(t *testing.T) {
				hub := &dashboardTestHub{binary: binaryMode}
				p := NewProcessor(udp.NewParser(testLogger()), hub, 0, testLogger(), nil)
				if !enabled {
					p.SetDashboardEnabled(false)
				}
				p.SetFastBroadcaster(hub)
				observed := 0
				p.SetPitwallStateObserver(func(_ uint64, _ time.Time, _ *dto.PitwallState) { observed++ })
				var best *LapTelemetry
				p.deltaCalculator.SetStorageCallbacks(func(_ int8, lap *LapTelemetry) error { best = lap; return nil }, nil)
				tel := dashboardFixture(t, p)
				motion := make([]packets.CarMotionData, 22)
				motion[0] = packets.CarMotionData{WorldPositionX: 100, WorldPositionZ: 200, WorldVelocityZ: 50}
				p.lastPitwallSend = time.Time{} // Exercise a due Pitwall tick without sleeping.
				p.processPacket(dashboardPacket(t, 0, motion))
				laps := make([]packets.LapData, 22)
				laps[0] = packets.LapData{CurrentLapNum: 1, LapDistance: 4990, CurrentLapTimeInMS: 79000, Sector1TimeInMS: 25000, Sector2TimeInMS: 27000}
				p.processPacket(dashboardPacket(t, 2, laps, 255, 255))
				laps[0] = packets.LapData{CurrentLapNum: 2, LapDistance: 10, LastLapTimeInMS: 80000}
				p.processPacket(dashboardPacket(t, 2, laps, 255, 255))
				p.processPacket(dashboardPacket(t, 3, []byte("PENA"), 4, 0, 0, 0, 5, 1, 0))
				if best == nil || best.LapTimeMS != 80000 || len(best.DataPoints) != 2 || p.deltaCalculator.GetBestLapTime() != 80000 {
					t.Fatalf("personal best tracking changed: %+v", best)
				}
				if hub.pitwall < 2 || observed != hub.pitwall {
					t.Fatalf("Pitwall or observer lost: emitted=%d observed=%d", hub.pitwall, observed)
				}
				var positions struct {
					Type string            `json:"type"`
					Data []dto.CarPosition `json:"data"`
				}
				if len(hub.fast) != 1 || dto.MsgpackUnmarshal(hub.fast[0], &positions) != nil || positions.Type != dto.MessageTypePositionUpdate || len(positions.Data) == 0 || positions.Data[0].X != 100 || positions.Data[0].Z != 200 {
					t.Fatalf("fast positions changed: %+v", positions)
				}
				dashboards, events := 0, 0
				for _, wire := range hub.messages {
					var message struct {
						Type  string `json:"type"`
						Speed uint16 `json:"speed"`
					}
					decode := json.Unmarshal
					if binaryMode {
						decode = dto.MsgpackUnmarshal
					}
					if err := decode(wire, &message); err != nil {
						t.Fatal(err)
					}
					if message.Type == "" && message.Speed == 200 {
						dashboards++
					} else if message.Type == dto.MessageTypeRaceControl {
						events++
					} else {
						t.Fatalf("unexpected payload: %+v", message)
					}
				}
				if (dashboards > 0) != enabled || events != 1 {
					t.Fatalf("dashboard=%d event=%d enabled=%t", dashboards, events, enabled)
				}
				p.SetDashboardEnabled(true)
				before := len(hub.messages)
				p.processPacket(tel)
				if len(hub.messages) != before+1 {
					t.Fatal("zero-rate legacy caller no longer sends without rate limiting")
				}
			})
		}
	}
}

func TestDashboardPositiveRateIsPreserved(t *testing.T) {
	hub := &dashboardTestHub{}
	p := NewProcessor(udp.NewParser(testLogger()), hub, 1, testLogger(), nil)
	tel := dashboardFixture(t, p)
	hub.messages = nil
	p.lastSend = time.Now().Add(time.Hour)
	p.processPacket(tel)
	if len(hub.messages) != 0 {
		t.Fatal("dashboard ignored rate limit")
	}
	p.lastSend = time.Now().Add(-2 * time.Second)
	p.processPacket(tel)
	p.processPacket(tel)
	if len(hub.messages) != 1 {
		t.Fatalf("expected one due dashboard, got %d", len(hub.messages))
	}
}

type dashboardBenchHub struct{ messages, bytes int }

func (*dashboardBenchHub) Binary() bool                      { return true }
func (h *dashboardBenchHub) Broadcast(wire []byte)           { h.messages++; h.bytes += len(wire) }
func (*dashboardBenchHub) BroadcastPitwallState(interface{}) {}

func BenchmarkProcessorDashboard(b *testing.B) {
	for _, enabled := range []bool{true, false} {
		b.Run(fmt.Sprintf("enabled=%t", enabled), func(b *testing.B) {
			hub := &dashboardBenchHub{}
			p := NewProcessor(udp.NewParser(testLogger()), hub, 0, testLogger(), nil)
			p.SetDashboardEnabled(enabled)
			tel := dashboardFixture(b, p)
			// Isolate steady telemetry packet work between the independent 4Hz ticks.
			p.lastPitwallSend = time.Now().Add(time.Hour)
			hub.messages, hub.bytes = 0, 0
			b.ReportAllocs()
			b.ResetTimer()
			for range b.N {
				p.processPacket(tel)
			}
			b.StopTimer()
			b.ReportMetric(float64(hub.messages)/float64(b.N), "dashboard-msg/op")
			b.ReportMetric(float64(hub.bytes)/float64(b.N), "dashboard-bytes/op")
		})
	}
}
