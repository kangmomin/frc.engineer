//go:build !windows

package main

import "frc.engineer/internal/telemetry"

type strategyOverlay struct{}

func newStrategyOverlay(_ *telemetry.PitwallManager, _ func(int8) trackStrategyConfig, _ overlayWindowState, _ func(overlayWindowState)) *strategyOverlay {
	return &strategyOverlay{}
}
func (o *strategyOverlay) Start()          {}
func (o *strategyOverlay) Stop()           {}
func (o *strategyOverlay) Toggle() bool    { return false }
func (o *strategyOverlay) IsRunning() bool { return false }
