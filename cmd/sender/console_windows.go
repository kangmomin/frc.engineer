//go:build windows

package main

import (
	"fmt"
	"os"
	"syscall"
	"unsafe"
)

var (
	kernel32     = syscall.NewLazyDLL("kernel32.dll")
	allocConsole = kernel32.NewProc("AllocConsole")
	freeConsole  = kernel32.NewProc("FreeConsole")
	setTitle     = kernel32.NewProc("SetConsoleTitleW")
)

// openConsole allocates a visible CMD window for a GUI application.
func openConsole(title string) {
	allocConsole.Call()

	// Reopen stdout so fmt.Printf writes to the new console
	stdout, _ := syscall.GetStdHandle(syscall.STD_OUTPUT_HANDLE)
	os.Stdout = os.NewFile(uintptr(stdout), "stdout")

	// Set window title
	titlePtr, _ := syscall.UTF16PtrFromString(title)
	setTitle.Call(uintptr(unsafe.Pointer(titlePtr)))
}

// closeConsole frees the console window.
func closeConsole() {
	freeConsole.Call()
}

// printProgress prints a progress bar to the console, overwriting the current line.
func printProgress(status string, pct int) {
	if pct < 0 {
		fmt.Printf("\r  %-60s", status)
		return
	}
	barLen := 30
	filled := barLen * pct / 100
	bar := ""
	for i := range barLen {
		if i < filled {
			bar += "█"
		} else {
			bar += "░"
		}
	}
	fmt.Printf("\r  [%s] %3d%%  %s", bar, pct, status)
}
