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

type overlayState struct {
	Radar    bool `json:"radar"`
	Weather  bool `json:"weather"`
	Strategy bool `json:"strategy"`
}

type overlayPreset struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	SavedAtLocal string `json:"savedAtLocal,omitempty"`
	Radar        bool   `json:"radar"`
	Weather      bool   `json:"weather"`
	Strategy     bool   `json:"strategy"`
}

type overlayHotkeys struct {
	Radar    string `json:"radar"`
	Weather  string `json:"weather"`
	Strategy string `json:"strategy"`
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

var defaultOverlayHotkeys = overlayHotkeys{
	Radar:    "Alt+Shift+1",
	Weather:  "Alt+Shift+2",
	Strategy: "Alt+Shift+3",
}

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
	return overlayHotkeys{
		Radar:    strings.TrimSpace(in.Radar),
		Weather:  strings.TrimSpace(in.Weather),
		Strategy: strings.TrimSpace(in.Strategy),
	}
}

func defaultedOverlayHotkeys(saved *overlayHotkeys) overlayHotkeys {
	if saved == nil {
		return defaultOverlayHotkeys
	}
	return normalizeOverlayHotkeys(*saved)
}

func cloneOverlayHotkeys(saved overlayHotkeys) *overlayHotkeys {
	cloned := normalizeOverlayHotkeys(saved)
	return &cloned
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

func currentOverlayState(radar, weather, strategy overlayController) overlayState {
	return overlayState{
		Radar:    radar != nil && radar.IsRunning(),
		Weather:  weather != nil && weather.IsRunning(),
		Strategy: strategy != nil && strategy.IsRunning(),
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

func applyOverlayState(state overlayState, radar, weather, strategy overlayController) overlayState {
	return overlayState{
		Radar:    ensureOverlayState(radar, state.Radar),
		Weather:  ensureOverlayState(weather, state.Weather),
		Strategy: ensureOverlayState(strategy, state.Strategy),
	}
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
