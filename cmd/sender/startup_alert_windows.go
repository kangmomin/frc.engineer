//go:build windows

package main

import (
	"syscall"
	"unsafe"
)

const (
	mbOK            = 0x00000000
	mbIconError     = 0x00000010
	mbSetForeground = 0x00010000
	mbTopmost       = 0x00040000
)

var uMessageBox = u32.NewProc("MessageBoxW")

// showStartupAlert blocks until the user dismisses the dialog.
func showStartupAlert(title, message string) {
	t, _ := syscall.UTF16PtrFromString(title)
	m, _ := syscall.UTF16PtrFromString(message)
	uMessageBox.Call(0, uintptr(unsafe.Pointer(m)), uintptr(unsafe.Pointer(t)), mbOK|mbIconError|mbSetForeground|mbTopmost)
}
