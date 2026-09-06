package packets

import "testing"

func TestOfficialBestValidityAndSectorMinutes(t *testing.T) {
	p := &PacketSessionHistoryData{NumLaps: 1, BestLapTimeLapNum: 1, BestSector1LapNum: 1, BestSector2LapNum: 1, BestSector3LapNum: 1}
	p.LapHistoryData[0] = LapHistoryData{LapTimeInMS: 150000, Sector1TimeMinPart: 1, Sector1TimeMSPart: 10000, Sector2TimeMSPart: 40000, Sector3TimeMSPart: 40000, LapValidBitFlags: 2}
	if p.BestLapMS() != 0 || p.BestSectorMS(1) == nil || *p.BestSectorMS(1) != 70000 || p.BestSectorMS(2) != nil || p.BestSectorMS(3) != nil {
		t.Fatal("independent validity or minute conversion failed")
	}
	p.LapHistoryData[0].LapValidBitFlags = 1
	if p.BestLapMS() != 150000 || p.BestSectorMS(1) != nil {
		t.Fatal("whole lap bit accepted an invalid sector")
	}
	p.BestLapTimeLapNum = 2
	if p.BestLapMS() != 0 {
		t.Fatal("out of range best accepted")
	}
}

func TestSessionFormulaWireOffset(t *testing.T) {
	for _, format := range []uint16{2025, 2026} {
		raw := make([]byte, MinSessionPacketSize)
		raw[PacketHeaderSize+8] = 13
		session, err := ParseSessionPacket(raw, &PacketHeader{PacketFormat: format})
		if err != nil || session.Formula != 13 {
			t.Fatalf("formula: %+v %v", session, err)
		}
	}
}
