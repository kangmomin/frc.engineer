package telemetry

import (
	"testing"

	"frc.engineer/internal/dto"
)

func TestPitwallManagerBuildStateIncludesSenderState(t *testing.T) {
	pm := NewPitwallManager(NewStrategyManager(), nil, nil)
	pm.SetSenderState(dto.SenderState{
		SaveFiles:       true,
		TrackRecording:  false,
		RaceStorageMode: "resultOnly",
	})

	state := pm.BuildState()
	if state == nil {
		t.Fatal("expected pitwall state")
	}
	if state.SenderState == nil {
		t.Fatal("expected sender state in pitwall snapshot")
	}
	if !state.SenderState.SaveFiles {
		t.Fatal("expected saveFiles to be true")
	}
	if state.SenderState.TrackRecording {
		t.Fatal("expected trackRecording to be false")
	}
	if state.SenderState.RaceStorageMode != "resultOnly" {
		t.Fatalf("expected raceStorageMode to be resultOnly, got %q", state.SenderState.RaceStorageMode)
	}
}
