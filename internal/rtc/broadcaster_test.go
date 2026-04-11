package rtc

import (
	"testing"

	"frc.engineer/internal/dto"
	"frc.engineer/internal/races"
	"frc.engineer/internal/signaling"
)

func TestPitwallBroadcastVariantsRespectPeerPermissions(t *testing.T) {
	state := dto.PitwallState{
		ERSEstimateEnabled:   true,
		ERSComparisonEnabled: true,
		Drivers: []dto.DriverInfo{
			{
				Index:               1,
				ERSStoreEnergy:      1520000,
				ERSDeployMode:       3,
				ERSDeployedThisLap:  640000,
				ERSHarvestedThisLap: 320000,
				ERSEstimatePct:      45,
				ERSEstimateReady:    true,
				ERSActualPct:        38,
				ERSActualReady:      true,
				PitStatus:           2,
				PitStopTimer:        4.2,
				PitLaneTime:         18234,
				TopSpeed:            334,
				DeltaToPlayer:       -842,
			},
		},
	}

	variants := &pitwallBroadcastVariants{
		cache: make(map[string][]byte),
		state: state,
	}

	privileged := decodePitwallState(t, variants.resolve(signaling.Permissions{
		ViewERSEstimate: true,
		ViewERSActual:   true,
		ViewPitStatus:   true,
		ViewTopSpeed:    true,
		ViewPlayerDelta: true,
	}, "cockpit"))
	if !privileged.ERSEstimateEnabled {
		t.Fatal("expected ERS estimate to be enabled for privileged peer")
	}
	if !privileged.ERSComparisonEnabled {
		t.Fatal("expected ERS comparison to remain enabled")
	}
	if privileged.Drivers[0].ERSStoreEnergy != 1520000 || privileged.Drivers[0].ERSDeployMode != 3 {
		t.Fatalf("expected ERS telemetry to remain visible, got %#v", privileged.Drivers[0])
	}
	if privileged.Drivers[0].ERSActualPct != 38 || !privileged.Drivers[0].ERSActualReady {
		t.Fatalf("expected ERS actual data to remain visible, got %#v", privileged.Drivers[0])
	}
	if privileged.Drivers[0].PitStatus != 2 || privileged.Drivers[0].PitLaneTime != 18234 {
		t.Fatalf("expected pit fields to remain visible, got %#v", privileged.Drivers[0])
	}
	if privileged.Drivers[0].TopSpeed != 334 || privileged.Drivers[0].DeltaToPlayer != -842 {
		t.Fatalf("expected top speed and player delta to remain visible, got %#v", privileged.Drivers[0])
	}

	restricted := decodePitwallState(t, variants.resolve(signaling.Permissions{}, "cockpit"))
	if restricted.ERSComparisonEnabled {
		t.Fatal("expected ERS comparison to be disabled")
	}
	if restricted.ERSEstimateEnabled {
		t.Fatal("expected ERS estimate to be disabled for restricted peer")
	}
	if restricted.Drivers[0].ERSEstimatePct != 0 || restricted.Drivers[0].ERSEstimateReady {
		t.Fatalf("expected ERS estimate data to be masked, got %#v", restricted.Drivers[0])
	}
	if restricted.Drivers[0].ERSActualPct != 0 || restricted.Drivers[0].ERSActualReady {
		t.Fatalf("expected ERS actual data to be masked, got %#v", restricted.Drivers[0])
	}
	if restricted.Drivers[0].ERSStoreEnergy != 0 || restricted.Drivers[0].ERSDeployMode != 0 || restricted.Drivers[0].ERSDeployedThisLap != 0 || restricted.Drivers[0].ERSHarvestedThisLap != 0 {
		t.Fatalf("expected ERS telemetry to be masked, got %#v", restricted.Drivers[0])
	}
	if restricted.Drivers[0].PitStatus != 0 || restricted.Drivers[0].PitStopTimer != 0 || restricted.Drivers[0].PitLaneTime != 0 {
		t.Fatalf("expected pit fields to be masked, got %#v", restricted.Drivers[0])
	}
	if restricted.Drivers[0].TopSpeed != 0 || restricted.Drivers[0].DeltaToPlayer != 0 {
		t.Fatalf("expected top speed and player delta to be masked, got %#v", restricted.Drivers[0])
	}
}

func TestRaceResultBroadcastVariantsRespectPeerPermissions(t *testing.T) {
	summary := &races.RaceSummary{
		Debrief: &races.RaceDebrief{
			Tyres: races.RaceTyreSummary{
				FinalSetWearPct:  58,
				LifeSpan:         24,
				UsableLife:       18,
				LifeRemainingPct: 63,
			},
		},
	}

	variants := &raceResultBroadcastVariants{
		cache:   make(map[string][]byte),
		summary: summary,
	}

	privileged := decodeRaceSummary(t, variants.resolve(signaling.Permissions{ViewAdvancedStrategy: true}))
	if privileged.Debrief == nil {
		t.Fatal("expected debrief payload for privileged peer")
	}
	if privileged.Debrief.Tyres.FinalSetWearPct != 58 || privileged.Debrief.Tyres.LifeSpan != 24 || privileged.Debrief.Tyres.UsableLife != 18 || privileged.Debrief.Tyres.LifeRemainingPct != 63 {
		t.Fatalf("expected advanced tyre data to remain visible, got %#v", privileged.Debrief.Tyres)
	}

	restricted := decodeRaceSummary(t, variants.resolve(signaling.Permissions{}))
	if restricted.Debrief == nil {
		t.Fatal("expected debrief payload for restricted peer")
	}
	if restricted.Debrief.Tyres.FinalSetWearPct != 0 || restricted.Debrief.Tyres.LifeSpan != 0 || restricted.Debrief.Tyres.UsableLife != 0 || restricted.Debrief.Tyres.LifeRemainingPct != 0 {
		t.Fatalf("expected advanced tyre data to be masked, got %#v", restricted.Debrief.Tyres)
	}
	if summary.Debrief.Tyres.FinalSetWearPct != 58 || summary.Debrief.Tyres.LifeSpan != 24 || summary.Debrief.Tyres.UsableLife != 18 || summary.Debrief.Tyres.LifeRemainingPct != 63 {
		t.Fatalf("expected original summary to remain unchanged, got %#v", summary.Debrief.Tyres)
	}
}

func decodePitwallState(t *testing.T, payload []byte) dto.PitwallState {
	t.Helper()

	var response dto.WSResponse
	if err := dto.MsgpackUnmarshal(payload, &response); err != nil {
		t.Fatalf("unmarshal response failed: %v", err)
	}
	data, err := dto.MsgpackMarshal(response.Data)
	if err != nil {
		t.Fatalf("marshal nested response data failed: %v", err)
	}
	var state dto.PitwallState
	if err := dto.MsgpackUnmarshal(data, &state); err != nil {
		t.Fatalf("unmarshal pitwall state failed: %v", err)
	}
	return state
}

func decodeRaceSummary(t *testing.T, payload []byte) races.RaceSummary {
	t.Helper()

	var response dto.WSResponse
	if err := dto.MsgpackUnmarshal(payload, &response); err != nil {
		t.Fatalf("unmarshal response failed: %v", err)
	}
	data, err := dto.MsgpackMarshal(response.Data)
	if err != nil {
		t.Fatalf("marshal nested response data failed: %v", err)
	}
	var summary races.RaceSummary
	if err := dto.MsgpackUnmarshal(data, &summary); err != nil {
		t.Fatalf("unmarshal race summary failed: %v", err)
	}
	return summary
}
