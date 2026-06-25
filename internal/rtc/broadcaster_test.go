package rtc

import (
	"testing"

	"frc.engineer/internal/dto"
)

func TestPitwallBroadcastVariantsPassThroughTelemetry(t *testing.T) {
	state := dto.PitwallState{
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
				DriverStatus:        4,
				ResultStatus:        5,
			},
		},
	}

	variants := &pitwallBroadcastVariants{
		cache: make(map[string][]byte),
		state: state,
	}

	cockpit := decodePitwallState(t, variants.resolve("cockpit"))
	if !cockpit.ERSEstimateEnabled {
		t.Fatal("expected ERS estimate to be enabled")
	}
	if !cockpit.ERSComparisonEnabled {
		t.Fatal("expected ERS comparison to be enabled when actual data is present")
	}

	d := cockpit.Drivers[0]
	if d.ERSStoreEnergy != 1520000 || d.ERSDeployMode != 3 || d.ERSDeployedThisLap != 640000 || d.ERSHarvestedThisLap != 320000 {
		t.Fatalf("expected ERS telemetry to pass through, got %#v", d)
	}
	if d.ERSActualPct != 38 || !d.ERSActualReady {
		t.Fatalf("expected ERS actual data to pass through, got %#v", d)
	}
	if d.ERSEstimatePct != 45 || !d.ERSEstimateReady {
		t.Fatalf("expected ERS estimate data to pass through, got %#v", d)
	}
	if d.PitStatus != 2 || d.PitStopTimer != 4.2 || d.PitLaneTime != 18234 {
		t.Fatalf("expected pit fields to pass through, got %#v", d)
	}
	if d.TopSpeed != 334 || d.DeltaToPlayer != -842 {
		t.Fatalf("expected top speed and player delta to pass through, got %#v", d)
	}
	// View-based masking (not permission-based): cockpit hides DriverStatus,
	// and ResultStatus is always masked.
	if d.DriverStatus != 0 {
		t.Fatalf("expected DriverStatus to be masked in cockpit view, got %d", d.DriverStatus)
	}
	if d.ResultStatus != 0 {
		t.Fatalf("expected ResultStatus to always be masked, got %d", d.ResultStatus)
	}
}

func TestPitwallBroadcastVariantsQualifyingKeepsDriverStatus(t *testing.T) {
	state := dto.PitwallState{
		Drivers: []dto.DriverInfo{
			{Index: 1, DriverStatus: 4},
		},
	}

	variants := &pitwallBroadcastVariants{
		cache: make(map[string][]byte),
		state: state,
	}

	quali := decodePitwallState(t, variants.resolve("qualifying"))
	if quali.Drivers[0].DriverStatus != 4 {
		t.Fatalf("expected DriverStatus to be preserved in qualifying view, got %d", quali.Drivers[0].DriverStatus)
	}

	cockpit := decodePitwallState(t, variants.resolve("cockpit"))
	if cockpit.Drivers[0].DriverStatus != 0 {
		t.Fatalf("expected DriverStatus to be masked in cockpit view, got %d", cockpit.Drivers[0].DriverStatus)
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
