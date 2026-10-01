package main

import _ "embed"

//go:embed settings.html
var settingsHTML []byte

//go:embed radar.html
var radarHTML []byte

//go:embed weather.html
var weatherHTML []byte

//go:embed strategy.html
var strategyHTML []byte

//go:embed icon.ico
var trayIconBytes []byte

//go:embed radio.html
var radioHTML []byte
