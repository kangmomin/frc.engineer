package main

import (
	"encoding/binary"
	"flag"
	"fmt"
	"log"
	"math"
	"math/rand"
	"net"
	"time"
)

// Simulates F1 25 UDP telemetry for testing

const (
	PacketIDMotion       = 0
	PacketIDSession      = 1
	PacketIDLapData      = 2
	PacketIDEvent        = 3
	PacketIDParticipants = 4
	PacketIDCarTelemetry = 6
	PacketIDCarStatus    = 7
	MaxCars              = 22
	PacketHeaderSize     = 29
	ParticipantDataSize  = 57
	CarStatusDataSize    = 55
	SessionPacketSize    = 685
)

func main() {
	addr := flag.String("addr", "127.0.0.1:20777", "UDP target address")
	hz := flag.Int("hz", 60, "Packets per second")
	laps := flag.Int("laps", 3, "Number of laps to simulate")
	flag.Parse()

	if *hz <= 0 {
		log.Fatal("hz must be greater than 0")
	}
	if *laps <= 0 {
		log.Fatal("laps must be greater than 0")
	}

	conn, err := net.Dial("udp", *addr)
	if err != nil {
		log.Fatalf("Failed to connect: %v", err)
	}
	defer conn.Close()

	fmt.Printf("Sending mock F1 25 telemetry to %s at %d Hz\n", *addr, *hz)
	fmt.Printf("Simulating %d laps...\n", *laps)

	sim := NewSimulator(*laps, *hz)
	ticker := time.NewTicker(time.Second / time.Duration(*hz))
	defer ticker.Stop()

	frameID := uint32(0)
	for range ticker.C {
		if sim.Done() {
			fmt.Println("Simulation complete!")
			return
		}

		// Slow-changing packets required by the pitwall UI.
		if frameID == 0 || frameID%uint32(*hz) == 0 {
			sessionPacket := sim.BuildSessionPacket(frameID)
			if _, err := conn.Write(sessionPacket); err != nil {
				log.Printf("Failed to send session: %v", err)
			}

			participantsPacket := sim.BuildParticipantsPacket(frameID)
			if _, err := conn.Write(participantsPacket); err != nil {
				log.Printf("Failed to send participants: %v", err)
			}

			carStatusPacket := sim.BuildCarStatusPacket(frameID)
			if _, err := conn.Write(carStatusPacket); err != nil {
				log.Printf("Failed to send car status: %v", err)
			}
		}

		// High-rate packets for dashboard and track map updates.
		motionPacket := sim.BuildMotionPacket(frameID)
		if _, err := conn.Write(motionPacket); err != nil {
			log.Printf("Failed to send motion: %v", err)
		}

		telemetryPacket := sim.BuildTelemetryPacket(frameID)
		if _, err := conn.Write(telemetryPacket); err != nil {
			log.Printf("Failed to send telemetry: %v", err)
		}

		// Send lap data packet
		lapDataPacket := sim.BuildLapDataPacket(frameID)
		if _, err := conn.Write(lapDataPacket); err != nil {
			log.Printf("Failed to send lap data: %v", err)
		}

		sim.Tick()

		// Send any pending warning/penalty event packets
		for _, evt := range sim.DrainPendingEvents() {
			eventPacket := sim.BuildPenaltyEventPacket(frameID, evt)
			if _, err := conn.Write(eventPacket); err != nil {
				log.Printf("Failed to send penalty event: %v", err)
			}
		}

		frameID++

		// Progress indicator every second
		if frameID%uint32(*hz) == 0 {
			fmt.Printf("\rLap %d | Distance: %.0fm | Speed: %d km/h | Gear: %d | RPM: %d    ",
				sim.CurrentLap, sim.LapDistance, sim.Speed, sim.Gear, sim.RPM)
		}
	}
}

// Simulator simulates a car driving around a track
type Simulator struct {
	SessionUID    uint64
	PlayerCarIdx  uint8
	TotalLaps     int
	CurrentLap    uint8
	LapDistance   float32
	TotalDistance float32
	TrackLength   float32
	TrackID       int8
	TickRate      int

	// Telemetry
	Speed    uint16
	Throttle float32
	Brake    float32
	Steer    float32
	Gear     int8
	RPM      uint16
	DRS      uint8

	// Timing
	CurrentLapTimeMS uint32
	LastLapTimeMS    uint32
	BestLapTimeMS    uint32
	Sector           uint8
	LapInvalid       uint8
	Position         uint8

	// Warning/Penalty simulation
	TotalWarnings         uint8
	CornerCuttingWarnings uint8
	Penalties             uint8 // accumulated penalty seconds
	warningSchedule       []float32
	penaltySchedule       []penaltyEntry
	warningIdx            int
	penaltyIdx            int
	pendingEvents         []penaltyEventData

	// AI car penalty simulation
	aiPenaltyStates   map[int]*aiCarPenaltyState
	aiPenaltyTriggers []aiPenaltyTrigger
	aiTriggerIdx      int

	// Internal
	tickCount    int
	sectorTimes  [3]uint32
	lapStartTime time.Time
}

// penaltyEntry defines a scheduled penalty trigger
type penaltyEntry struct {
	distance        float32
	penaltyType     uint8
	infringementType uint8
	timePenalty     uint8 // seconds (for time penalty)
}

// penaltyEventData holds data for a PENA event packet
type penaltyEventData struct {
	PenaltyType      uint8
	InfringementType uint8
	VehicleIdx       uint8
	OtherVehicleIdx  uint8
	Time             uint8
	LapNum           uint8
	PlacesGained     uint8
}

// aiCarPenaltyState tracks accumulated penalties/warnings for an AI car
type aiCarPenaltyState struct {
	totalWarnings         uint8
	cornerCuttingWarnings uint8
	penalties             uint8
}

// aiPenaltyTrigger defines a scheduled penalty/warning for an AI car
type aiPenaltyTrigger struct {
	triggerTick      int
	carIdx           uint8
	isWarning        bool  // true = warning, false = penalty
	penaltyType      uint8
	infringementType uint8
	timePenalty      uint8 // seconds, only for penalties
}

func NewSimulator(laps int, hz int) *Simulator {
	// Build AI penalty/warning triggers spread across the session.
	// Each lap takes ~25s at simulated speed → total ticks ≈ laps * 25 * hz.
	totalTicks := laps * 25 * hz
	aiTriggers := buildAIPenaltySchedule(totalTicks, hz)

	return &Simulator{
		SessionUID:   rand.Uint64(),
		PlayerCarIdx: 0,
		TotalLaps:    laps,
		CurrentLap:   1,
		TrackLength:  5800, // Approximate Monaco length in meters
		TrackID:      10,   // Monza
		TickRate:     hz,
		Position:     1,
		lapStartTime: time.Now(),
		// Corner cutting warnings at 3000m, 7500m, 10000m; 5s time penalty at 10000m
		warningSchedule: []float32{3000, 7500, 10000},
		penaltySchedule: []penaltyEntry{
			{distance: 10050, penaltyType: 4, infringementType: 7, timePenalty: 5},
		},
		aiPenaltyStates:   make(map[int]*aiCarPenaltyState),
		aiPenaltyTriggers: aiTriggers,
	}
}

// buildAIPenaltySchedule creates penalty/warning events for AI drivers.
// Spreads warnings and penalties across 5-6 AI cars during the session.
func buildAIPenaltySchedule(totalTicks int, hz int) []aiPenaltyTrigger {
	type eventDef struct {
		carIdx           uint8
		fractionOfRace   float64 // when in the session (0.0-1.0) to trigger
		isWarning        bool
		penaltyType      uint8
		infringementType uint8
		timePenalty      uint8
	}

	events := []eventDef{
		// AI 03 (idx 2): warning early, another warning mid-race
		{carIdx: 2, fractionOfRace: 0.15, isWarning: true, penaltyType: 5, infringementType: 7},
		{carIdx: 2, fractionOfRace: 0.55, isWarning: true, penaltyType: 5, infringementType: 7},
		// AI 06 (idx 5): warning then 5s penalty
		{carIdx: 5, fractionOfRace: 0.25, isWarning: true, penaltyType: 5, infringementType: 4},
		{carIdx: 5, fractionOfRace: 0.60, isWarning: false, penaltyType: 4, infringementType: 4, timePenalty: 5},
		// AI 10 (idx 9): 10s penalty mid-race (collision)
		{carIdx: 9, fractionOfRace: 0.40, isWarning: false, penaltyType: 4, infringementType: 0, timePenalty: 10},
		// AI 14 (idx 13): two warnings
		{carIdx: 13, fractionOfRace: 0.30, isWarning: true, penaltyType: 5, infringementType: 7},
		{carIdx: 13, fractionOfRace: 0.70, isWarning: true, penaltyType: 5, infringementType: 2},
		// AI 18 (idx 17): warning + 5s penalty late
		{carIdx: 17, fractionOfRace: 0.50, isWarning: true, penaltyType: 5, infringementType: 7},
		{carIdx: 17, fractionOfRace: 0.80, isWarning: false, penaltyType: 4, infringementType: 7, timePenalty: 5},
	}

	triggers := make([]aiPenaltyTrigger, 0, len(events))
	for _, e := range events {
		tick := int(float64(totalTicks) * e.fractionOfRace)
		triggers = append(triggers, aiPenaltyTrigger{
			triggerTick:      tick,
			carIdx:           e.carIdx,
			isWarning:        e.isWarning,
			penaltyType:      e.penaltyType,
			infringementType: e.infringementType,
			timePenalty:      e.timePenalty,
		})
	}
	return triggers
}

func (s *Simulator) Done() bool {
	return int(s.CurrentLap) > s.TotalLaps
}

func (s *Simulator) Tick() {
	s.tickCount++

	// Update lap time
	s.CurrentLapTimeMS = uint32(time.Since(s.lapStartTime).Milliseconds())

	// Simulate driving around the track
	progress := s.LapDistance / s.TrackLength

	// Speed varies based on track position (simulate corners and straights)
	baseSpeed := 200.0 + 100.0*math.Sin(float64(progress)*math.Pi*8)
	s.Speed = uint16(baseSpeed + rand.Float64()*10)

	// Throttle/brake based on speed changes
	if baseSpeed > 250 {
		s.Throttle = 0.9 + rand.Float32()*0.1
		s.Brake = 0
		s.DRS = 1
	} else if baseSpeed < 150 {
		s.Throttle = 0.3 + rand.Float32()*0.2
		s.Brake = 0.5 + rand.Float32()*0.3
		s.DRS = 0
	} else {
		s.Throttle = 0.6 + rand.Float32()*0.3
		s.Brake = rand.Float32() * 0.1
		s.DRS = 0
	}

	// Gear based on speed
	switch {
	case s.Speed > 300:
		s.Gear = 8
	case s.Speed > 260:
		s.Gear = 7
	case s.Speed > 220:
		s.Gear = 6
	case s.Speed > 180:
		s.Gear = 5
	case s.Speed > 140:
		s.Gear = 4
	case s.Speed > 100:
		s.Gear = 3
	case s.Speed > 60:
		s.Gear = 2
	default:
		s.Gear = 1
	}

	// RPM based on gear and speed
	s.RPM = uint16(8000 + rand.Intn(4000))

	// Steering
	s.Steer = float32(math.Sin(float64(s.tickCount)*0.1)) * 0.5

	// Update sector
	if progress < 0.33 {
		s.Sector = 0
	} else if progress < 0.66 {
		s.Sector = 1
	} else {
		s.Sector = 2
	}

	// Move forward using the configured tick rate.
	distancePerTick := float32(s.Speed) / 3.6 / float32(s.TickRate)
	s.LapDistance += distancePerTick
	s.TotalDistance += distancePerTick

	// Check warning triggers
	for s.warningIdx < len(s.warningSchedule) && s.TotalDistance >= s.warningSchedule[s.warningIdx] {
		s.TotalWarnings++
		s.CornerCuttingWarnings++
		s.pendingEvents = append(s.pendingEvents, penaltyEventData{
			PenaltyType:      5, // Warning
			InfringementType: 7, // Corner cutting gained time
			VehicleIdx:       s.PlayerCarIdx,
			LapNum:           s.CurrentLap,
		})
		fmt.Printf("\n[WARNING %d] Corner cutting warning (total distance: %.0fm, lap %d)\n",
			s.TotalWarnings, s.TotalDistance, s.CurrentLap)
		s.warningIdx++
	}

	// Check penalty triggers
	for s.penaltyIdx < len(s.penaltySchedule) && s.TotalDistance >= s.penaltySchedule[s.penaltyIdx].distance {
		entry := s.penaltySchedule[s.penaltyIdx]
		s.Penalties += entry.timePenalty
		s.pendingEvents = append(s.pendingEvents, penaltyEventData{
			PenaltyType:      entry.penaltyType,
			InfringementType: entry.infringementType,
			VehicleIdx:       s.PlayerCarIdx,
			Time:             entry.timePenalty,
			LapNum:           s.CurrentLap,
		})
		fmt.Printf("\n[PENALTY] %ds time penalty for corner cutting (total distance: %.0fm, lap %d)\n",
			entry.timePenalty, s.TotalDistance, s.CurrentLap)
		s.penaltyIdx++
	}

	// Check AI penalty triggers
	for s.aiTriggerIdx < len(s.aiPenaltyTriggers) && s.tickCount >= s.aiPenaltyTriggers[s.aiTriggerIdx].triggerTick {
		t := s.aiPenaltyTriggers[s.aiTriggerIdx]
		state, ok := s.aiPenaltyStates[int(t.carIdx)]
		if !ok {
			state = &aiCarPenaltyState{}
			s.aiPenaltyStates[int(t.carIdx)] = state
		}
		if t.isWarning {
			state.totalWarnings++
			state.cornerCuttingWarnings++
			fmt.Printf("\n[AI %02d WARNING %d] penaltyType=%d infringement=%d (tick %d)\n",
				t.carIdx+1, state.totalWarnings, t.penaltyType, t.infringementType, s.tickCount)
		} else {
			state.penalties += t.timePenalty
			fmt.Printf("\n[AI %02d PENALTY] %ds time penalty, penaltyType=%d infringement=%d (tick %d)\n",
				t.carIdx+1, t.timePenalty, t.penaltyType, t.infringementType, s.tickCount)
		}
		s.pendingEvents = append(s.pendingEvents, penaltyEventData{
			PenaltyType:      t.penaltyType,
			InfringementType: t.infringementType,
			VehicleIdx:       t.carIdx,
			Time:             t.timePenalty,
			LapNum:           s.CurrentLap,
		})
		s.aiTriggerIdx++
	}

	// Check for lap completion
	if s.LapDistance >= s.TrackLength {
		s.LastLapTimeMS = s.CurrentLapTimeMS
		if s.BestLapTimeMS == 0 || s.LastLapTimeMS < s.BestLapTimeMS {
			s.BestLapTimeMS = s.LastLapTimeMS
		}
		s.CurrentLap++
		s.LapDistance = 0
		s.lapStartTime = time.Now()
		fmt.Printf("\n[LAP COMPLETE] Lap %d: %s (Best: %s)\n",
			s.CurrentLap-1,
			formatLapTime(s.LastLapTimeMS),
			formatLapTime(s.BestLapTimeMS))
	}
}

func formatLapTime(ms uint32) string {
	minutes := ms / 60000
	seconds := (ms % 60000) / 1000
	millis := ms % 1000
	return fmt.Sprintf("%d:%02d.%03d", minutes, seconds, millis)
}

func (s *Simulator) BuildSessionPacket(frameID uint32) []byte {
	buf := make([]byte, SessionPacketSize)
	s.writeHeader(buf, PacketIDSession, frameID)

	buf[29] = 0 // Weather: clear
	buf[30] = 38
	buf[31] = 24
	buf[32] = uint8(s.TotalLaps)
	binary.LittleEndian.PutUint16(buf[33:35], uint16(s.TrackLength))
	buf[35] = 15 // Race
	buf[36] = byte(s.TrackID)
	buf[47] = 3 // NumMarshalZones
	writeMarshalZone(buf, 48, 0.00, 1)
	writeMarshalZone(buf, 53, 0.33, 1)
	writeMarshalZone(buf, 58, 0.66, 1)
	buf[153] = 0 // No safety car
	buf[155] = 2 // Forecast sample count
	writeForecast(buf, 156, 15, 0, 0, 38, 0, 24, 0, 0)
	writeForecast(buf, 164, 15, 5, 1, 39, 1, 25, 1, 5)

	idealLap := s.TotalLaps / 2
	if idealLap < 1 {
		idealLap = 1
	}
	latestLap := idealLap + 3
	if latestLap > s.TotalLaps {
		latestLap = s.TotalLaps
	}
	buf[682] = uint8(idealLap)
	buf[683] = uint8(latestLap)
	buf[684] = 1

	return buf
}

func (s *Simulator) BuildTelemetryPacket(frameID uint32) []byte {
	// Header (29) + 22 cars * 60 bytes + 3 bytes footer
	packetSize := PacketHeaderSize + (MaxCars * 60) + 3
	buf := make([]byte, packetSize)

	// Write header
	s.writeHeader(buf, PacketIDCarTelemetry, frameID)

	// Write car telemetry data for all cars
	offset := PacketHeaderSize
	for i := 0; i < MaxCars; i++ {
		if i == int(s.PlayerCarIdx) {
			s.writeCarTelemetry(buf[offset:], true)
		} else {
			s.writeCarTelemetry(buf[offset:], false)
		}
		offset += 60
	}

	// MFD panel index, secondary, suggested gear
	buf[offset] = 0
	buf[offset+1] = 255
	buf[offset+2] = byte(s.Gear)

	return buf
}

func (s *Simulator) BuildMotionPacket(frameID uint32) []byte {
	packetSize := PacketHeaderSize + (MaxCars * 60)
	buf := make([]byte, packetSize)

	s.writeHeader(buf, PacketIDMotion, frameID)

	offset := PacketHeaderSize
	for i := 0; i < MaxCars; i++ {
		s.writeMotionData(buf[offset:], i)
		offset += 60
	}

	return buf
}

func (s *Simulator) BuildLapDataPacket(frameID uint32) []byte {
	// Header (29) + 22 cars * 57 bytes + 2 bytes footer
	packetSize := PacketHeaderSize + (MaxCars * 57) + 2
	buf := make([]byte, packetSize)

	// Write header
	s.writeHeader(buf, PacketIDLapData, frameID)

	// Write lap data for all cars
	offset := PacketHeaderSize
	for i := 0; i < MaxCars; i++ {
		s.writeLapData(buf[offset:], i == int(s.PlayerCarIdx), i)
		offset += 57
	}

	// Time trial indices
	buf[offset] = 255
	buf[offset+1] = 255

	return buf
}

func (s *Simulator) BuildParticipantsPacket(frameID uint32) []byte {
	packetSize := PacketHeaderSize + 1 + (MaxCars * ParticipantDataSize)
	buf := make([]byte, packetSize)

	s.writeHeader(buf, PacketIDParticipants, frameID)
	buf[PacketHeaderSize] = MaxCars

	offset := PacketHeaderSize + 1
	for i := 0; i < MaxCars; i++ {
		s.writeParticipantData(buf[offset:], i)
		offset += ParticipantDataSize
	}

	return buf
}

func (s *Simulator) BuildCarStatusPacket(frameID uint32) []byte {
	packetSize := PacketHeaderSize + (MaxCars * CarStatusDataSize)
	buf := make([]byte, packetSize)

	s.writeHeader(buf, PacketIDCarStatus, frameID)

	offset := PacketHeaderSize
	for i := 0; i < MaxCars; i++ {
		s.writeCarStatus(buf[offset:], i == int(s.PlayerCarIdx), i)
		offset += CarStatusDataSize
	}

	return buf
}

// DrainPendingEvents returns and clears any pending warning/penalty events
func (s *Simulator) DrainPendingEvents() []penaltyEventData {
	events := s.pendingEvents
	s.pendingEvents = nil
	return events
}

// BuildPenaltyEventPacket builds a PENA event packet
func (s *Simulator) BuildPenaltyEventPacket(frameID uint32, evt penaltyEventData) []byte {
	// Header(29) + EventCode(4) + PenaltyEvent(7) = 40 bytes
	buf := make([]byte, 40)
	s.writeHeader(buf, PacketIDEvent, frameID)

	// Event code "PENA"
	copy(buf[29:33], "PENA")

	// PenaltyEvent data
	buf[33] = evt.PenaltyType
	buf[34] = evt.InfringementType
	buf[35] = evt.VehicleIdx
	buf[36] = evt.OtherVehicleIdx
	buf[37] = evt.Time
	buf[38] = evt.LapNum
	buf[39] = evt.PlacesGained

	return buf
}

func (s *Simulator) writeHeader(buf []byte, packetID uint8, frameID uint32) {
	binary.LittleEndian.PutUint16(buf[0:2], 2025) // PacketFormat
	buf[2] = 25                                   // GameYear
	buf[3] = 1                                    // GameMajorVersion
	buf[4] = 0                                    // GameMinorVersion
	buf[5] = 1                                    // PacketVersion
	buf[6] = packetID                             // PacketID
	binary.LittleEndian.PutUint64(buf[7:15], s.SessionUID)
	binary.LittleEndian.PutUint32(buf[15:19], math.Float32bits(float32(s.tickCount)/float32(s.TickRate)))
	binary.LittleEndian.PutUint32(buf[19:23], frameID)
	binary.LittleEndian.PutUint32(buf[23:27], frameID)
	buf[27] = s.PlayerCarIdx
	buf[28] = 255 // No secondary player
}

func (s *Simulator) writeCarTelemetry(buf []byte, isPlayer bool) {
	offset := 0

	var speed uint16
	var throttle, brake, steer float32
	var gear int8
	var rpm uint16
	var drs uint8

	if isPlayer {
		speed = s.Speed
		throttle = s.Throttle
		brake = s.Brake
		steer = s.Steer
		gear = s.Gear
		rpm = s.RPM
		drs = s.DRS
	} else {
		// Other cars - random values
		speed = uint16(150 + rand.Intn(150))
		throttle = rand.Float32()
		brake = rand.Float32() * 0.3
		steer = (rand.Float32() - 0.5) * 2
		gear = int8(1 + rand.Intn(8))
		rpm = uint16(8000 + rand.Intn(4000))
		drs = 0
	}

	binary.LittleEndian.PutUint16(buf[offset:], speed)
	offset += 2
	binary.LittleEndian.PutUint32(buf[offset:], math.Float32bits(throttle))
	offset += 4
	binary.LittleEndian.PutUint32(buf[offset:], math.Float32bits(steer))
	offset += 4
	binary.LittleEndian.PutUint32(buf[offset:], math.Float32bits(brake))
	offset += 4
	buf[offset] = 0 // Clutch
	offset++
	buf[offset] = byte(gear)
	offset++
	binary.LittleEndian.PutUint16(buf[offset:], rpm)
	offset += 2
	buf[offset] = drs
	offset++
	buf[offset] = uint8(float32(rpm-8000) / 4000.0 * 100) // RevLightsPercent
	offset++
	binary.LittleEndian.PutUint16(buf[offset:], 0) // RevLightsBitValue
	offset += 2

	// Brakes temperature (4 x uint16)
	for i := 0; i < 4; i++ {
		binary.LittleEndian.PutUint16(buf[offset:], uint16(400+rand.Intn(200)))
		offset += 2
	}

	// Tyres surface temp (4 x uint8)
	for i := 0; i < 4; i++ {
		buf[offset] = uint8(90 + rand.Intn(20))
		offset++
	}

	// Tyres inner temp (4 x uint8)
	for i := 0; i < 4; i++ {
		buf[offset] = uint8(95 + rand.Intn(15))
		offset++
	}

	// Engine temp
	binary.LittleEndian.PutUint16(buf[offset:], uint16(100+rand.Intn(20)))
	offset += 2

	// Tyres pressure (4 x float32)
	for i := 0; i < 4; i++ {
		binary.LittleEndian.PutUint32(buf[offset:], math.Float32bits(23.0+rand.Float32()*2))
		offset += 4
	}

	// Surface type (4 x uint8)
	for i := 0; i < 4; i++ {
		buf[offset] = 0 // Tarmac
		offset++
	}
}

func (s *Simulator) writeLapData(buf []byte, isPlayer bool, carIdx int) {
	offset := 0

	var lastLap, currentLap uint32
	var lapDist, totalDist float32
	var position, lapNum, sector, lapInvalid uint8
	var deltaFront, deltaLeader int16

	if isPlayer {
		lastLap = s.LastLapTimeMS
		currentLap = s.CurrentLapTimeMS
		lapDist = s.LapDistance
		totalDist = s.TotalDistance
		position = s.Position
		lapNum = s.CurrentLap
		sector = s.Sector
		lapInvalid = s.LapInvalid
		deltaFront = 0
		deltaLeader = 0
	} else {
		lastLap = uint32(80000 + rand.Intn(10000))
		currentLap = uint32(rand.Intn(80000))
		lapDist = rand.Float32() * 5800
		totalDist = rand.Float32() * 50000
		position = uint8(1 + rand.Intn(MaxCars))
		lapNum = uint8(1 + rand.Intn(3))
		sector = uint8(rand.Intn(3))
		lapInvalid = 0
		deltaFront = int16(rand.Intn(5000))
		deltaLeader = int16(rand.Intn(10000))
	}

	binary.LittleEndian.PutUint32(buf[offset:], lastLap)
	offset += 4
	binary.LittleEndian.PutUint32(buf[offset:], currentLap)
	offset += 4
	binary.LittleEndian.PutUint16(buf[offset:], 0) // Sector1TimeInMS
	offset += 2
	buf[offset] = 0 // Sector1TimeMinutes
	offset++
	binary.LittleEndian.PutUint16(buf[offset:], 0) // Sector2TimeInMS
	offset += 2
	buf[offset] = 0 // Sector2TimeMinutes
	offset++
	binary.LittleEndian.PutUint16(buf[offset:], uint16(deltaFront))
	offset += 2
	buf[offset] = 0 // DeltaToCarInFrontMinutesPart
	offset++
	binary.LittleEndian.PutUint16(buf[offset:], uint16(deltaLeader))
	offset += 2
	buf[offset] = 0 // DeltaToRaceLeaderMinutesPart
	offset++
	binary.LittleEndian.PutUint32(buf[offset:], math.Float32bits(lapDist))
	offset += 4
	binary.LittleEndian.PutUint32(buf[offset:], math.Float32bits(totalDist))
	offset += 4
	binary.LittleEndian.PutUint32(buf[offset:], math.Float32bits(0)) // SafetyCarDelta
	offset += 4
	buf[offset] = position
	offset++
	buf[offset] = lapNum
	offset++
	buf[offset] = 0 // PitStatus
	offset++
	buf[offset] = 0 // NumPitStops
	offset++
	buf[offset] = sector
	offset++
	buf[offset] = lapInvalid
	offset++
	var penVal, warnVal, ccWarnVal uint8
	if isPlayer {
		penVal = s.Penalties
		warnVal = s.TotalWarnings
		ccWarnVal = s.CornerCuttingWarnings
	} else if aiState, ok := s.aiPenaltyStates[carIdx]; ok {
		penVal = aiState.penalties
		warnVal = aiState.totalWarnings
		ccWarnVal = aiState.cornerCuttingWarnings
	}
	buf[offset] = penVal
	offset++ // Penalties
	buf[offset] = warnVal
	offset++ // TotalWarnings
	buf[offset] = ccWarnVal
	offset++
	buf[offset] = 0 // NumUnservedDriveThroughs
	offset++
	buf[offset] = 0 // NumUnservedStopGoPenalties
	offset++
	buf[offset] = position // GridPosition
	offset++
	buf[offset] = 1 // DriverStatus (on track)
	offset++
	buf[offset] = 0 // ResultStatus
	offset++
	buf[offset] = 0 // PitLaneTimerActive
	offset++
	binary.LittleEndian.PutUint16(buf[offset:], 0) // PitLaneTimeInLaneInMS
	offset += 2
	binary.LittleEndian.PutUint16(buf[offset:], 0) // PitStopTimerInMS
	offset += 2
	buf[offset] = 0 // PitStopShouldServePen
	offset++
	binary.LittleEndian.PutUint32(buf[offset:], math.Float32bits(float32(320+rand.Intn(20)))) // SpeedTrapFastestSpeed
	offset += 4
	buf[offset] = lapNum // SpeedTrapFastestLap
}

func (s *Simulator) writeMotionData(buf []byte, carIdx int) {
	progress := math.Mod(float64(s.LapDistance/s.TrackLength)+float64(carIdx)/MaxCars, 1.0)
	angle := progress * 2 * math.Pi

	radiusX := 950.0
	radiusZ := 650.0
	x := float32(radiusX * math.Cos(angle))
	z := float32(radiusZ * math.Sin(angle))
	speedMS := float64(s.Speed) / 3.6
	vx := float32(-speedMS * math.Sin(angle))
	vz := float32(speedMS * math.Cos(angle))
	yaw := float32(angle + math.Pi/2)

	offset := 0
	binary.LittleEndian.PutUint32(buf[offset:], math.Float32bits(x))
	offset += 4
	binary.LittleEndian.PutUint32(buf[offset:], math.Float32bits(0))
	offset += 4
	binary.LittleEndian.PutUint32(buf[offset:], math.Float32bits(z))
	offset += 4
	binary.LittleEndian.PutUint32(buf[offset:], math.Float32bits(vx))
	offset += 4
	binary.LittleEndian.PutUint32(buf[offset:], math.Float32bits(0))
	offset += 4
	binary.LittleEndian.PutUint32(buf[offset:], math.Float32bits(vz))
	offset += 4

	forwardX := int16(math.Sin(angle) * 32767)
	forwardZ := int16(math.Cos(angle) * 32767)
	rightX := int16(math.Cos(angle) * 32767)
	rightZ := int16(-math.Sin(angle) * 32767)

	binary.LittleEndian.PutUint16(buf[offset:], uint16(forwardX))
	offset += 2
	binary.LittleEndian.PutUint16(buf[offset:], 0)
	offset += 2
	binary.LittleEndian.PutUint16(buf[offset:], uint16(forwardZ))
	offset += 2
	binary.LittleEndian.PutUint16(buf[offset:], uint16(rightX))
	offset += 2
	binary.LittleEndian.PutUint16(buf[offset:], 0)
	offset += 2
	binary.LittleEndian.PutUint16(buf[offset:], uint16(rightZ))
	offset += 2
	binary.LittleEndian.PutUint32(buf[offset:], math.Float32bits(float32(math.Sin(angle)*0.8)))
	offset += 4
	binary.LittleEndian.PutUint32(buf[offset:], math.Float32bits(0.15))
	offset += 4
	binary.LittleEndian.PutUint32(buf[offset:], math.Float32bits(0.05))
	offset += 4
	binary.LittleEndian.PutUint32(buf[offset:], math.Float32bits(yaw))
	offset += 4
	binary.LittleEndian.PutUint32(buf[offset:], math.Float32bits(0.01))
	offset += 4
	binary.LittleEndian.PutUint32(buf[offset:], math.Float32bits(0))
}

func (s *Simulator) writeParticipantData(buf []byte, carIdx int) {
	offset := 0
	isPlayer := carIdx == int(s.PlayerCarIdx)

	if isPlayer {
		buf[offset] = 0
	} else {
		buf[offset] = 1
	}
	offset++

	if isPlayer {
		buf[offset] = 255
	} else {
		buf[offset] = uint8(carIdx)
	}
	offset++

	buf[offset] = uint8(carIdx)
	offset++
	buf[offset] = uint8(carIdx % 10)
	offset++
	if isPlayer {
		buf[offset] = 1
	}
	offset++
	buf[offset] = uint8(carIdx + 1)
	offset++
	buf[offset] = 9 // UK
	offset++

	name := fmt.Sprintf("AI %02d", carIdx+1)
	if isPlayer {
		name = "Mock Driver"
	}
	copy(buf[offset:offset+32], []byte(name))
	offset += 32

	buf[offset] = 1 // YourTelemetry public
	offset++
	buf[offset] = 1 // ShowOnlineNames
	offset++
	binary.LittleEndian.PutUint16(buf[offset:], uint16(500+carIdx*10))
	offset += 2
	buf[offset] = 1 // Platform
	offset++
	buf[offset] = 2 // NumColours
	offset++

	colours := [4][3]uint8{
		{220, 20, 60},
		{255, 215, 0},
		{30, 144, 255},
		{245, 245, 245},
	}
	for _, colour := range colours {
		copy(buf[offset:offset+3], colour[:])
		offset += 3
	}
}

func (s *Simulator) writeCarStatus(buf []byte, isPlayer bool, carIdx int) {
	offset := 0
	fuelInTank := float32(18.5)
	fuelRemainingLaps := float32(maxInt(1, s.TotalLaps-int(s.CurrentLap)+1))
	ers := float32(3200000)
	compound := uint8(17) // medium
	tyreAge := uint8(maxInt(0, int(s.CurrentLap)-1))

	if !isPlayer {
		fuelInTank = 12 + rand.Float32()*15
		fuelRemainingLaps = 2 + rand.Float32()*20
		ers = 2000000 + rand.Float32()*1500000
		compounds := []uint8{16, 17, 18}
		compound = compounds[carIdx%len(compounds)]
		tyreAge = uint8(rand.Intn(maxInt(1, s.TotalLaps)))
	}

	buf[offset] = 1 // TractionControl
	offset++
	buf[offset] = 1 // ABS
	offset++
	buf[offset] = 1 // FuelMix standard
	offset++
	buf[offset] = 57 // FrontBrakeBias
	offset++
	buf[offset] = 0 // PitLimiterStatus
	offset++
	binary.LittleEndian.PutUint32(buf[offset:], math.Float32bits(fuelInTank))
	offset += 4
	binary.LittleEndian.PutUint32(buf[offset:], math.Float32bits(32))
	offset += 4
	binary.LittleEndian.PutUint32(buf[offset:], math.Float32bits(fuelRemainingLaps))
	offset += 4
	binary.LittleEndian.PutUint16(buf[offset:], 15000)
	offset += 2
	binary.LittleEndian.PutUint16(buf[offset:], 4000)
	offset += 2
	buf[offset] = 8 // MaxGears
	offset++
	buf[offset] = s.DRS
	offset++
	binary.LittleEndian.PutUint16(buf[offset:], 250)
	offset += 2
	buf[offset] = compound // ActualTyreCompound
	offset++
	buf[offset] = compound // VisualTyreCompound
	offset++
	buf[offset] = tyreAge
	offset++
	buf[offset] = 0 // VehicleFIAFlags
	offset++
	binary.LittleEndian.PutUint32(buf[offset:], math.Float32bits(520000))
	offset += 4
	binary.LittleEndian.PutUint32(buf[offset:], math.Float32bits(120000))
	offset += 4
	binary.LittleEndian.PutUint32(buf[offset:], math.Float32bits(ers))
	offset += 4
	buf[offset] = 1 // ERSDeployMode
	offset++
	binary.LittleEndian.PutUint32(buf[offset:], math.Float32bits(120000))
	offset += 4
	binary.LittleEndian.PutUint32(buf[offset:], math.Float32bits(85000))
	offset += 4
	binary.LittleEndian.PutUint32(buf[offset:], math.Float32bits(140000))
	offset += 4
	buf[offset] = 0 // NetworkPaused
}

func writeMarshalZone(buf []byte, offset int, start float32, flag int8) {
	binary.LittleEndian.PutUint32(buf[offset:offset+4], math.Float32bits(start))
	buf[offset+4] = byte(flag)
}

func writeForecast(buf []byte, offset int, sessionType uint8, timeOffset uint8, weather uint8, trackTemp int8, trackTrend int8, airTemp int8, airTrend int8, rain uint8) {
	buf[offset] = sessionType
	buf[offset+1] = timeOffset
	buf[offset+2] = weather
	buf[offset+3] = byte(trackTemp)
	buf[offset+4] = byte(trackTrend)
	buf[offset+5] = byte(airTemp)
	buf[offset+6] = byte(airTrend)
	buf[offset+7] = rain
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
