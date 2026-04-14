//go:build !windows

package main

import "frc.engineer/internal/telemetry"

type weatherOverlay struct{}

func newWeatherOverlay(_ *telemetry.PitwallManager, _ overlayWindowState, _ func(overlayWindowState)) *weatherOverlay {
	return &weatherOverlay{}
}
func (o *weatherOverlay) Start()          {}
func (o *weatherOverlay) Stop()           {}
func (o *weatherOverlay) Toggle() bool    { return false }
func (o *weatherOverlay) IsRunning() bool { return false }
