package telemetry

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"frc.engineer/internal/dto"
	"frc.engineer/internal/packets"
	"frc.engineer/internal/tracks"
)

func TestNewSessionFirstPacketClearsEveryOtherSource(t *testing.T) {
	header := packets.PacketHeader{SessionUID: 18446744073709551614, PacketFormat: 2026, PlayerCarIndex: 2}
	updates := map[string]func(*PitwallManager){
		"session":       func(pm *PitwallManager) { pm.UpdateSession(&packets.PacketSessionData{Header: header, TrackID: 3}) },
		"participants":  func(pm *PitwallManager) { pm.UpdateParticipants(&packets.PacketParticipantsData{Header: header}) },
		"motion":        func(pm *PitwallManager) { pm.UpdateMotion(&packets.PacketMotionData{Header: header}, 2) },
		"lapData":       func(pm *PitwallManager) { pm.UpdateLapData(&packets.PacketLapData{Header: header}) },
		"carStatus":     func(pm *PitwallManager) { pm.UpdateCarStatus(&packets.PacketCarStatusData{Header: header}) },
		"telemetry":     func(pm *PitwallManager) { pm.UpdateTelemetry(&packets.PacketCarTelemetryData{Header: header}) },
		"carTelemetry2": func(pm *PitwallManager) { pm.UpdateCarTelemetry2(&packets.PacketCarTelemetry2Data{Header: header}) },
		"carDamage":     func(pm *PitwallManager) { pm.UpdateCarDamage(&packets.PacketCarDamageData{Header: header}) },
		"carSetups":     func(pm *PitwallManager) { pm.UpdateCarSetups(&packets.PacketCarSetupData{Header: header}) },
		"motionEx":      func(pm *PitwallManager) { pm.UpdateMotionEx(&packets.PacketMotionExData{Header: header}) },
		"history":       func(pm *PitwallManager) { pm.UpdateSessionHistory(&packets.PacketSessionHistoryData{Header: header}) },
		"tyres":         func(pm *PitwallManager) { pm.UpdateTyreSets(&packets.PacketTyreSetsData{Header: header}) },
		"penalty":       func(pm *PitwallManager) { pm.RecordPenalty(&packets.PenaltyEvent{VehicleIdx: 2}, header.SessionUID) },
	}
	for first, update := range updates {
		t.Run(first, func(t *testing.T) {
			pm := NewPitwallManager(NewStrategyManager(), nil, nil)
			pm.UpdateSession(&packets.PacketSessionData{Header: packets.PacketHeader{SessionUID: 1}, TrackID: 0})
			pm.participants = &packets.PacketParticipantsData{}
			pm.motion = &packets.PacketMotionData{}
			pm.lapData = &packets.PacketLapData{}
			pm.carStatus = &packets.PacketCarStatusData{}
			pm.telemetry = &packets.PacketCarTelemetryData{}
			pm.carTelemetry2 = &packets.PacketCarTelemetry2Data{}
			pm.carDamage = &packets.PacketCarDamageData{}
			pm.carSetups = &packets.PacketCarSetupData{}
			pm.motionEx = &packets.PacketMotionExData{}
			pm.playerIndex, pm.peakActiveCars = 17, 24
			pm.ersEstimator.cars[0] = ersCarState{initialized: true, energyJ: 3000000, validSteps: 10, completedLaps: 2}
			update(pm)
			for field, pointer := range map[string]any{
				"session": pm.session, "participants": pm.participants, "motion": pm.motion,
				"lapData": pm.lapData, "carStatus": pm.carStatus, "telemetry": pm.telemetry,
				"carTelemetry2": pm.carTelemetry2, "carDamage": pm.carDamage, "carSetups": pm.carSetups, "motionEx": pm.motionEx,
			} {
				if field != first && !reflect.ValueOf(pointer).IsNil() {
					t.Fatalf("%s retained old %s", first, field)
				}
			}
			state := pm.BuildStateReadOnly()
			if state.SessionUID != "18446744073709551614" || state.PlayerIndex == 17 || state.Drivers[0].ERSEstimateReady {
				t.Fatalf("stale identity/estimate: %+v", state)
			}
			wire, err := json.Marshal(state)
			if err != nil || !strings.Contains(string(wire), `"sessionUid":"18446744073709551614"`) {
				t.Fatalf("UID lost wire precision: %s / %v", wire, err)
			}
		})
	}
}

func TestFirstTrackMapBuildKeepsNewSessionHistory(t *testing.T) {
	store := tracks.NewTrackStore(t.TempDir())
	store.LoadSingle(0, writeTrackLineCSV(t, 200))
	pm := NewPitwallManager(NewStrategyManager(), store, nil)
	header := packets.PacketHeader{SessionUID: 42, PacketFormat: 2026}
	pm.UpdateSession(&packets.PacketSessionData{Header: header, TrackID: 0})
	history := &packets.PacketSessionHistoryData{Header: header, NumLaps: 1, BestLapTimeLapNum: 1}
	history.LapHistoryData[0] = packets.LapHistoryData{LapTimeInMS: 90000, LapValidBitFlags: 15}
	pm.UpdateSessionHistory(history)
	state := pm.BuildState()
	if state.TrackMap == nil || state.Drivers[0].BestLapTime != 90000 || pm.sessionHistory[0] != history {
		t.Fatal("track map publication erased newly received lap history")
	}
}

func TestReplayCopiesSessionClockIdentityAndMutableMetadata(t *testing.T) {
	source := &dto.PitwallState{SessionUID: "18446744073709551614", Session: &dto.SessionInfo{
		SessionUID: "18446744073709551614", SessionType: "Q1", SessionTimeLeft: 600, SessionDuration: 1080,
		MarshalZones: []dto.MarshalZoneDTO{{Flag: 1}}, WeatherForecast: []dto.WeatherForecastDTO{{RainPercentage: 80}},
		CrossoverPrediction: &dto.CrossoverPredictionDTO{Available: true},
	}}
	frame, metadata := copyPitwallForReplay(source), copySessionInfo(source.Session)
	source.Session.MarshalZones[0].Flag = 2
	source.Session.WeatherForecast[0].RainPercentage = 0
	source.Session.CrossoverPrediction.Available = false
	for _, session := range []*dto.SessionInfo{frame.Session, metadata} {
		if session.SessionTimeLeft != 600 || session.SessionDuration != 1080 || session.SessionUID != frame.SessionUID ||
			session.MarshalZones[0].Flag != 1 || session.WeatherForecast[0].RainPercentage != 80 || !session.CrossoverPrediction.Available {
			t.Fatalf("replay metadata was lost or aliased: %+v", session)
		}
	}
}

func TestQualifyingFormatUsesObservedRoster(t *testing.T) {
	for _, formula := range []uint8{0, 13, 2, 3, 8, 9, 255} {
		for _, count := range []uint8{0, 10, 16, 17, 20, 22, 24} {
			pm := NewPitwallManager(NewStrategyManager(), nil, nil)
			header := packets.PacketHeader{SessionUID: 10, PacketFormat: 2026}
			pm.UpdateSession(&packets.PacketSessionData{Header: header, Formula: formula, SessionType: 6})
			pm.UpdateParticipants(&packets.PacketParticipantsData{Header: header, NumActiveCars: count})
			got := pm.BuildStateReadOnly().Session
			want := 0
			if (formula == 0 || formula == 13) && (count == 20 || count == 22 || count == 24) {
				want = int(count)
			}
			if got.Formula != formula || got.QualifyingGridSize != want {
				t.Fatalf("formula=%d roster=%d: %+v", formula, count, got)
			}
			// A shrinking live array retains the observed roster, but a new UID does not.
			pm.UpdateParticipants(&packets.PacketParticipantsData{Header: header, NumActiveCars: 10})
			if pm.BuildStateReadOnly().Session.QualifyingGridSize != want {
				t.Fatal("transient participant shrink changed format")
			}
			header.SessionUID++
			pm.UpdateSession(&packets.PacketSessionData{Header: header, Formula: formula, SessionType: 6})
			if pm.BuildStateReadOnly().Session.QualifyingGridSize != 0 {
				t.Fatal("new session inherited roster")
			}
		}
	}
}
