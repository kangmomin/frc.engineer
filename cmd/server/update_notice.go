package main

import (
	"fmt"
	"log/slog"

	"frc.engineer/internal/updater"
)

var appVersion = "v3.38.4"

func printStartupAccessGuide(logger *slog.Logger, port int) {
	url := fmt.Sprintf("http://localhost:%d", port)
	logger.Info("dashboard access", "url", url)
	fmt.Printf("\n여기서 localhost:%d 로 접속하시면 됩니다. (%s)\n\n", port, url)
}

func checkForUpdateAsync(logger *slog.Logger) {
	updater.CheckForUpdateAsync(logger, appVersion)
}
