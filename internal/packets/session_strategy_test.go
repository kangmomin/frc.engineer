package packets

import "testing"

func TestSessionStrategySettingsKnownOnlyWithCompleteBlock(t *testing.T) {
	for _, format := range []uint16{2025, 2026} {
		h := &PacketHeader{PacketFormat: format}
		data := make([]byte, 725)
		data[708], data[711], data[714], data[724] = 1, 1, 1, 2
		data[694], data[695], data[700] = 7, 3, 5
		p, err := ParseSessionPacket(data, h)
		if err != nil || p.StrategyRules == nil || !p.StrategyRules.EqualPerformance || p.StrategyRules.RuleSet != 3 || p.StrategyRules.PitStopExperience != 2 {
			t.Fatalf("format=%d settings: %+v %v", format, p, err)
		}
		p, err = ParseSessionPacket(data[:724], h)
		if err != nil || p.StrategyRules != nil {
			t.Fatalf("truncated settings must remain unknown: %v", err)
		}
		data[708] = 2
		p, err = ParseSessionPacket(data, h)
		if err != nil || p.StrategyRules != nil {
			t.Fatal("invalid enum was promoted to a known false setting")
		}
	}
}
