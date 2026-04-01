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

// startTray starts the system tray in a background goroutine and returns
// a channel that is closed when the tray is ready. The tray stays alive
// until systray.Quit() is called externally.
func startTray(settingsURL string, onQuit func()) <-chan struct{} {
	ready := make(chan struct{})
	go systray.Run(func() {
		systray.SetTitle("FRC Pitwall Sender")
		systray.SetTooltip("FRC Pitwall Sender — Starting...")
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

		close(ready)
	}, nil)
	return ready
}
