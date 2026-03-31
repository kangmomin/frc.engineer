package main

import _ "embed"

//go:embed settings.html
var settingsHTML []byte

//go:embed icon.ico
var trayIconBytes []byte
