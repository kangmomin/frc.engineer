package main

import (
	"net"
	"net/url"
	"strings"
	"time"
)

const (
	defaultEngineerDashboardURL = "https://pitwall.up.railway.app"
	maxOverlayPresets           = 12
)

// overlayState is the on/off state of every overlay. Radio is a pointer so a
// client or preset written before the engineer radio overlay existed (no
// "radio" key) leaves that overlay as it is instead of closing it.
type overlayState struct {
	Radar    bool  `json:"radar"`
	Weather  bool  `json:"weather"`
	Strategy bool  `json:"strategy"`
	Radio    *bool `json:"radio,omitempty"`
}

type overlayPreset struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	SavedAtLocal string `json:"savedAtLocal,omitempty"`
	Radar        bool   `json:"radar"`
	Weather      bool   `json:"weather"`
	Strategy     bool   `json:"strategy"`
	Radio        *bool  `json:"radio,omitempty"`
}

// overlayHotkeys: Radio nil means "not sent" (older client) and keeps the
// current binding; an empty string clears it.
type overlayHotkeys struct {
	Radar    string  `json:"radar"`
	Weather  string  `json:"weather"`
	Strategy string  `json:"strategy"`
	Radio    *string `json:"radio,omitempty"`
}

type overlayWindowState struct {
	X      int     `json:"x,omitempty"`
	Y      int     `json:"y,omitempty"`
	Alpha  uint8   `json:"alpha,omitempty"`
	Scale  float64 `json:"scale,omitempty"`
	RangeM float64 `json:"rangeM,omitempty"`
}

type overlayWindowSettings struct {
	Radar    overlayWindowState `json:"radar,omitempty"`
	Weather  overlayWindowState `json:"weather,omitempty"`
	Strategy overlayWindowState `json:"strategy,omitempty"`
	Radio    overlayWindowState `json:"radio,omitempty"`
}

type inviteInfo struct {
	DashboardURL     string `json:"dashboardUrl"`
	SignalingURL     string `json:"signalingUrl"`
	RoomID           string `json:"roomId"`
	RoomCode         string `json:"roomCode"`
	Link             string `json:"link"`
	PasswordRequired bool   `json:"passwordRequired"`
}

type overlayController interface {
	Toggle() bool
	IsRunning() bool
}

const defaultRadioHotkey = "Alt+Shift+4"

var defaultOverlayHotkeys = overlayHotkeys{
	Radar:    "Alt+Shift+1",
	Weather:  "Alt+Shift+2",
	Strategy: "Alt+Shift+3",
	Radio:    stringPtr(defaultRadioHotkey),
}

func stringPtr(s string) *string { return &s }

func boolPtr(b bool) *bool { return &b }

const (
	defaultOverlayAlpha = 230
	minOverlayAlpha     = 30
	maxOverlayAlpha     = 245
	defaultRadarX       = 200
	defaultRadarY       = 200
	defaultWeatherX     = 200
	defaultWeatherY     = 200
	defaultStrategyX    = 160
	defaultStrategyY    = 160
	defaultRadioX       = 160
	defaultRadioY       = 520
	defaultOverlayScale = 1.0
	defaultRadarRangeM  = 80.0
	minOverlayScale     = 0.6
	maxOverlayScale     = 2.5
)

func normalizeEngineerDashboardURL(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return defaultEngineerDashboardURL
	}
	if !strings.Contains(trimmed, "://") {
		if preferHTTPDashboardURL(trimmed) {
			trimmed = "http://" + trimmed
		} else {
			trimmed = "https://" + trimmed
		}
	}
	parsed, err := url.Parse(trimmed)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return defaultEngineerDashboardURL
	}
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return strings.TrimRight(parsed.String(), "/")
}

func preferHTTPDashboardURL(raw string) bool {
	parsed, err := url.Parse("//" + strings.TrimSpace(raw))
	if err != nil {
		return false
	}

	host := strings.ToLower(strings.TrimSpace(parsed.Hostname()))
	if host == "" {
		return false
	}
	if host == "localhost" || strings.HasSuffix(host, ".local") {
		return true
	}

	ip := net.ParseIP(host)
	if ip == nil {
		return false
	}
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast()
}

func normalizeOverlayHotkeys(in overlayHotkeys) overlayHotkeys {
	out := overlayHotkeys{
		Radar:    strings.TrimSpace(in.Radar),
		Weather:  strings.TrimSpace(in.Weather),
		Strategy: strings.TrimSpace(in.Strategy),
	}
	if in.Radio != nil {
		out.Radio = stringPtr(strings.TrimSpace(*in.Radio))
	}
	return out
}

func defaultedOverlayHotkeys(saved *overlayHotkeys) overlayHotkeys {
	if saved == nil {
		return normalizeOverlayHotkeys(defaultOverlayHotkeys)
	}
	out := normalizeOverlayHotkeys(*saved)
	if out.Radio == nil {
		out.Radio = stringPtr(defaultRadioHotkey)
	}
	return out
}

// mergeOverlayHotkeys keeps the current radio binding when an older client
// sends hotkeys without the radio key.
func mergeOverlayHotkeys(next, current overlayHotkeys) overlayHotkeys {
	next = normalizeOverlayHotkeys(next)
	if next.Radio == nil && current.Radio != nil {
		next.Radio = stringPtr(*current.Radio)
	}
	return next
}

func cloneOverlayHotkeys(saved overlayHotkeys) *overlayHotkeys {
	cloned := normalizeOverlayHotkeys(saved)
	return &cloned
}

func defaultedOverlayWindowSettings(saved *overlayWindowSettings) overlayWindowSettings {
	defaults := overlayWindowSettings{
		Radar: overlayWindowState{
			X:      defaultRadarX,
			Y:      defaultRadarY,
			Alpha:  defaultOverlayAlpha,
			RangeM: defaultRadarRangeM,
		},
		Weather: overlayWindowState{
			X:     defaultWeatherX,
			Y:     defaultWeatherY,
			Alpha: defaultOverlayAlpha,
			Scale: defaultOverlayScale,
		},
		Strategy: overlayWindowState{
			X:     defaultStrategyX,
			Y:     defaultStrategyY,
			Alpha: defaultOverlayAlpha,
			Scale: defaultOverlayScale,
		},
		Radio: overlayWindowState{
			X:     defaultRadioX,
			Y:     defaultRadioY,
			Alpha: defaultOverlayAlpha,
			Scale: defaultOverlayScale,
		},
	}
	if saved == nil {
		return defaults
	}

	return overlayWindowSettings{
		Radar:    normalizeOverlayWindowState("radar", saved.Radar, defaults.Radar),
		Weather:  normalizeOverlayWindowState("weather", saved.Weather, defaults.Weather),
		Strategy: normalizeOverlayWindowState("strategy", saved.Strategy, defaults.Strategy),
		Radio:    normalizeOverlayWindowState("radio", saved.Radio, defaults.Radio),
	}
}

func cloneOverlayWindowSettings(saved overlayWindowSettings) *overlayWindowSettings {
	cloned := saved
	return &cloned
}

func normalizeOverlayWindowState(kind string, in overlayWindowState, fallback overlayWindowState) overlayWindowState {
	out := in
	if out.X == 0 && out.Y == 0 {
		out.X = fallback.X
		out.Y = fallback.Y
	}
	if out.Alpha < minOverlayAlpha || out.Alpha > maxOverlayAlpha {
		out.Alpha = fallback.Alpha
	}

	switch kind {
	case "radar":
		if out.RangeM <= 0 {
			out.RangeM = fallback.RangeM
		}
		out.Scale = 0
	default:
		if out.Scale < minOverlayScale || out.Scale > maxOverlayScale {
			out.Scale = fallback.Scale
		}
		out.RangeM = 0
	}

	return out
}

func normalizeOverlayPresets(in []overlayPreset) []overlayPreset {
	if len(in) == 0 {
		return nil
	}

	out := make([]overlayPreset, 0, min(len(in), maxOverlayPresets))
	seenIDs := make(map[string]struct{}, len(in))
	seenNames := make(map[string]struct{}, len(in))
	for _, preset := range in {
		preset.ID = strings.TrimSpace(preset.ID)
		preset.Name = strings.TrimSpace(preset.Name)
		if preset.ID == "" || preset.Name == "" {
			continue
		}
		idKey := strings.ToLower(preset.ID)
		nameKey := strings.ToLower(preset.Name)
		if _, exists := seenIDs[idKey]; exists {
			continue
		}
		if _, exists := seenNames[nameKey]; exists {
			continue
		}
		if preset.SavedAtLocal == "" {
			preset.SavedAtLocal = time.Now().Format("2006-01-02 15:04:05")
		}
		out = append(out, preset)
		seenIDs[idKey] = struct{}{}
		seenNames[nameKey] = struct{}{}
		if len(out) >= maxOverlayPresets {
			break
		}
	}

	if len(out) == 0 {
		return nil
	}
	return out
}

func currentOverlayState(radar, weather, strategy, radio overlayController) overlayState {
	return overlayState{
		Radar:    radar != nil && radar.IsRunning(),
		Weather:  weather != nil && weather.IsRunning(),
		Strategy: strategy != nil && strategy.IsRunning(),
		Radio:    boolPtr(radio != nil && radio.IsRunning()),
	}
}

func ensureOverlayState(controller overlayController, active bool) bool {
	if controller == nil {
		return false
	}
	if controller.IsRunning() == active {
		return active
	}
	return controller.Toggle()
}

// applyOverlayState drives every overlay to state. A missing radio key keeps
// the radio overlay as it is.
func applyOverlayState(state overlayState, radar, weather, strategy, radio overlayController) overlayState {
	radioActive := radio != nil && radio.IsRunning()
	if state.Radio != nil {
		radioActive = ensureOverlayState(radio, *state.Radio)
	}
	return overlayState{
		Radar:    ensureOverlayState(radar, state.Radar),
		Weather:  ensureOverlayState(weather, state.Weather),
		Strategy: ensureOverlayState(strategy, state.Strategy),
		Radio:    boolPtr(radioActive),
	}
}

// signalingHTTPBase converts a signaling WebSocket URL (e.g. wss://host/ws) into
// its HTTP origin (https://host) for plain HTTP calls such as
// /api/banned-nicknames. Returns "" if the URL has no usable scheme+host.
func signalingHTTPBase(signalingURL string) string {
	u, err := url.Parse(strings.TrimSpace(signalingURL))
	if err != nil || u.Host == "" {
		return ""
	}
	switch u.Scheme {
	case "wss":
		u.Scheme = "https"
	case "ws":
		u.Scheme = "http"
	case "http", "https":
		// already an HTTP scheme
	default:
		return ""
	}
	return u.Scheme + "://" + u.Host
}

func buildEngineerInviteLink(dashboardBaseURL, signalingURL, roomID string) string {
	if strings.TrimSpace(signalingURL) == "" || strings.TrimSpace(roomID) == "" {
		return ""
	}
	baseURL, err := url.Parse(normalizeEngineerDashboardURL(dashboardBaseURL))
	if err != nil || baseURL.Scheme == "" || baseURL.Host == "" {
		return ""
	}
	query := baseURL.Query()
	query.Set("remote", "1")
	query.Set("signalingUrl", strings.TrimSpace(signalingURL))
	query.Set("roomId", strings.TrimSpace(roomID))
	baseURL.RawQuery = query.Encode()
	return baseURL.String()
}

func buildInviteInfo(dashboardBaseURL, signalingURL, roomID, roomCode string, passwordRequired bool) inviteInfo {
	normalizedDashboardURL := normalizeEngineerDashboardURL(dashboardBaseURL)
	return inviteInfo{
		DashboardURL:     normalizedDashboardURL,
		SignalingURL:     strings.TrimSpace(signalingURL),
		RoomID:           strings.TrimSpace(roomID),
		RoomCode:         strings.TrimSpace(roomCode),
		Link:             buildEngineerInviteLink(normalizedDashboardURL, signalingURL, roomID),
		PasswordRequired: passwordRequired,
	}
}
