package telemetry

import (
	"bytes"
	"encoding/binary"
	"testing"
	"time"

	"frc.engineer/internal/packets"
	"frc.engineer/internal/udp"
	"frc.engineer/internal/websocket"
)

func TestDeltaAustraliaPersistenceValidityAndMinutes(t *testing.T) {
	d := NewDeltaCalculator()
	saved := map[int8]*LapTelemetry{0: {TrackID: 0, LapTimeMS: 160000}}
	loads := 0
	d.SetStorageCallbacks(func(track int8, lap *LapTelemetry) error {
		// The callback can read calculator state: it must run outside d.mu.
		if d.GetBestLapTime() != lap.LapTimeMS {
			t.Fatal("save saw a different best")
		}
		saved[track] = lap
		return nil
	}, func(track int8) (*LapTelemetry, error) { loads++; return saved[track], nil })
	d.ObserveSession(1)
	d.SetTrackID(0)
	header := &packets.PacketHeader{SessionUID: 1}
	d.Update(header, &packets.LapData{CurrentLapNum: 1, LapDistance: 10})
	if d.GetBestLapTime() != 160000 || loads != 1 {
		t.Fatal("Australia reference was not loaded or was erased by Update")
	}
	// One invalid packet must not disappear between dashboard broadcasts.
	d.Update(header, &packets.LapData{CurrentLapNum: 1, LapDistance: 100, CurrentLapInvalid: 1})
	d.Update(header, &packets.LapData{CurrentLapNum: 1, LapDistance: 4990})
	d.Update(header, &packets.LapData{CurrentLapNum: 2, LapDistance: 10, LastLapTimeInMS: 140000})
	if d.GetBestLapTime() != 160000 {
		t.Fatal("invalid lap became persistent best")
	}
	d.Update(header, &packets.LapData{CurrentLapNum: 2, LapDistance: 4990, Sector1TimeMinutes: 1, Sector1TimeInMS: 10000, Sector2TimeInMS: 40000})
	d.Update(header, &packets.LapData{CurrentLapNum: 3, LapDistance: 10, LastLapTimeInMS: 150000})
	best := saved[0]
	if best.LapTimeMS != 150000 || best.Sector1MS != 70000 || best.Sector2MS != 40000 || best.Sector3MS != 40000 {
		t.Fatalf("completed sectors: %+v", best)
	}
	d.ObserveSession(2)
	d.SetTrackID(0)
	d.Update(&packets.PacketHeader{SessionUID: 2}, &packets.LapData{CurrentLapNum: 1})
	if d.GetBestLapTime() != 150000 || loads != 2 {
		t.Fatal("next session did not reload persistent best")
	}
	d.SetTrackID(1)
	if d.GetBestLapData() != nil || d.GetBestLapTime() != 0 {
		t.Fatal("track with no stored best inherited Australia")
	}
}

func TestDeltaPlayerSwitchCannotCompletePreviousPlayerLap(t *testing.T) {
	d := NewDeltaCalculator()
	d.ObserveSession(1)
	d.SetTrackID(0)
	var stored *LapTelemetry
	d.SetStorageCallbacks(func(_ int8, lap *LapTelemetry) error { stored = lap; return nil }, nil)
	first := &packets.PacketHeader{SessionUID: 1, PlayerCarIndex: 0}
	d.UpdateWithTelemetry(first, &packets.LapData{CurrentLapNum: 1, LapDistance: 10, CurrentLapTimeInMS: 100}, &packets.CarTelemetryData{Speed: 300})
	d.UpdateWithTelemetry(first, &packets.LapData{CurrentLapNum: 1, LapDistance: 4990, CurrentLapTimeInMS: 89000, Sector1TimeInMS: 30000, Sector2TimeInMS: 30000}, &packets.CarTelemetryData{Speed: 300})
	second := &packets.PacketHeader{SessionUID: 1, PlayerCarIndex: 1}
	d.UpdateWithTelemetry(second, &packets.LapData{CurrentLapNum: 2, LapDistance: 10, LastLapTimeInMS: 80000}, &packets.CarTelemetryData{Speed: 200})
	if stored != nil {
		t.Fatalf("player switch persisted a mixed lap: %+v", stored)
	}
	d.UpdateWithTelemetry(second, &packets.LapData{CurrentLapNum: 2, LapDistance: 4990, CurrentLapTimeInMS: 79000, Sector1TimeInMS: 30000, Sector2TimeInMS: 30000}, &packets.CarTelemetryData{Speed: 200})
	d.UpdateWithTelemetry(second, &packets.LapData{CurrentLapNum: 3, LapDistance: 10, LastLapTimeInMS: 80000}, &packets.CarTelemetryData{Speed: 200})
	if stored == nil || stored.LapTimeMS != 80000 || len(stored.DataPoints) != 2 {
		t.Fatalf("new player's complete lap was not saved: %+v", stored)
	}
	for _, point := range stored.DataPoints {
		if point.Speed != 200 {
			t.Fatalf("new player's lap contains old telemetry: %+v", point)
		}
	}
}

func TestProcessorLoadsReferenceAndObservesLapPacketsBeforeRateLimit(t *testing.T) {
	logger := testLogger()
	p := NewProcessor(udp.NewParser(logger), websocket.NewHub(8, logger), 1, logger, nil)
	p.lastSend = time.Now().Add(time.Hour) // Suppress every dashboard broadcast.
	p.deltaCalculator.SetStorageCallbacks(nil, func(track int8) (*LapTelemetry, error) { return &LapTelemetry{TrackID: track, LapTimeMS: 100000}, nil })
	header := packets.PacketHeader{PacketFormat: 2025, SessionUID: 9, PacketID: 1}
	var encoded bytes.Buffer
	if err := binary.Write(&encoded, binary.LittleEndian, header); err != nil {
		t.Fatal(err)
	}
	session := append(encoded.Bytes(), make([]byte, packets.MinSessionPacketSize-packets.PacketHeaderSize)...)
	session[packets.PacketHeaderSize+7] = 0
	p.processPacket(session)
	if p.deltaCalculator.GetBestLapTime() != 100000 {
		t.Fatal("Processor did not connect Session track ID")
	}
	sendLap := func(lap packets.LapData) {
		h := header
		h.PacketID = 2
		var buf bytes.Buffer
		_ = binary.Write(&buf, binary.LittleEndian, h)
		cars := make([]packets.LapData, 22)
		cars[h.PlayerCarIndex] = lap
		_ = binary.Write(&buf, binary.LittleEndian, cars)
		buf.Write([]byte{255, 255})
		p.processPacket(buf.Bytes())
	}
	sendLap(packets.LapData{CurrentLapNum: 1, LapDistance: 10})
	sendLap(packets.LapData{CurrentLapNum: 1, LapDistance: 100, CurrentLapInvalid: 1})
	sendLap(packets.LapData{CurrentLapNum: 1, LapDistance: 1000})
	sendLap(packets.LapData{CurrentLapNum: 2, LapDistance: 10, LastLapTimeInMS: 80000})
	if p.latestLapData == nil || p.latestLapData.CurrentLapNum != 2 {
		t.Fatal("fixture did not reach actual packet cache")
	}
	if p.deltaCalculator.GetBestLapTime() != 100000 || p.deltaCalculator.lastLapNum != 2 {
		t.Fatal("rate limited dashboard lost lap observation")
	}
	p.latestTelemetry = &packets.CarTelemetryData{Speed: 300}
	p.latestPlayerCT2 = &packets.CarTelemetry2Data{}
	header.PlayerCarIndex = 1
	sendLap(packets.LapData{CurrentLapNum: 3, LapDistance: 10, LastLapTimeInMS: 70000})
	if p.latestTelemetry != nil || p.latestPlayerCT2 != nil || len(p.deltaCalculator.currentLapData) != 0 || p.deltaCalculator.GetBestLapTime() != 100000 {
		t.Fatal("player-first lap packet inherited telemetry or completed the old player's lap")
	}
	p.latestTelemetry = &packets.CarTelemetryData{Speed: 200}
	p.latestPlayerCT2 = &packets.CarTelemetry2Data{}
	// First event of a new session must invalidate every dashboard cache.
	h := header
	h.SessionUID = 10
	h.PacketID = 3
	var event bytes.Buffer
	_ = binary.Write(&event, binary.LittleEndian, h)
	event.WriteString("SSTA")
	p.processPacket(event.Bytes())
	if p.latestTelemetry != nil || p.latestLapData != nil || p.latestHeader != nil || p.latestPlayerCT2 != nil {
		t.Fatal("event-first new session retained dashboard cache")
	}
	if p.pitwallManager.session != nil || p.pitwallManager.lapData != nil || p.pitwallManager.lastSessionUID != 10 {
		t.Fatal("event-first new session retained pitwall cache")
	}
}
