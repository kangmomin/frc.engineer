package packets

import (
	"encoding/binary"
	"math"
	"testing"
)

// makeHeader builds a 29-byte packet header for the given format/packetID.
func makeHeader(format uint16, packetID PacketID, playerIdx uint8) []byte {
	buf := make([]byte, PacketHeaderSize)
	binary.LittleEndian.PutUint16(buf[0:2], format)
	if format == PacketFormat2026 {
		buf[2] = 26
	} else {
		buf[2] = 25
	}
	buf[5] = 1
	buf[6] = uint8(packetID)
	binary.LittleEndian.PutUint64(buf[7:15], 12345)
	buf[27] = playerIdx
	buf[28] = 255
	return buf
}

func TestSpecFor(t *testing.T) {
	spec25, ok := SpecFor(PacketFormat2025)
	if !ok || spec25.NumCars != 22 {
		t.Fatalf("2025 spec = %+v, ok=%v", spec25, ok)
	}
	spec26, ok := SpecFor(PacketFormat2026)
	if !ok || spec26.NumCars != 24 {
		t.Fatalf("2026 spec = %+v, ok=%v", spec26, ok)
	}
	if _, ok := SpecFor(2024); ok {
		t.Fatal("2024 must be unsupported")
	}
	if IsSupportedFormat(2024) || !IsSupportedFormat(2025) || !IsSupportedFormat(2026) {
		t.Fatal("IsSupportedFormat mismatch")
	}
}

func TestParseCarTelemetry2Packet(t *testing.T) {
	data := makeHeader(PacketFormat2026, PacketIDCarTelemetry2, 0)
	body := make([]byte, 24*CarTelemetry2DataSize)
	// 마지막 차량(인덱스 23)에 식별 가능한 값 기록
	off := 23 * CarTelemetry2DataSize
	body[off+0] = 1 // ActiveAeroMode = straight(X)
	body[off+1] = 1
	binary.LittleEndian.PutUint16(body[off+2:], 321)
	body[off+4] = 1
	body[off+5] = 1 // OvertakeActive
	binary.LittleEndian.PutUint16(body[off+6:], 88)
	body[off+8] = 1
	body[off+9] = 0
	data = append(data, body...)

	if len(data) != 269 {
		t.Fatalf("packet size = %d, want 269", len(data))
	}

	header, err := ParseHeader(data)
	if err != nil {
		t.Fatal(err)
	}
	pkt, err := ParseCarTelemetry2Packet(data, header)
	if err != nil {
		t.Fatal(err)
	}
	car := pkt.CarTelemetry2Data[23]
	if car.ActiveAeroMode != 1 || car.OvertakeActive != 1 {
		t.Fatalf("car23 = %+v", car)
	}
	if car.ActiveAeroActivationDistance != 321 || car.OvertakeActivationDistance != 88 {
		t.Fatalf("distances = %d/%d", car.ActiveAeroActivationDistance, car.OvertakeActivationDistance)
	}
	if pkt.CarTelemetry2Data[0].OvertakeActive != 0 {
		t.Fatal("car0 must be zero")
	}
}

func TestParseCarTelemetryPacket2026(t *testing.T) {
	const carSize = 59
	data := makeHeader(PacketFormat2026, PacketIDCarTelemetry, 0)
	body := make([]byte, 24*carSize+3)
	// 인덱스 23: speed=300, engineTemp(u8)=110, 마지막 surfaceType=7
	off := 23 * carSize
	binary.LittleEndian.PutUint16(body[off:], 300)
	body[off+38] = 110 // engineTemperature (u8, car struct 내 오프셋 38)
	body[off+58] = 7   // surfaceType[3]
	body[24*carSize+2] = 0xFF
	data = append(data, body...)

	if len(data) != 1448 {
		t.Fatalf("packet size = %d, want 1448", len(data))
	}

	header, _ := ParseHeader(data)
	pkt, err := ParseCarTelemetryPacket(data, header)
	if err != nil {
		t.Fatal(err)
	}
	car := pkt.CarTelemetryData[23]
	if car.Speed != 300 {
		t.Fatalf("speed = %d", car.Speed)
	}
	if car.EngineTemperature != 110 {
		t.Fatalf("engineTemp = %d", car.EngineTemperature)
	}
	if car.SurfaceType[3] != 7 {
		t.Fatalf("surfaceType[3] = %d", car.SurfaceType[3])
	}
	if pkt.SuggestedGear != -1 {
		t.Fatalf("suggestedGear = %d, want -1 (0xFF)", pkt.SuggestedGear)
	}
}

func TestParseMotionPacket2026(t *testing.T) {
	const carSize = 54
	data := makeHeader(PacketFormat2026, PacketIDMotion, 0)
	body := make([]byte, 24*carSize)
	off := 23 * carSize
	binary.LittleEndian.PutUint32(body[off:], math.Float32bits(123.5)) // worldPositionX
	// 양자화 G-force: lateral = -1.25 → -1250
	gLat := int16(-1250)
	binary.LittleEndian.PutUint16(body[off+36:], uint16(gLat))
	binary.LittleEndian.PutUint32(body[off+42:], math.Float32bits(1.57)) // yaw
	data = append(data, body...)

	if len(data) != 1325 {
		t.Fatalf("packet size = %d, want 1325", len(data))
	}

	header, _ := ParseHeader(data)
	pkt, err := ParseMotionPacket(data, header)
	if err != nil {
		t.Fatal(err)
	}
	car := pkt.CarMotionData[23]
	if car.WorldPositionX != 123.5 {
		t.Fatalf("posX = %f", car.WorldPositionX)
	}
	if math.Abs(float64(car.GForceLateral)-(-1.25)) > 1e-6 {
		t.Fatalf("gLat = %f, want -1.25", car.GForceLateral)
	}
	if math.Abs(float64(car.Yaw)-1.57) > 1e-6 {
		t.Fatalf("yaw = %f", car.Yaw)
	}
}

func TestParseCarStatusPacket2026(t *testing.T) {
	const carSize = 59
	data := makeHeader(PacketFormat2026, PacketIDCarStatus, 0)
	body := make([]byte, 24*carSize)
	off := 23 * carSize
	// ersStoreEnergy (offset 37), ersHarvestLimitPerLap (offset 54), networkPaused (offset 58)
	binary.LittleEndian.PutUint32(body[off+37:], math.Float32bits(3_500_000))
	binary.LittleEndian.PutUint32(body[off+54:], math.Float32bits(2_000_000))
	body[off+58] = 1
	data = append(data, body...)

	if len(data) != 1445 {
		t.Fatalf("packet size = %d, want 1445", len(data))
	}

	header, _ := ParseHeader(data)
	pkt, err := ParseCarStatusPacket(data, header)
	if err != nil {
		t.Fatal(err)
	}
	car := pkt.CarStatusData[23]
	if car.ERSStoreEnergy != 3_500_000 {
		t.Fatalf("ersStore = %f", car.ERSStoreEnergy)
	}
	if car.ERSHarvestLimitPerLap != 2_000_000 {
		t.Fatalf("harvestLimit = %f", car.ERSHarvestLimitPerLap)
	}
	if car.NetworkPaused != 1 {
		t.Fatalf("networkPaused = %d", car.NetworkPaused)
	}
}

func TestParseParticipantsPacket2026(t *testing.T) {
	const carSize = 60
	data := makeHeader(PacketFormat2026, PacketIDParticipants, 0)
	body := make([]byte, 1+24*carSize)
	body[0] = 24
	off := 1 + 23*carSize
	body[off] = 1                                       // aiControlled
	binary.LittleEndian.PutUint16(body[off+1:], 300)    // driverId (u16)
	binary.LittleEndian.PutUint16(body[off+5:], 486)    // teamId = Cadillac '26
	copy(body[off+10:], []byte("Bottas"))               // name
	data = append(data, body...)

	if len(data) != 1470 {
		t.Fatalf("packet size = %d, want 1470", len(data))
	}

	header, _ := ParseHeader(data)
	pkt, err := ParseParticipantsPacket(data, header)
	if err != nil {
		t.Fatal(err)
	}
	p := pkt.Participants[23]
	if p.TeamID != 486 {
		t.Fatalf("teamId = %d, want 486", p.TeamID)
	}
	if p.DriverID != 300 {
		t.Fatalf("driverId = %d, want 300", p.DriverID)
	}
	if p.GetName() != "Bottas" {
		t.Fatalf("name = %q", p.GetName())
	}
}

func TestParse2025StillWorks(t *testing.T) {
	// F1 25 텔레메트리: 22대 × 60B + footer 3
	data := makeHeader(PacketFormat2025, PacketIDCarTelemetry, 0)
	body := make([]byte, 22*60+3)
	off := 21 * 60
	binary.LittleEndian.PutUint16(body[off:], 280)
	binary.LittleEndian.PutUint16(body[off+38:], 105) // engineTemp (u16, car struct 내 오프셋 38)
	data = append(data, body...)

	if len(data) != 1352 {
		t.Fatalf("packet size = %d, want 1352", len(data))
	}

	header, _ := ParseHeader(data)
	pkt, err := ParseCarTelemetryPacket(data, header)
	if err != nil {
		t.Fatal(err)
	}
	if pkt.CarTelemetryData[21].Speed != 280 {
		t.Fatalf("speed = %d", pkt.CarTelemetryData[21].Speed)
	}
	if pkt.CarTelemetryData[21].EngineTemperature != 105 {
		t.Fatalf("engineTemp = %d", pkt.CarTelemetryData[21].EngineTemperature)
	}
	// 2025 패킷에서 인덱스 22-23은 zero-value로 남아야 한다
	if pkt.CarTelemetryData[23].Speed != 0 {
		t.Fatal("index 23 must stay zero for 2025 packets")
	}
}

func TestCanonicalTrackID(t *testing.T) {
	cases := []struct {
		format uint16
		in     int8
		want   int8
	}{
		{PacketFormat2025, 8, 8},   // 2025는 변환 없음
		{PacketFormat2026, 9, 8},   // Hungary
		{PacketFormat2026, 10, 9},  // Belgium
		{PacketFormat2026, 31, 28}, // Las Vegas
		{PacketFormat2026, 32, 27}, // Qatar
		{PacketFormat2026, 42, 42}, // Madrid (신규, 통과)
		{PacketFormat2026, 0, 0},   // Melbourne (동일)
	}
	for _, c := range cases {
		if got := CanonicalTrackID(c.format, c.in); got != c.want {
			t.Errorf("CanonicalTrackID(%d, %d) = %d, want %d", c.format, c.in, got, c.want)
		}
	}
}
