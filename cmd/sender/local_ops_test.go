package main

import "testing"

type testOverlayController struct {
	active bool
}

func (o *testOverlayController) Toggle() bool {
	o.active = !o.active
	return o.active
}

func (o *testOverlayController) IsRunning() bool { return o.active }

func TestBuildEngineerInviteLink(t *testing.T) {
	link := buildEngineerInviteLink("localhost:5173", "wss://signal.example/ws", "room-123")
	want := "http://localhost:5173?remote=1&roomId=room-123&signalingUrl=wss%3A%2F%2Fsignal.example%2Fws"
	if link != want {
		t.Fatalf("link = %q, want %q", link, want)
	}
}

func TestSignalingHTTPBase(t *testing.T) {
	cases := map[string]string{
		"wss://signal.example/ws":      "https://signal.example",
		"ws://localhost:9090/ws":       "http://localhost:9090",
		"https://signal.example":       "https://signal.example",
		"http://localhost:9090/ws":     "http://localhost:9090",
		"wss://host.example/custom/ws": "https://host.example",
		"":                             "",
		"   ":                          "",
		"not a url":                    "",
	}
	for raw, want := range cases {
		if got := signalingHTTPBase(raw); got != want {
			t.Errorf("signalingHTTPBase(%q) = %q, want %q", raw, got, want)
		}
	}
}

func TestNormalizeEngineerDashboardURLPrivateNetworksUseHTTP(t *testing.T) {
	cases := map[string]string{
		"10.0.0.15:5173":    "http://10.0.0.15:5173",
		"172.16.5.4:8080":   "http://172.16.5.4:8080",
		"192.168.0.22:3000": "http://192.168.0.22:3000",
		"dashboard.example": "https://dashboard.example",
	}
	for raw, want := range cases {
		if got := normalizeEngineerDashboardURL(raw); got != want {
			t.Fatalf("normalizeEngineerDashboardURL(%q) = %q, want %q", raw, got, want)
		}
	}
}

func TestNormalizeOverlayHotkeysAllowsClearing(t *testing.T) {
	got := normalizeOverlayHotkeys(overlayHotkeys{
		Radar:    " Ctrl+1 ",
		Weather:  "",
		Strategy: "  ",
	})
	if got.Radar != "Ctrl+1" {
		t.Fatalf("radar = %q, want %q", got.Radar, "Ctrl+1")
	}
	if got.Weather != "" || got.Strategy != "" {
		t.Fatalf("expected empty hotkeys to remain cleared, got %#v", got)
	}
}

func TestDefaultedOverlayHotkeys(t *testing.T) {
	got := defaultedOverlayHotkeys(nil)
	want := defaultOverlayHotkeys
	if got.Radar != want.Radar || got.Weather != want.Weather || got.Strategy != want.Strategy ||
		got.Radio == nil || *got.Radio != defaultRadioHotkey {
		t.Fatalf("defaultedOverlayHotkeys(nil) = %#v, want %#v", got, want)
	}
	// The default must be a copy: callers may not alias the package default.
	*got.Radio = "X"
	if *defaultOverlayHotkeys.Radio != defaultRadioHotkey {
		t.Fatal("default radio hotkey aliased")
	}
}

func TestNormalizeOverlayPresets(t *testing.T) {
	presets := normalizeOverlayPresets([]overlayPreset{
		{ID: " one ", Name: " Race Start "},
		{ID: "ONE", Name: "Duplicate ID"},
		{ID: "two", Name: "race start"},
		{ID: "", Name: "Missing ID"},
	})
	if len(presets) != 1 {
		t.Fatalf("len = %d, want 1", len(presets))
	}
	if presets[0].ID != "one" || presets[0].Name != "Race Start" {
		t.Fatalf("unexpected preset %#v", presets[0])
	}
	if presets[0].SavedAtLocal == "" {
		t.Fatal("expected SavedAtLocal to be populated")
	}
}

func TestApplyOverlayState(t *testing.T) {
	radar := &testOverlayController{active: false}
	weather := &testOverlayController{active: true}
	strategy := &testOverlayController{active: false}

	radio := &testOverlayController{active: true}

	state := applyOverlayState(overlayState{Radar: true, Weather: false, Strategy: true}, radar, weather, strategy, radio)
	if !state.Radar || state.Weather || !state.Strategy {
		t.Fatalf("unexpected state %#v", state)
	}
	// A client without the radio key must not close the radio overlay.
	if state.Radio == nil || !*state.Radio || !radio.active {
		t.Fatalf("radio overlay changed by legacy apply: %#v", state.Radio)
	}
	state = applyOverlayState(overlayState{Radio: boolPtr(false)}, radar, weather, strategy, radio)
	if state.Radio == nil || *state.Radio || radio.active {
		t.Fatalf("explicit radio=false ignored: %#v", state.Radio)
	}
}

func TestOverlayHotkeysRadioCompatibility(t *testing.T) {
	legacy := defaultedOverlayHotkeys(&overlayHotkeys{Radar: "Alt+1"})
	if legacy.Radio == nil || *legacy.Radio != defaultRadioHotkey {
		t.Fatalf("saved config without radio key must get the default: %#v", legacy.Radio)
	}
	cleared := defaultedOverlayHotkeys(&overlayHotkeys{Radio: stringPtr("")})
	if cleared.Radio == nil || *cleared.Radio != "" {
		t.Fatalf("explicitly cleared radio hotkey restored: %#v", cleared.Radio)
	}
	merged := mergeOverlayHotkeys(overlayHotkeys{Radar: " Alt+9 "}, overlayHotkeys{Radio: stringPtr("Ctrl+R")})
	if merged.Radar != "Alt+9" || merged.Radio == nil || *merged.Radio != "Ctrl+R" {
		t.Fatalf("older client dropped radio hotkey: %#v", merged)
	}
	if got := defaultedOverlayWindowSettings(nil).Radio; got.X != defaultRadioX || got.Scale != defaultOverlayScale {
		t.Fatalf("radio window defaults %#v", got)
	}
}

func TestDefaultedOverlayWindowSettings(t *testing.T) {
	got := defaultedOverlayWindowSettings(nil)
	if got.Radar.X != defaultRadarX || got.Radar.Y != defaultRadarY || got.Radar.Alpha != defaultOverlayAlpha {
		t.Fatalf("unexpected radar defaults %#v", got.Radar)
	}
	if got.Weather.Scale != defaultOverlayScale || got.Strategy.Scale != defaultOverlayScale {
		t.Fatalf("unexpected scale defaults weather=%#v strategy=%#v", got.Weather, got.Strategy)
	}
	if got.Radar.RangeM != defaultRadarRangeM {
		t.Fatalf("unexpected radar range default %#v", got.Radar)
	}
}

func TestDefaultedOverlayWindowSettingsPreservesSavedValues(t *testing.T) {
	got := defaultedOverlayWindowSettings(&overlayWindowSettings{
		Radar: overlayWindowState{
			X:      48,
			Y:      72,
			Alpha:  210,
			RangeM: 95,
		},
		Weather: overlayWindowState{
			X:     10,
			Y:     20,
			Alpha: 180,
			Scale: 1.4,
		},
		Strategy: overlayWindowState{
			X:     640,
			Y:     80,
			Alpha: 160,
			Scale: 1.2,
		},
	})

	if got.Radar.X != 48 || got.Radar.Y != 72 || got.Radar.Alpha != 210 || got.Radar.RangeM != 95 {
		t.Fatalf("unexpected radar state %#v", got.Radar)
	}
	if got.Weather.Scale != 1.4 || got.Strategy.Scale != 1.2 {
		t.Fatalf("unexpected scale state weather=%#v strategy=%#v", got.Weather, got.Strategy)
	}
}
