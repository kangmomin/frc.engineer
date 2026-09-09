package main

import (
	"os/exec"
	"runtime"

	"github.com/energye/systray"
)

// discordURL is the official community server. Kept here next to the tray menu
// (settings.html hardcodes the same invite) — the repo has no shared link table
// and the Driver Pack shell keeps its own URLs the same way.
const discordURL = "https://discord.gg/Vcxr49w4TX"

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
func startTray(settingsURL string, version string, onQuit func()) <-chan struct{} {
	ready := make(chan struct{})
	go systray.Run(func() {
		systray.SetTitle("FRC Pitwall Sender " + version)
		systray.SetTooltip("FRC Pitwall Sender " + version + " — Starting...")
		systray.SetIcon(trayIconBytes)

		mSettings := systray.AddMenuItem("Settings", "Open settings in browser")
		mDiscord := systray.AddMenuItem("Discord", "공식 디스코드 서버 열기")
		systray.AddSeparator()
		mQuit := systray.AddMenuItem("Quit", "Stop the sender")

		// Open browser on tray icon click
		systray.SetOnClick(func(menu systray.IMenu) {
			openBrowser(settingsURL)
		})

		mSettings.Click(func() {
			openBrowser(settingsURL)
		})

		mDiscord.Click(func() {
			openBrowser(discordURL)
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
