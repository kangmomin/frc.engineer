//go:build !windows

package main

import "frc.engineer/internal/telemetry"

type radarOverlay struct{}

func newRadarOverlay(_ *telemetry.PitwallManager, _ overlayWindowState, _ func(overlayWindowState)) *radarOverlay {
	return &radarOverlay{}
}
func (o *radarOverlay) Start()          {}
func (o *radarOverlay) Stop()           {}
func (o *radarOverlay) Toggle() bool    { return false }
func (o *radarOverlay) IsRunning() bool { return false }
