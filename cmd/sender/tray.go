package main

import (
	"os/exec"
	"runtime"

	"github.com/energye/systray"
)

func openBrowser(url string) {
	switch runtime.GOOS {
	case "windows":
		exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
	case "darwin":
		exec.Command("open", url).Start()
	default:
		exec.Command("xdg-open", url).Start()
	}
}

func runTray(settingsURL string, onQuit func()) {
	systray.Run(func() {
		systray.SetTitle("FRC Pitwall Sender")
		systray.SetTooltip("FRC Pitwall Sender — Running")
		systray.SetIcon(trayIconBytes)

		mSettings := systray.AddMenuItem("Settings", "Open settings in browser")
		systray.AddSeparator()
		mQuit := systray.AddMenuItem("Quit", "Stop the sender")

		// Open browser on tray icon click
		systray.SetOnClick(func(menu systray.IMenu) {
			openBrowser(settingsURL)
		})

		mSettings.Click(func() {
			openBrowser(settingsURL)
		})

		mQuit.Click(func() {
			if onQuit != nil {
				onQuit()
			}
			systray.Quit()
		})

		// Auto-open browser on startup
		openBrowser(settingsURL)
	}, nil)
}
