package telemetry

import "frc.engineer/internal/dto"

// BattleDetector tracks gap trends between the player and adjacent cars,
// raising an alert when an overtake is projected within 5 laps.
type BattleDetector struct {
	prevGapAhead  int // ms
	prevGapBehind int // ms
	prevLapNum    int
	prevAheadName string
	prevBehindName string
	cooldown      map[string]int // side → next lap where alert is allowed
}

// NewBattleDetector creates a new BattleDetector.
func NewBattleDetector() *BattleDetector {
	return &BattleDetector{
		cooldown: make(map[string]int),
	}
}

// Reset clears all state (call on session change).
func (bd *BattleDetector) Reset() {
	bd.prevGapAhead = 0
	bd.prevGapBehind = 0
	bd.prevLapNum = 0
	bd.prevAheadName = ""
	bd.prevBehindName = ""
	bd.cooldown = make(map[string]int)
}

// Check evaluates gap changes when the player crosses a new lap.
func (bd *BattleDetector) Check(currentLap int, gapAheadMs, gapBehindMs int, driverAhead, driverBehind string) []dto.BattleAlertDTO {
	// Session reset: lap went backwards
	if currentLap < bd.prevLapNum {
		bd.Reset()
		return nil
	}

	// Only evaluate on lap change
	if currentLap <= bd.prevLapNum {
		return nil
	}

	var alerts []dto.BattleAlertDTO

	// --- Ahead ---
	// Only compare if same driver as previous lap
	if bd.prevGapAhead > 0 && gapAheadMs > 0 && driverAhead != "" && driverAhead == bd.prevAheadName {
		closingRate := bd.prevGapAhead - gapAheadMs // positive = closing
		if closingRate > 0 {
			estLaps := gapAheadMs / closingRate
			// estLaps==0 means overtake within this lap — also alert
			if estLaps <= 5 {
				if cd, ok := bd.cooldown["ahead"]; !ok || currentLap >= cd {
					displayEst := estLaps
					if displayEst == 0 {
						displayEst = 1
					}
					alerts = append(alerts, dto.BattleAlertDTO{
						DriverAhead:    driverAhead,
						DriverBehind:   "Player",
						GapSeconds:     float64(gapAheadMs) / 1000.0,
						ClosingRate:    float64(closingRate) / 1000.0,
						EstOvertakeLap: displayEst,
						Side:           "ahead",
					})
					bd.cooldown["ahead"] = currentLap + 3
				}
			}
		}
	}

	// --- Behind ---
	if bd.prevGapBehind > 0 && gapBehindMs > 0 && driverBehind != "" && driverBehind == bd.prevBehindName {
		closingRate := bd.prevGapBehind - gapBehindMs
		if closingRate > 0 {
			estLaps := gapBehindMs / closingRate
			if estLaps <= 5 {
				if cd, ok := bd.cooldown["behind"]; !ok || currentLap >= cd {
					displayEst := estLaps
					if displayEst == 0 {
						displayEst = 1
					}
					alerts = append(alerts, dto.BattleAlertDTO{
						DriverAhead:    "Player",
						DriverBehind:   driverBehind,
						GapSeconds:     float64(gapBehindMs) / 1000.0,
						ClosingRate:    float64(closingRate) / 1000.0,
						EstOvertakeLap: displayEst,
						Side:           "behind",
					})
					bd.cooldown["behind"] = currentLap + 3
				}
			}
		}
	}

	bd.prevGapAhead = gapAheadMs
	bd.prevGapBehind = gapBehindMs
	bd.prevAheadName = driverAhead
	bd.prevBehindName = driverBehind
	bd.prevLapNum = currentLap

	return alerts
}
