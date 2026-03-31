package rtc

import (
	"encoding/json"
	"testing"

	"frc.engineer/internal/dto"
	"frc.engineer/internal/signaling"
)

func TestPitwallBroadcastVariantsRespectPeerPermissions(t *testing.T) {
	message, err := json.Marshal(dto.WSResponse{
		Type: dto.MessageTypePitwallState,
		Data: dto.PitwallState{
			ERSEstimateEnabled:   true,
			ERSComparisonEnabled: true,
			Drivers: []dto.DriverInfo{
				{
					Index:            1,
					ERSEstimatePct:   45,
					ERSEstimateReady: true,
					ERSActualPct:     38,
					ERSActualReady:   true,
					PitStatus:      2,
					PitStopTimer:   4.2,
					PitLaneTime:    18234,
					TopSpeed:       334,
					DeltaToPlayer:  -842,
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("marshal input failed: %v", err)
	}

	variants, ok := buildPitwallBroadcastVariants(message)
	if !ok {
		t.Fatal("expected pitwall broadcast variants")
	}

	privileged := decodePitwallState(t, variants.resolve(signaling.Permissions{
		ViewERSEstimate: true,
		ViewERSActual:   true,
		ViewPitStatus:   true,
		ViewTopSpeed:    true,
		ViewPlayerDelta: true,
		ViewCommentary:  true,
		ViewQualifying:  true,
	}))
	if !privileged.ERSComparisonEnabled {
		t.Fatal("expected ERS comparison to remain enabled")
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

	restricted := decodePitwallState(t, variants.resolve(signaling.Permissions{}))
	if restricted.ERSComparisonEnabled {
		t.Fatal("expected ERS comparison to be disabled")
	}
	if restricted.Drivers[0].ERSEstimatePct != 0 || restricted.Drivers[0].ERSEstimateReady {
		t.Fatalf("expected ERS estimate data to be masked, got %#v", restricted.Drivers[0])
	}
	if restricted.Drivers[0].ERSActualPct != 0 || restricted.Drivers[0].ERSActualReady {
		t.Fatalf("expected ERS actual data to be masked, got %#v", restricted.Drivers[0])
	}
	if restricted.Drivers[0].PitStatus != 0 || restricted.Drivers[0].PitStopTimer != 0 || restricted.Drivers[0].PitLaneTime != 0 {
		t.Fatalf("expected pit fields to be masked, got %#v", restricted.Drivers[0])
	}
	if restricted.Drivers[0].TopSpeed != 0 || restricted.Drivers[0].DeltaToPlayer != 0 {
		t.Fatalf("expected top speed and player delta to be masked, got %#v", restricted.Drivers[0])
	}
}

func decodePitwallState(t *testing.T, payload []byte) dto.PitwallState {
	t.Helper()

	var response dto.WSResponse
	if err := json.Unmarshal(payload, &response); err != nil {
		t.Fatalf("unmarshal response failed: %v", err)
	}
	data, err := json.Marshal(response.Data)
	if err != nil {
		t.Fatalf("marshal nested response data failed: %v", err)
	}
	var state dto.PitwallState
	if err := json.Unmarshal(data, &state); err != nil {
		t.Fatalf("unmarshal pitwall state failed: %v", err)
	}
	return state
}
