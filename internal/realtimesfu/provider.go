package realtimesfu

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	DefaultBaseURL      = "https://rtc.live.cloudflare.com/v1"
	maxResponseBytes    = 256 * 1024
	maxSessionIDBytes   = 256
	maxTrackIDBytes     = 256
	maxSessionDescBytes = 64 * 1024
	providerTimeout     = 5 * time.Second
)

var ErrUpstream = errors.New("realtime SFU request failed")

type SessionDescription struct {
	Type string `json:"type"`
	SDP  string `json:"sdp"`
}

type Session struct {
	SessionID        string `json:"sessionId"`
	ErrorCode        string `json:"errorCode,omitempty"`
	ErrorDescription string `json:"errorDescription,omitempty"`
}

type Track struct {
	Location  string `json:"location"`
	MID       string `json:"mid,omitempty"`
	SessionID string `json:"sessionId,omitempty"`
	TrackName string `json:"trackName,omitempty"`
	Kind      string `json:"kind,omitempty"`
}

type TracksRequest struct {
	SessionDescription *SessionDescription `json:"sessionDescription,omitempty"`
	Tracks             []Track             `json:"tracks,omitempty"`
	AutoDiscover       bool                `json:"autoDiscover,omitempty"`
}

type TrackResult struct {
	Location         string `json:"location,omitempty"`
	MID              string `json:"mid,omitempty"`
	SessionID        string `json:"sessionId,omitempty"`
	TrackName        string `json:"trackName,omitempty"`
	Kind             string `json:"kind,omitempty"`
	ErrorCode        string `json:"errorCode,omitempty"`
	ErrorDescription string `json:"errorDescription,omitempty"`
}

type TracksResponse struct {
	ErrorCode                      string              `json:"errorCode,omitempty"`
	ErrorDescription               string              `json:"errorDescription,omitempty"`
	RequiresImmediateRenegotiation bool                `json:"requiresImmediateRenegotiation,omitempty"`
	SessionDescription             *SessionDescription `json:"sessionDescription,omitempty"`
	Tracks                         []TrackResult       `json:"tracks,omitempty"`
}

type UpdateTrack struct {
	Location  string `json:"location"`
	MID       string `json:"mid"`
	SessionID string `json:"sessionId"`
	TrackName string `json:"trackName"`
}

type UpdateTracksRequest struct {
	Tracks []UpdateTrack `json:"tracks"`
}

type CloseTrack struct {
	MID string `json:"mid"`
}

type CloseTracksRequest struct {
	Tracks []CloseTrack `json:"tracks"`
	Force  bool         `json:"force"`
}

type Provider interface {
	NewSession(context.Context) (Session, error)
	NewTracks(context.Context, string, TracksRequest) (TracksResponse, error)
	Renegotiate(context.Context, string, SessionDescription) (TracksResponse, error)
	UpdateTracks(context.Context, string, UpdateTracksRequest) (TracksResponse, error)
	CloseTracks(context.Context, string, CloseTracksRequest) (TracksResponse, error)
}

type CloudflareProvider struct {
	appID     string
	appSecret string
	baseURL   string
	client    *http.Client
}

func NewCloudflareProvider(config Config) (*CloudflareProvider, error) {
	return newCloudflareProvider(config, DefaultBaseURL, nil, false)
}

// NewCloudflareProviderForTest injects an endpoint and client for isolated
// httptest coverage. Production wiring always uses NewCloudflareProvider.
func NewCloudflareProviderForTest(config Config, endpoint string, client *http.Client) (*CloudflareProvider, error) {
	return newCloudflareProvider(config, endpoint, client, true)
}

func newCloudflareProvider(config Config, endpoint string, client *http.Client, allowHTTP bool) (*CloudflareProvider, error) {
	if !config.Enabled || !validIdentifier(config.AppID, 128) || !validIdentifier(config.AppSecret, 512) {
		return nil, fmt.Errorf("invalid realtime SFU configuration")
	}
	parsed, err := url.Parse(strings.TrimRight(endpoint, "/"))
	if err != nil || parsed.Host == "" || (parsed.Scheme != "https" && !(allowHTTP && parsed.Scheme == "http")) || parsed.RawQuery != "" || parsed.Fragment != "" {
		return nil, fmt.Errorf("invalid realtime SFU endpoint")
	}
	if client == nil {
		client = &http.Client{}
	} else {
		copyClient := *client
		client = &copyClient
	}
	if client.Timeout <= 0 || client.Timeout > providerTimeout {
		client.Timeout = providerTimeout
	}
	client.CheckRedirect = func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}
	return &CloudflareProvider{
		appID:     config.AppID,
		appSecret: config.AppSecret,
		baseURL:   strings.TrimRight(endpoint, "/"),
		client:    client,
	}, nil
}

func (p *CloudflareProvider) NewSession(ctx context.Context) (Session, error) {
	var response Session
	if err := p.do(ctx, http.MethodPost, "sessions/new", struct{}{}, http.StatusCreated, &response); err != nil {
		return Session{}, err
	}
	if response.ErrorCode != "" || response.ErrorDescription != "" || !validIdentifier(response.SessionID, maxSessionIDBytes) {
		return Session{}, ErrUpstream
	}
	return response, nil
}

func (p *CloudflareProvider) NewTracks(ctx context.Context, sessionID string, request TracksRequest) (TracksResponse, error) {
	if !validIdentifier(sessionID, maxSessionIDBytes) || !validTracksRequest(request) {
		return TracksResponse{}, ErrUpstream
	}
	var response TracksResponse
	if err := p.do(ctx, http.MethodPost, "sessions/"+url.PathEscape(sessionID)+"/tracks/new", request, http.StatusOK, &response); err != nil {
		return TracksResponse{}, err
	}
	if !validTracksResponse(response) || !validNewTracksResponse(request, response) {
		return TracksResponse{}, ErrUpstream
	}
	return response, nil
}

func (p *CloudflareProvider) Renegotiate(ctx context.Context, sessionID string, description SessionDescription) (TracksResponse, error) {
	if !validIdentifier(sessionID, maxSessionIDBytes) || !validDescription(description) {
		return TracksResponse{}, ErrUpstream
	}
	var response TracksResponse
	request := struct {
		SessionDescription SessionDescription `json:"sessionDescription"`
	}{SessionDescription: description}
	if err := p.do(ctx, http.MethodPut, "sessions/"+url.PathEscape(sessionID)+"/renegotiate", request, http.StatusOK, &response); err != nil {
		return TracksResponse{}, err
	}
	if !validTracksResponse(response) || len(response.Tracks) != 0 ||
		(response.SessionDescription != nil && response.SessionDescription.Type != "offer") {
		return TracksResponse{}, ErrUpstream
	}
	return response, nil
}

func (p *CloudflareProvider) UpdateTracks(ctx context.Context, sessionID string, request UpdateTracksRequest) (TracksResponse, error) {
	if !validIdentifier(sessionID, maxSessionIDBytes) || len(request.Tracks) == 0 || len(request.Tracks) > 64 {
		return TracksResponse{}, ErrUpstream
	}
	seenMIDs := make(map[string]bool, len(request.Tracks))
	for _, track := range request.Tracks {
		if track.Location != "remote" || !validIdentifier(track.MID, maxTrackIDBytes) || !validIdentifier(track.SessionID, maxSessionIDBytes) || !validIdentifier(track.TrackName, maxTrackIDBytes) {
			return TracksResponse{}, ErrUpstream
		}
		if seenMIDs[track.MID] {
			return TracksResponse{}, ErrUpstream
		}
		seenMIDs[track.MID] = true
	}
	var response TracksResponse
	if err := p.do(ctx, http.MethodPut, "sessions/"+url.PathEscape(sessionID)+"/tracks/update", request, http.StatusOK, &response); err != nil {
		return TracksResponse{}, err
	}
	if !validTracksResponse(response) || !validUpdatedTracksResponse(request, response) {
		return TracksResponse{}, ErrUpstream
	}
	return response, nil
}

func (p *CloudflareProvider) CloseTracks(ctx context.Context, sessionID string, request CloseTracksRequest) (TracksResponse, error) {
	if !validIdentifier(sessionID, maxSessionIDBytes) || !request.Force || len(request.Tracks) == 0 || len(request.Tracks) > 64 {
		return TracksResponse{}, ErrUpstream
	}
	seenMIDs := make(map[string]bool, len(request.Tracks))
	for _, track := range request.Tracks {
		if !validIdentifier(track.MID, maxTrackIDBytes) {
			return TracksResponse{}, ErrUpstream
		}
		if seenMIDs[track.MID] {
			return TracksResponse{}, ErrUpstream
		}
		seenMIDs[track.MID] = true
	}
	var response TracksResponse
	if err := p.do(ctx, http.MethodPut, "sessions/"+url.PathEscape(sessionID)+"/tracks/close", request, http.StatusOK, &response); err != nil {
		return TracksResponse{}, err
	}
	if !validTracksResponse(response) || !validClosedTracksResponse(request, response) {
		return TracksResponse{}, ErrUpstream
	}
	return response, nil
}

func (p *CloudflareProvider) do(ctx context.Context, method, path string, body any, expectedStatus int, destination any) error {
	encoded, err := json.Marshal(body)
	if err != nil {
		return ErrUpstream
	}
	request, err := http.NewRequestWithContext(ctx, method, p.baseURL+"/apps/"+url.PathEscape(p.appID)+"/"+path, bytes.NewReader(encoded))
	if err != nil {
		return ErrUpstream
	}
	request.Header.Set("Authorization", "Bearer "+p.appSecret)
	request.Header.Set("Content-Type", "application/json")
	response, err := p.client.Do(request)
	if err != nil {
		return ErrUpstream
	}
	defer response.Body.Close()
	limited := io.LimitReader(response.Body, maxResponseBytes+1)
	raw, err := io.ReadAll(limited)
	if err != nil || len(raw) > maxResponseBytes || response.StatusCode != expectedStatus {
		return ErrUpstream
	}
	if len(bytes.TrimSpace(raw)) == 0 {
		raw = []byte(`{}`)
	}
	if err := json.Unmarshal(raw, destination); err != nil {
		return ErrUpstream
	}
	return nil
}

func validDescription(description SessionDescription) bool {
	return (description.Type == "offer" || description.Type == "answer") && description.SDP != "" && len(description.SDP) <= maxSessionDescBytes
}

func validTracksRequest(request TracksRequest) bool {
	if request.SessionDescription != nil && !validDescription(*request.SessionDescription) {
		return false
	}
	if len(request.Tracks) == 0 || len(request.Tracks) > 64 {
		return false
	}
	seenTracks := make(map[string]bool, len(request.Tracks))
	for _, track := range request.Tracks {
		if track.Location != "local" && track.Location != "remote" {
			return false
		}
		if track.MID != "" && !validIdentifier(track.MID, maxTrackIDBytes) {
			return false
		}
		if track.SessionID != "" && !validIdentifier(track.SessionID, maxSessionIDBytes) {
			return false
		}
		if track.TrackName != "" && !validIdentifier(track.TrackName, maxTrackIDBytes) {
			return false
		}
		if track.Kind != "" && track.Kind != "audio" {
			return false
		}
		if track.Location == "local" && (track.MID == "" || track.TrackName == "" || track.SessionID != "") {
			return false
		}
		if track.Location == "remote" && (track.SessionID == "" || track.TrackName == "") {
			return false
		}
		key := track.Location + ":" + track.SessionID + ":" + track.TrackName
		if seenTracks[key] {
			return false
		}
		seenTracks[key] = true
	}
	return true
}

func validTracksResponse(response TracksResponse) bool {
	if response.ErrorCode != "" || response.ErrorDescription != "" {
		return false
	}
	if response.SessionDescription != nil && !validDescription(*response.SessionDescription) {
		return false
	}
	if len(response.Tracks) > 64 {
		return false
	}
	for _, track := range response.Tracks {
		if track.ErrorCode != "" || track.ErrorDescription != "" ||
			(track.MID != "" && !validIdentifier(track.MID, maxTrackIDBytes)) ||
			(track.TrackName != "" && !validIdentifier(track.TrackName, maxTrackIDBytes)) ||
			(track.SessionID != "" && !validIdentifier(track.SessionID, maxSessionIDBytes)) ||
			(track.Location != "" && track.Location != "local" && track.Location != "remote") ||
			(track.Kind != "" && track.Kind != "audio") {
			return false
		}
	}
	return true
}

func validNewTracksResponse(request TracksRequest, response TracksResponse) bool {
	if len(response.Tracks) != len(request.Tracks) {
		return false
	}
	local := request.SessionDescription != nil
	if local {
		if response.RequiresImmediateRenegotiation || response.SessionDescription == nil || response.SessionDescription.Type != "answer" {
			return false
		}
	} else if !response.RequiresImmediateRenegotiation || response.SessionDescription == nil || response.SessionDescription.Type != "offer" {
		return false
	}

	expected := make(map[string]Track, len(request.Tracks))
	for _, track := range request.Tracks {
		if local != (track.Location == "local") {
			return false
		}
		expected[track.TrackName] = track
	}
	seenMIDs := make(map[string]bool, len(response.Tracks))
	for _, result := range response.Tracks {
		requestTrack, ok := expected[result.TrackName]
		if !ok || !validIdentifier(result.MID, maxTrackIDBytes) || seenMIDs[result.MID] {
			return false
		}
		if local {
			if result.MID != requestTrack.MID || (result.Location != "" && result.Location != "local") {
				return false
			}
		} else if result.SessionID != requestTrack.SessionID || (result.Location != "" && result.Location != "remote") {
			return false
		}
		seenMIDs[result.MID] = true
		delete(expected, result.TrackName)
	}
	return len(expected) == 0
}

func validUpdatedTracksResponse(request UpdateTracksRequest, response TracksResponse) bool {
	if len(response.Tracks) != len(request.Tracks) || !validMutationNegotiation(response) {
		return false
	}
	expected := make(map[string]UpdateTrack, len(request.Tracks))
	for _, track := range request.Tracks {
		expected[track.MID] = track
	}
	for _, result := range response.Tracks {
		requestTrack, ok := expected[result.MID]
		if !ok || result.SessionID != requestTrack.SessionID || result.TrackName != requestTrack.TrackName || (result.Location != "" && result.Location != "remote") {
			return false
		}
		delete(expected, result.MID)
	}
	return len(expected) == 0
}

func validClosedTracksResponse(request CloseTracksRequest, response TracksResponse) bool {
	if len(response.Tracks) != len(request.Tracks) {
		return false
	}
	if request.Force {
		if response.RequiresImmediateRenegotiation || response.SessionDescription != nil {
			return false
		}
	} else if !validMutationNegotiation(response) {
		return false
	}
	expected := make(map[string]bool, len(request.Tracks))
	for _, track := range request.Tracks {
		expected[track.MID] = true
	}
	for _, result := range response.Tracks {
		if !expected[result.MID] {
			return false
		}
		delete(expected, result.MID)
	}
	return len(expected) == 0
}

func validMutationNegotiation(response TracksResponse) bool {
	if response.RequiresImmediateRenegotiation && (response.SessionDescription == nil || response.SessionDescription.Type != "offer") {
		return false
	}
	return response.SessionDescription == nil || response.SessionDescription.Type == "offer"
}
