package main

import _ "embed"

//go:embed settings.html
var settingsHTML []byte

//go:embed radar.html
var radarHTML []byte

//go:embed icon.ico
var trayIconBytes []byte
