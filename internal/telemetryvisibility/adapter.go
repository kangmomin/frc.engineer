package telemetryvisibility

import (
	"fmt"
	"math"
	"time"

	extdto "frc.pitwall.parser/telemetry-go/dto"
	extpackets "frc.pitwall.parser/telemetry-go/packets"
	extmodel "frc.pitwall.parser/telemetry-go/telemetrymodel"

	"frc.engineer/internal/dto"
	"frc.engineer/internal/packets"
)

// Mode controls which visibility profile is applied.
type Mode string

const (
	ModePublic Mode = "public"
	ModeStrict Mode = "strict"
)

var gameToDisplayWheelIndex = [4]int{2, 3, 0, 1}

// Snapshot contains the local parser outputs needed to build an external envelope.
type Snapshot struct {
	CapturedAt     time.Time
	PlayerCarIndex *uint8

	Header              *packets.PacketHeader
	Session             *packets.PacketSessionData
	LastEvent           *packets.PacketEventData
	Participants        *packets.PacketParticipantsData
	Motion              *packets.PacketMotionData
	LapData             *packets.PacketLapData
	CarSetups           *packets.PacketCarSetupData
	CarTelemetry        *packets.PacketCarTelemetryData
	CarStatus           *packets.PacketCarStatusData
	CarDamage           *packets.PacketCarDamageData
	SessionHistoryByCar map[uint8]*packets.PacketSessionHistoryData
	TyreSetsByCar       map[uint8]*packets.PacketTyreSetsData

	Drivers []dto.DriverInfo
}

// ParseSnapshot adapts the local snapshot into the external parser envelope and applies visibility rules.
func ParseSnapshot(snapshot Snapshot, mode Mode) extmodel.FullTelemetryEnvelope {
	env := BuildEnvelope(snapshot)
	return extmodel.ParseEnvelope(env, extmodel.ParseOptions{
		Mode:           toExternalMode(mode),
		PlayerCarIndex: snapshot.PlayerCarIndex,
	})
}

// BuildEnvelope adapts the local snapshot into the external parser envelope without applying visibility rules.
func BuildEnvelope(snapshot Snapshot) extmodel.FullTelemetryEnvelope {
	carCount := detectCarCount(snapshot)
	env := extmodel.FullTelemetryEnvelope{
		CapturedAt:          snapshot.CapturedAt,
		Header:              convertHeader(snapshot.Header),
		Session:             convertSession(snapshot.Session),
		LastEvent:           convertEvent(snapshot.LastEvent),
		Participants:        convertParticipants(snapshot.Participants, carCount),
		Motion:              convertMotion(snapshot.Motion, carCount),
		LapData:             convertLapData(snapshot.LapData, carCount),
		CarSetups:           convertCarSetups(snapshot.CarSetups, carCount),
		CarTelemetry:        convertCarTelemetry(snapshot.CarTelemetry, carCount),
		CarStatus:           convertCarStatus(snapshot.CarStatus, carCount),
		CarDamage:           convertCarDamage(snapshot.CarDamage, carCount),
		SessionHistoryByCar: convertSessionHistory(snapshot.SessionHistoryByCar),
		TyreSetsByCar:       convertTyreSets(snapshot.TyreSetsByCar),
		Cars:                convertSourceCars(snapshot, carCount),
	}
	if env.CapturedAt.IsZero() {
		env.CapturedAt = time.Now().UTC()
	}
	return env
}

func toExternalMode(mode Mode) extmodel.ParseMode {
	if mode == ModePublic {
		return extmodel.ParseModePublic
	}
	return extmodel.ParseModeStrict
}

func detectCarCount(snapshot Snapshot) int {
	maxCount := 0
	if snapshot.Participants != nil && snapshot.Participants.NumActiveCars > 0 {
		maxCount = int(snapshot.Participants.NumActiveCars)
	}
	if len(snapshot.Drivers) > maxCount {
		maxCount = len(snapshot.Drivers)
	}
	if snapshot.PlayerCarIndex != nil && int(*snapshot.PlayerCarIndex)+1 > maxCount {
		maxCount = int(*snapshot.PlayerCarIndex) + 1
	}
	for idx := range snapshot.SessionHistoryByCar {
		if int(idx)+1 > maxCount {
			maxCount = int(idx) + 1
		}
	}
	for idx := range snapshot.TyreSetsByCar {
		if int(idx)+1 > maxCount {
			maxCount = int(idx) + 1
		}
	}
	if maxCount > packets.MaxCars {
		maxCount = packets.MaxCars
	}
	return maxCount
}

func convertHeader(in *packets.PacketHeader) *extpackets.PacketHeader {
	if in == nil {
		return nil
	}
	return &extpackets.PacketHeader{
		PacketFormat:            in.PacketFormat,
		GameYear:                uint16(in.GameYear),
		GameMajorVersion:        in.GameMajorVersion,
		GameMinorVersion:        in.GameMinorVersion,
		PacketVersion:           in.PacketVersion,
		PacketID:                uint8(in.PacketID),
		SessionUID:              in.SessionUID,
		SessionTime:             in.SessionTime,
		FrameIdentifier:         in.FrameIdentifier,
		OverallFrameIdentifier:  in.OverallFrameIdentifier,
		PlayerCarIndex:          in.PlayerCarIndex,
		SecondaryPlayerCarIndex: in.SecondaryPlayerCarIndex,
	}
}

func convertSession(in *packets.PacketSessionData) *extpackets.PacketSessionData {
	if in == nil {
		return nil
	}
	return &extpackets.PacketSessionData{
		Weather:          in.Weather,
		TrackTemperature: in.TrackTemperature,
		AirTemperature:   in.AirTemperature,
		TotalLaps:        in.TotalLaps,
		TrackLength:      in.TrackLength,
		SessionType:      in.SessionType,
		TrackID:          in.TrackID,
		PitSpeedLimit:    0,
	}
}

func convertEvent(in *packets.PacketEventData) *extpackets.PacketEventData {
	if in == nil {
		return nil
	}
	return &extpackets.PacketEventData{
		EventStringCode: in.EventStringCode,
		Details:         formatEventDetails(in.EventDetails),
	}
}

func convertParticipants(in *packets.PacketParticipantsData, carCount int) *extpackets.PacketParticipantsData {
	if in == nil || carCount == 0 {
		return nil
	}
	out := &extpackets.PacketParticipantsData{
		Participants: make([]extpackets.ParticipantData, carCount),
	}
	for i := 0; i < carCount; i++ {
		src := in.Participants[i]
		out.Participants[i] = extpackets.ParticipantData{
			AiControlled:  src.AIControlled == 1,
			DriverID:      src.DriverID,
			NetworkID:     src.NetworkID,
			TeamID:        int(src.TeamID),
			Name:          src.GetName(),
			YourTelemetry: src.YourTelemetry,
		}
	}
	return out
}

func convertMotion(in *packets.PacketMotionData, carCount int) *extpackets.PacketMotionData {
	if in == nil || carCount == 0 {
		return nil
	}
	out := &extpackets.PacketMotionData{
		CarMotionData: make([]extpackets.CarMotionData, carCount),
	}
	for i := 0; i < carCount; i++ {
		src := in.CarMotionData[i]
		out.CarMotionData[i] = extpackets.CarMotionData{
			WorldPositionX:     src.WorldPositionX,
			WorldPositionY:     src.WorldPositionY,
			WorldPositionZ:     src.WorldPositionZ,
			WorldVelocityX:     src.WorldVelocityX,
			WorldVelocityY:     src.WorldVelocityY,
			WorldVelocityZ:     src.WorldVelocityZ,
			GForceLateral:      src.GForceLateral,
			GForceLongitudinal: src.GForceLongitudinal,
			GForceVertical:     src.GForceVertical,
			Yaw:                src.Yaw,
			Pitch:              src.Pitch,
			Roll:               src.Roll,
		}
	}
	return out
}

func convertLapData(in *packets.PacketLapData, carCount int) *extpackets.PacketLapData {
	if in == nil || carCount == 0 {
		return nil
	}
	out := &extpackets.PacketLapData{
		LapData: make([]extpackets.LapData, carCount),
	}
	for i := 0; i < carCount; i++ {
		src := in.LapData[i]
		out.LapData[i] = extpackets.LapData{
			Position:                   int(src.CarPosition),
			CurrentLapNum:              int(src.CurrentLapNum),
			LapDistance:                src.LapDistance,
			LastLapTime:                float32(src.LastLapTimeInMS),
			BestLapTime:                0,
			Sector1TimeMs:              int(src.Sector1TimeMinutes)*60000 + int(src.Sector1TimeInMS),
			Sector2TimeMs:              int(src.Sector2TimeMinutes)*60000 + int(src.Sector2TimeInMS),
			CurrentSector:              int(src.Sector),
			DeltaToCarInFront:          int(src.DeltaToCarInFrontMinutesPart)*60000 + int(src.DeltaToCarInFrontMSPart),
			DeltaToRaceLeader:          int(src.DeltaToRaceLeaderMinutesPart)*60000 + int(src.DeltaToRaceLeaderMSPart),
			PitStatus:                  int(src.PitStatus),
			DriverStatus:               int(src.DriverStatus),
			ResultStatus:               int(src.ResultStatus),
			NumPitStops:                int(src.NumPitStops),
			PitStopTimer:               float32(src.PitStopTimerInMS) / 1000,
			PitLaneTime:                int(src.PitLaneTimeInLaneInMS),
			Penalties:                  int(src.Penalties),
			TotalWarnings:              int(src.TotalWarnings),
			CornerCuttingWarnings:      int(src.CornerCuttingWarnings),
			NumUnservedDriveThroughs:   int(src.NumUnservedDriveThroughs),
			NumUnservedStopGoPenalties: int(src.NumUnservedStopGoPenalties),
			LapInvalid:                 src.CurrentLapInvalid == 1,
		}
	}
	return out
}

func convertCarSetups(in *packets.PacketCarSetupData, carCount int) *extpackets.PacketCarSetupData {
	if in == nil || carCount == 0 {
		return nil
	}
	out := &extpackets.PacketCarSetupData{
		CarSetups: make([]extpackets.CarSetupData, carCount),
	}
	for i := 0; i < carCount; i++ {
		src := in.CarSetupData[i]
		out.CarSetups[i] = extpackets.CarSetupData{
			FrontWing:              src.FrontWing,
			RearWing:               src.RearWing,
			OnThrottle:             src.OnThrottle,
			DiffOnThrottle:         src.OnThrottle,
			OffThrottle:            src.OffThrottle,
			FrontCamber:            src.FrontCamber,
			RearCamber:             src.RearCamber,
			FrontToe:               src.FrontToe,
			RearToe:                src.RearToe,
			FrontSuspension:        src.FrontSuspension,
			RearSuspension:         src.RearSuspension,
			FrontAntiRollBar:       src.FrontAntiRollBar,
			RearAntiRollBar:        src.RearAntiRollBar,
			FrontSuspensionHeight:  src.FrontSuspensionHeight,
			RearSuspensionHeight:   src.RearSuspensionHeight,
			BrakePressure:          src.BrakePressure,
			BrakeBias:              src.BrakeBias,
			RearLeftTyrePressure:   src.RearLeftTyrePressure,
			RearRightTyrePressure:  src.RearRightTyrePressure,
			FrontLeftTyrePressure:  src.FrontLeftTyrePressure,
			FrontRightTyrePressure: src.FrontRightTyrePressure,
			Ballast:                src.Ballast,
			FuelLoad:               src.FuelLoad,
		}
	}
	return out
}

func convertCarTelemetry(in *packets.PacketCarTelemetryData, carCount int) *extpackets.PacketCarTelemetryData {
	if in == nil || carCount == 0 {
		return nil
	}
	out := &extpackets.PacketCarTelemetryData{
		CarTelemetryData: make([]extpackets.CarTelemetryData, carCount),
	}
	for i := 0; i < carCount; i++ {
		src := in.CarTelemetryData[i]
		dst := extpackets.CarTelemetryData{
			Speed:     src.Speed,
			Throttle:  src.Throttle,
			Brake:     src.Brake,
			Steering:  src.Steer,
			Gear:      src.Gear,
			EngineRPM: src.EngineRPM,
			DRS:       src.DRS,
		}
		for wheel := 0; wheel < len(gameToDisplayWheelIndex); wheel++ {
			gameIdx := gameToDisplayWheelIndex[wheel]
			dst.BrakeTemp[wheel] = src.BrakesTemperature[gameIdx]
			dst.TireSurfaceTemp[wheel] = src.TyresSurfaceTemperature[gameIdx]
			dst.TireInnerTemp[wheel] = src.TyresInnerTemperature[gameIdx]
			dst.TirePressure[wheel] = src.TyresPressure[gameIdx]
			dst.SurfaceType[wheel] = src.SurfaceType[gameIdx]
		}
		out.CarTelemetryData[i] = dst
	}
	return out
}

func convertCarStatus(in *packets.PacketCarStatusData, carCount int) *extpackets.PacketCarStatusData {
	if in == nil || carCount == 0 {
		return nil
	}
	out := &extpackets.PacketCarStatusData{
		CarStatusData: make([]extpackets.CarStatusData, carCount),
	}
	for i := 0; i < carCount; i++ {
		src := in.CarStatusData[i]
		out.CarStatusData[i] = extpackets.CarStatusData{
			TractionControl:    src.TractionControl,
			AntiLockBrakes:     src.AntiLockBrakes,
			FuelMix:            src.FuelMix,
			BrakeBias:          src.FrontBrakeBias,
			PitLimiterStatus:   src.PitLimiterStatus,
			FuelInTank:         src.FuelInTank,
			FuelCapacity:       src.FuelCapacity,
			FuelRemainingLaps:  src.FuelRemainingLaps,
			MaxRPM:             src.MaxRPM,
			IdleRPM:            src.IdleRPM,
			MaxGears:           src.MaxGears,
			DRSAllowed:         src.DRSAllowed,
			ActualTyreCompound: src.ActualTyreCompound,
			VisualTyreCompound: src.VisualTyreCompound,
			TireAge:            src.TyresAgeLaps,
			VehicleFiaFlags:    src.VehicleFIAFlags,
			ERSStoreEnergy:     src.ERSStoreEnergy,
			ERSDeployMode:      src.ERSDeployMode,
			ERSHarvestedMGUK:   src.ERSHarvestedThisLapMGUK,
			ERSHarvestedMGUH:   src.ERSHarvestedThisLapMGUH,
			ERSDeployedThisLap: src.ERSDeployedThisLap,
		}
	}
	return out
}

func convertCarDamage(in *packets.PacketCarDamageData, carCount int) *extpackets.PacketCarDamageData {
	if in == nil || carCount == 0 {
		return nil
	}
	out := &extpackets.PacketCarDamageData{
		CarDamageData: make([]extpackets.CarDamageData, carCount),
	}
	for i := 0; i < carCount; i++ {
		src := in.CarDamageData[i]
		dst := extpackets.CarDamageData{
			TiresDamage:          src.TyresDamage,
			BrakesDamage:         src.BrakesDamage,
			FrontLeftWingDamage:  src.FrontLeftWingDamage,
			FrontRightWingDamage: src.FrontRightWingDamage,
			RearWingDamage:       src.RearWingDamage,
			FloorDamage:          src.FloorDamage,
			DiffuserDamage:       src.DiffuserDamage,
			SidepodDamage:        src.SidepodDamage,
			GearboxDamage:        src.GearBoxDamage,
			EngineDamage:         src.EngineDamage,
		}
		for wheel := 0; wheel < len(gameToDisplayWheelIndex); wheel++ {
			gameIdx := gameToDisplayWheelIndex[wheel]
			dst.TireWear[wheel] = clampPercent(src.TyresWear[gameIdx])
		}
		out.CarDamageData[i] = dst
	}
	return out
}

func convertSessionHistory(in map[uint8]*packets.PacketSessionHistoryData) map[uint8]*extpackets.PacketSessionHistoryData {
	if len(in) == 0 {
		return nil
	}
	out := make(map[uint8]*extpackets.PacketSessionHistoryData, len(in))
	for carIndex, src := range in {
		if src == nil {
			continue
		}
		history := &extpackets.PacketSessionHistoryData{
			CarIndex:          src.CarIdx,
			NumLaps:           src.NumLaps,
			BestLapTimeLapNum: src.BestLapTimeLapNum,
			BestSector1LapNum: src.BestSector1LapNum,
			BestSector2LapNum: src.BestSector2LapNum,
			BestSector3LapNum: src.BestSector3LapNum,
			LapHistoryData:    make([]extpackets.LapHistoryData, src.NumLaps),
		}
		for i := 0; i < int(src.NumLaps) && i < packets.MaxNumLapsInHistory; i++ {
			lap := src.LapHistoryData[i]
			history.LapHistoryData[i] = extpackets.LapHistoryData{
				LapTimeInMS:      lap.LapTimeInMS,
				Sector1TimeInMS:  uint16(lap.Sector1Ms()),
				Sector2TimeInMS:  uint16(lap.Sector2Ms()),
				Sector3TimeInMS:  uint16(lap.Sector3Ms()),
				LapValidBitFlags: lap.LapValidBitFlags,
			}
		}
		history.BestSector1Ms = lapHistorySectorPtr(src, int(src.BestSector1LapNum), func(l packets.LapHistoryData) int { return l.Sector1Ms() })
		history.BestSector2Ms = lapHistorySectorPtr(src, int(src.BestSector2LapNum), func(l packets.LapHistoryData) int { return l.Sector2Ms() })
		history.BestSector3Ms = lapHistorySectorPtr(src, int(src.BestSector3LapNum), func(l packets.LapHistoryData) int { return l.Sector3Ms() })
		out[carIndex] = history
	}
	return out
}

func convertTyreSets(in map[uint8]*packets.PacketTyreSetsData) map[uint8]*extpackets.PacketTyreSetsData {
	if len(in) == 0 {
		return nil
	}
	out := make(map[uint8]*extpackets.PacketTyreSetsData, len(in))
	for carIndex, src := range in {
		if src == nil {
			continue
		}
		sets := &extpackets.PacketTyreSetsData{
			CarIndex:      src.CarIdx,
			FittedIdx:     src.FittedIdx,
			AvailableSets: make([]extpackets.TyreSetData, packets.MaxNumTyreSets),
		}
		for i := 0; i < packets.MaxNumTyreSets; i++ {
			set := src.TyreSetData[i]
			sets.AvailableSets[i] = extpackets.TyreSetData{
				ActualTyreCompound: set.ActualTyreCompound,
				VisualTyreCompound: set.VisualTyreCompound,
				Wear:               set.Wear,
				Available:          set.Available == 1,
				RecommendedSession: set.RecommendedSession,
			}
		}
		out[carIndex] = sets
	}
	return out
}

func convertSourceCars(snapshot Snapshot, carCount int) []extmodel.CarEnvelope {
	if carCount == 0 {
		return nil
	}
	driversByIndex := make(map[int]dto.DriverInfo, len(snapshot.Drivers))
	for _, driver := range snapshot.Drivers {
		driversByIndex[driver.Index] = driver
	}
	out := make([]extmodel.CarEnvelope, 0, carCount)
	for carIndex := 0; carIndex < carCount; carIndex++ {
		driver, hasDriver := driversByIndex[carIndex]
		car := extmodel.CarEnvelope{
			CarIndex: carIndex,
			Normalized: extmodel.NormalizedCar{
				Index: carIndex,
			},
		}
		if hasDriver {
			car.Normalized.TireCompound = driver.TireCompound
			car.Normalized.ERSEstimatePct = driver.ERSEstimatePct
			car.Normalized.ERSEstimateReady = driver.ERSEstimateReady
			car.Normalized.ERSActualPct = driver.ERSActualPct
			car.Normalized.ERSActualReady = driver.ERSActualReady
		}
		if status := statusAt(snapshot.CarStatus, carIndex); status != nil {
			car.Normalized.ERSActualPct = ersPercent(status.ERSStoreEnergy)
			car.Normalized.ERSActualReady = true
		}
		if hasDriver && len(driver.StintHistory) > 0 {
			car.Normalized.StintHistory = make([]extdto.StintInfoDTO, 0, len(driver.StintHistory))
			for _, stint := range driver.StintHistory {
				car.Normalized.StintHistory = append(car.Normalized.StintHistory, extdto.StintInfoDTO{
					Compound:  stint.Compound,
					TotalLaps: stint.Laps,
				})
			}
		}
		if hasDriver && driver.BestSector1Ms != nil {
			v := *driver.BestSector1Ms
			car.Normalized.BestSector1Ms = &v
		}
		if hasDriver && driver.BestSector2Ms != nil {
			v := *driver.BestSector2Ms
			car.Normalized.BestSector2Ms = &v
		}
		if hasDriver && driver.BestSector3Ms != nil {
			v := *driver.BestSector3Ms
			car.Normalized.BestSector3Ms = &v
		}
		out = append(out, car)
	}
	return out
}

func lapHistorySectorPtr(history *packets.PacketSessionHistoryData, lapNum int, selector func(packets.LapHistoryData) int) *int {
	if history == nil || lapNum <= 0 || lapNum > int(history.NumLaps) || lapNum > packets.MaxNumLapsInHistory {
		return nil
	}
	value := selector(history.LapHistoryData[lapNum-1])
	if value <= 0 {
		return nil
	}
	return &value
}

func statusAt(data *packets.PacketCarStatusData, carIndex int) *packets.CarStatusData {
	if data == nil || carIndex < 0 || carIndex >= packets.MaxCars {
		return nil
	}
	return &data.CarStatusData[carIndex]
}

func clampPercent(v float32) int {
	if v < 0 {
		return 0
	}
	if v > 100 {
		return 100
	}
	return int(v + 0.5)
}

func ersPercent(energy float32) int {
	const maxERSEnergy = 4_000_000.0
	if math.IsNaN(float64(energy)) || math.IsInf(float64(energy), 0) {
		return 0
	}
	pct := (float64(energy) / maxERSEnergy) * 100
	if pct < 0 {
		pct = 0
	}
	if pct > 100 {
		pct = 100
	}
	return int(math.Round(pct))
}

func formatEventDetails(details packets.EventDetails) string {
	if details == nil {
		return ""
	}
	return fmt.Sprintf("%T", details)
}
