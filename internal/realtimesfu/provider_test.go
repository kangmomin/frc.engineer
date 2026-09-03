package realtimesfu

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const (
	testAppID     = "test-app-id"
	testAppSecret = "test-app-secret"
)

func TestLoadConfigFromEnv(t *testing.T) {
	t.Setenv(EnvAppID, "")
	t.Setenv(EnvAppSecret, "")
	config, err := LoadConfigFromEnv()
	if err != nil || config.Enabled {
		t.Fatalf("empty config = %+v, %v", config, err)
	}
	t.Setenv(EnvAppID, testAppID)
	if _, err := LoadConfigFromEnv(); err == nil {
		t.Fatal("incomplete config was accepted")
	}
	t.Setenv(EnvAppSecret, testAppSecret)
	config, err = LoadConfigFromEnv()
	if err != nil || !config.Enabled || config.AppID != testAppID || config.AppSecret != testAppSecret {
		t.Fatalf("enabled config = %+v, %v", config, err)
	}
}

func TestCloudflareProviderOfficialEndpoints(t *testing.T) {
	requests := make(chan string, 6)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+testAppSecret {
			t.Errorf("authorization = %q", r.Header.Get("Authorization"))
		}
		body, _ := io.ReadAll(r.Body)
		requests <- r.Method + " " + r.URL.Path + " " + string(body)
		switch {
		case strings.HasSuffix(r.URL.Path, "/sessions/new"):
			if len(body) != 0 {
				t.Errorf("new session body = %q, want empty", body)
			}
			if contentType := r.Header.Get("Content-Type"); contentType != "" {
				t.Errorf("new session content type = %q, want empty", contentType)
			}
			w.WriteHeader(http.StatusCreated)
			_, _ = w.Write([]byte(`{"sessionId":"provider-session-1"}`))
		case strings.HasSuffix(r.URL.Path, "/tracks/new"):
			if strings.Contains(string(body), `"location":"remote"`) {
				_, _ = w.Write([]byte(`{"requiresImmediateRenegotiation":true,"sessionDescription":{"type":"offer","sdp":"v=0"},"tracks":[{"location":"remote","mid":"1","sessionId":"source-session","trackName":"source-track"}]}`))
			} else {
				_, _ = w.Write([]byte(`{"sessionDescription":{"type":"answer","sdp":"v=0"},"tracks":[{"location":"local","mid":"0","trackName":"opaque-track"}]}`))
			}
		case strings.HasSuffix(r.URL.Path, "/renegotiate"):
			_, _ = w.Write([]byte(`{}`))
		case strings.HasSuffix(r.URL.Path, "/tracks/update"):
			_, _ = w.Write([]byte(`{"tracks":[{"location":"remote","mid":"1","sessionId":"source-session","trackName":"source-track"}]}`))
		case strings.HasSuffix(r.URL.Path, "/tracks/close"):
			_, _ = w.Write([]byte(`{"tracks":[{"mid":"1"}]}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	provider := newTestProvider(t, server.URL, server.Client())
	ctx := context.Background()
	session, err := provider.NewSession(ctx)
	if err != nil || session.SessionID != "provider-session-1" {
		t.Fatalf("new session = %+v, %v", session, err)
	}
	response, err := provider.NewTracks(ctx, session.SessionID, TracksRequest{
		SessionDescription: &SessionDescription{Type: "offer", SDP: "v=0"},
		Tracks:             []Track{{Location: "local", MID: "0", TrackName: "opaque-track", Kind: "audio"}},
	})
	if err != nil || response.SessionDescription == nil || response.SessionDescription.Type != "answer" {
		t.Fatalf("new tracks = %+v, %v", response, err)
	}
	response, err = provider.NewTracks(ctx, session.SessionID, TracksRequest{
		Tracks: []Track{{Location: "remote", SessionID: "source-session", TrackName: "source-track", Kind: "audio"}},
	})
	if err != nil || !response.RequiresImmediateRenegotiation || response.SessionDescription == nil || response.SessionDescription.Type != "offer" {
		t.Fatalf("new remote tracks = %+v, %v", response, err)
	}
	if _, err := provider.Renegotiate(ctx, session.SessionID, SessionDescription{Type: "answer", SDP: "v=0"}); err != nil {
		t.Fatal(err)
	}
	if _, err := provider.UpdateTracks(ctx, session.SessionID, UpdateTracksRequest{Tracks: []UpdateTrack{{Location: "remote", MID: "1", SessionID: "source-session", TrackName: "source-track"}}}); err != nil {
		t.Fatal(err)
	}
	if _, err := provider.CloseTracks(ctx, session.SessionID, CloseTracksRequest{Tracks: []CloseTrack{{MID: "1"}}, Force: true}); err != nil {
		t.Fatal(err)
	}

	wantPaths := []string{
		"POST /v1/apps/test-app-id/sessions/new",
		"POST /v1/apps/test-app-id/sessions/provider-session-1/tracks/new",
		"POST /v1/apps/test-app-id/sessions/provider-session-1/tracks/new",
		"PUT /v1/apps/test-app-id/sessions/provider-session-1/renegotiate",
		"PUT /v1/apps/test-app-id/sessions/provider-session-1/tracks/update",
		"PUT /v1/apps/test-app-id/sessions/provider-session-1/tracks/close",
	}
	for _, want := range wantPaths {
		got := <-requests
		if !strings.HasPrefix(got, want+" ") {
			t.Fatalf("request = %q, want prefix %q", got, want)
		}
		if strings.Contains(want, "/tracks/update") && !strings.Contains(got, `"location":"remote"`) {
			t.Fatalf("update request omitted remote location: %q", got)
		}
		if strings.Contains(want, "/tracks/close") && (!strings.Contains(got, `"force":true`) || strings.Contains(got, `"mid":"1","force"`)) {
			t.Fatalf("close request force is not top-level: %q", got)
		}
	}
}

func TestCloudflareProviderRejectsUnsafeResponses(t *testing.T) {
	tests := []struct {
		name  string
		serve func(http.ResponseWriter, *http.Request)
	}{
		{"redirect", func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, "/elsewhere", http.StatusFound) }},
		{"wrong status", func(w http.ResponseWriter, _ *http.Request) {
			http.Error(w, "secret upstream detail", http.StatusBadGateway)
		}},
		{"oversized", func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(`{"sessionId":"` + strings.Repeat("x", maxResponseBytes) + `"}`))
		}},
		{"partial track error", func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(`{"tracks":[{"mid":"0","errorCode":"bad-track"}]}`))
		}},
		{"error description only", func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(`{"errorDescription":"upstream detail","tracks":[{"location":"remote","mid":"0","sessionId":"source","trackName":"track"}]}`))
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(test.serve))
			defer server.Close()
			provider := newTestProvider(t, server.URL, server.Client())
			var err error
			if test.name == "partial track error" || test.name == "error description only" {
				_, err = provider.NewTracks(context.Background(), "session", TracksRequest{Tracks: []Track{{Location: "remote", SessionID: "source", TrackName: "track"}}})
			} else {
				_, err = provider.NewSession(context.Background())
			}
			if !errors.Is(err, ErrUpstream) || strings.Contains(err.Error(), "secret") || strings.Contains(err.Error(), testAppSecret) {
				t.Fatalf("error = %v", err)
			}
		})
	}
}

func TestCloudflareProviderRejectsIncompleteMutationResults(t *testing.T) {
	tests := []struct {
		name     string
		response string
		call     func(*CloudflareProvider) error
	}{
		{
			name:     "publish missing answer",
			response: `{"tracks":[{"location":"local","mid":"0","trackName":"track"}]}`,
			call: func(provider *CloudflareProvider) error {
				_, err := provider.NewTracks(context.Background(), "session", TracksRequest{SessionDescription: &SessionDescription{Type: "offer", SDP: "v=0"}, Tracks: []Track{{Location: "local", MID: "0", TrackName: "track"}}})
				return err
			},
		},
		{
			name:     "remote new missing offer",
			response: `{"tracks":[{"location":"remote","mid":"0","sessionId":"source","trackName":"track"}]}`,
			call: func(provider *CloudflareProvider) error {
				_, err := provider.NewTracks(context.Background(), "session", TracksRequest{Tracks: []Track{{Location: "remote", SessionID: "source", TrackName: "track"}}})
				return err
			},
		},
		{
			name:     "update missing result",
			response: `{}`,
			call: func(provider *CloudflareProvider) error {
				_, err := provider.UpdateTracks(context.Background(), "session", UpdateTracksRequest{Tracks: []UpdateTrack{{Location: "remote", MID: "0", SessionID: "source", TrackName: "track"}}})
				return err
			},
		},
		{
			name:     "update wrong mid",
			response: `{"tracks":[{"mid":"9","sessionId":"source","trackName":"track"}]}`,
			call: func(provider *CloudflareProvider) error {
				_, err := provider.UpdateTracks(context.Background(), "session", UpdateTracksRequest{Tracks: []UpdateTrack{{Location: "remote", MID: "0", SessionID: "source", TrackName: "track"}}})
				return err
			},
		},
		{
			name:     "close missing result",
			response: `{}`,
			call: func(provider *CloudflareProvider) error {
				_, err := provider.CloseTracks(context.Background(), "session", CloseTracksRequest{Tracks: []CloseTrack{{MID: "0"}}, Force: true})
				return err
			},
		},
		{
			name:     "forced close unexpected offer",
			response: `{"requiresImmediateRenegotiation":true,"sessionDescription":{"type":"offer","sdp":"v=0"},"tracks":[{"mid":"0"}]}`,
			call: func(provider *CloudflareProvider) error {
				_, err := provider.CloseTracks(context.Background(), "session", CloseTracksRequest{Tracks: []CloseTrack{{MID: "0"}}, Force: true})
				return err
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(test.response)) }))
			defer server.Close()
			if err := test.call(newTestProvider(t, server.URL, server.Client())); !errors.Is(err, ErrUpstream) {
				t.Fatalf("error = %v", err)
			}
		})
	}
}

func TestCloudflareProviderRejectsSessionErrorDescription(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"sessionId":"provider-session","errorDescription":"upstream failure"}`))
	}))
	defer server.Close()
	provider := newTestProvider(t, server.URL, server.Client())
	if _, err := provider.NewSession(context.Background()); !errors.Is(err, ErrUpstream) {
		t.Fatalf("error = %v", err)
	}
}

func TestCloudflareProviderValidatesInputBeforeHTTP(t *testing.T) {
	called := false
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { called = true }))
	defer server.Close()
	provider := newTestProvider(t, server.URL, server.Client())
	_, err := provider.NewTracks(context.Background(), "bad/session", TracksRequest{
		SessionDescription: &SessionDescription{Type: "offer", SDP: strings.Repeat("x", maxSessionDescBytes+1)},
		Tracks:             []Track{{Location: "local", MID: "0"}},
	})
	if !errors.Is(err, ErrUpstream) || called {
		t.Fatalf("invalid input err=%v called=%t", err, called)
	}
}

func newTestProvider(t *testing.T, endpoint string, client *http.Client) *CloudflareProvider {
	t.Helper()
	provider, err := NewCloudflareProviderForTest(Config{AppID: testAppID, AppSecret: testAppSecret, Enabled: true}, endpoint+"/v1", client)
	if err != nil {
		t.Fatal(err)
	}
	return provider
}
