package main

import (
	"log/slog"

	"frc.engineer/internal/updater"
)

func cleanOldBinary(logger *slog.Logger) {
	updater.CleanOldBinary(logger)
}

func autoUpdate(logger *slog.Logger) error {
	return updater.AutoUpdate(logger, appVersion)
}
