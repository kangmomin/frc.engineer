//go:build !windows

package main

import "frc.engineer/internal/engineer"

type radioSource interface {
	Active() []engineer.Call
	Settings() engineer.Settings
}

type radioOverlay struct{}

func newRadioOverlay(_ radioSource, _ overlayWindowState, _ func(overlayWindowState)) *radioOverlay {
	return &radioOverlay{}
}
func (o *radioOverlay) Start()          {}
func (o *radioOverlay) Stop()           {}
func (o *radioOverlay) Toggle() bool    { return false }
func (o *radioOverlay) IsRunning() bool { return false }
