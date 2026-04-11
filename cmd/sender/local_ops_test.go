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
	if got != defaultOverlayHotkeys {
		t.Fatalf("defaultedOverlayHotkeys(nil) = %#v, want %#v", got, defaultOverlayHotkeys)
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

	state := applyOverlayState(overlayState{Radar: true, Weather: false, Strategy: true}, radar, weather, strategy)
	if !state.Radar || state.Weather || !state.Strategy {
		t.Fatalf("unexpected state %#v", state)
	}
}
