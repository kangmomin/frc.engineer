package turncredentials

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestLoadConfigFromEnv(t *testing.T) {
	t.Run("defaults disabled", func(t *testing.T) {
		config, err := loadConfig(func(string) string { return "" })
		if err != nil || config.Enabled || config.TTL != time.Duration(DefaultTTLSeconds)*time.Second {
			t.Fatalf("config = %+v, err = %v", config, err)
		}
	})
	t.Run("partial provider rejected", func(t *testing.T) {
		_, err := loadConfig(func(key string) string {
			if key == "CLOUDFLARE_TURN_KEY_ID" {
				return "test-key"
			}
			return ""
		})
		if err != ErrIncompleteConfig {
			t.Fatalf("err = %v, want ErrIncompleteConfig", err)
		}
	})
	t.Run("bounded ttl", func(t *testing.T) {
		config, err := loadConfig(func(key string) string {
			switch key {
			case "CLOUDFLARE_TURN_KEY_ID":
				return "test-key"
			case "CLOUDFLARE_TURN_API_TOKEN":
				return "test-token"
			case "CLOUDFLARE_TURN_TTL_SECONDS":
				return "12"
			default:
				return ""
			}
		})
		if err != nil || !config.Enabled || config.TTL != 12*time.Second {
			t.Fatalf("config = %+v, err = %v", config, err)
		}
	})
	t.Run("invalid ttl rejected", func(t *testing.T) {
		_, err := loadConfig(func(key string) string {
			if key == "CLOUDFLARE_TURN_TTL_SECONDS" {
				return "172801"
			}
			return ""
		})
		if err != ErrInvalidTTL {
			t.Fatalf("err = %v, want ErrInvalidTTL", err)
		}
	})
}

func TestCloudflareProviderGenerate(t *testing.T) {
	issuedAt := time.Date(2026, 9, 3, 12, 0, 0, 0, time.UTC)
	var receivedRequest atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedRequest.Store(true)
		if r.Method != http.MethodPost {
			t.Errorf("method = %s, want POST", r.Method)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer fake-test-token" {
			t.Errorf("authorization did not contain the expected fake token")
		}
		var request struct {
			TTL int `json:"ttl"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatal(err)
		}
		if request.TTL != 12 {
			t.Errorf("ttl = %d, want 12", request.TTL)
		}
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"iceServers":[{"urls":["stun:stun.example.test:3478"]},{"urls":["turn:turn.example.test:3478?transport=udp"],"username":"short-lived-user","credential":"short-lived-credential"}]}`))
	}))
	defer server.Close()

	provider := newTestProvider(t, server.URL, 12*time.Second, issuedAt)
	credentials, err := provider.Generate(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !receivedRequest.Load() || len(credentials.ICEServers) != 2 {
		t.Fatalf("credentials = %+v", credentials)
	}
	if !credentials.IssuedAt.Equal(issuedAt) || !credentials.ExpiresAt.Equal(issuedAt.Add(12*time.Second)) {
		t.Fatalf("unexpected credential lifetime: %s to %s", credentials.IssuedAt, credentials.ExpiresAt)
	}
}

func TestCloudflareProviderRejectsUnsafeResponses(t *testing.T) {
	tests := []struct {
		name    string
		handler http.HandlerFunc
		wantErr error
	}{
		{
			name: "non created status",
			handler: func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(http.StatusBadGateway)
				_, _ = w.Write([]byte("provider detail must not escape"))
			},
			wantErr: ErrUnavailable,
		},
		{
			name: "unknown response field",
			handler: func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(http.StatusCreated)
				_, _ = w.Write([]byte(`{"iceServers":[],"unexpected":"value"}`))
			},
			wantErr: ErrMalformedResponse,
		},
		{
			name: "stun only response",
			handler: func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(http.StatusCreated)
				_, _ = w.Write([]byte(`{"iceServers":[{"urls":["stun:stun.example.test:3478"]}]}`))
			},
			wantErr: ErrMalformedResponse,
		},
		{
			name: "response over 64kb",
			handler: func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(http.StatusCreated)
				_, _ = w.Write([]byte(strings.Repeat("x", maxResponseBytes+1)))
			},
			wantErr: ErrMalformedResponse,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(test.handler)
			defer server.Close()
			provider := newTestProvider(t, server.URL, time.Minute, time.Now())
			_, err := provider.Generate(context.Background())
			if err != test.wantErr {
				t.Fatalf("err = %v, want %v", err, test.wantErr)
			}
		})
	}
}

func TestCloudflareProviderRejectsRedirect(t *testing.T) {
	var redirected atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/target" {
			redirected.Store(true)
			w.WriteHeader(http.StatusCreated)
			return
		}
		http.Redirect(w, r, "/target", http.StatusTemporaryRedirect)
	}))
	defer server.Close()

	provider := newTestProvider(t, server.URL+"/generate", time.Minute, time.Now())
	_, err := provider.Generate(context.Background())
	if err != ErrUnavailable {
		t.Fatalf("err = %v, want ErrUnavailable", err)
	}
	if redirected.Load() {
		t.Fatal("provider followed a redirect")
	}
}

func TestCloudflareProviderTimeoutAndErrorsDoNotLeakSecrets(t *testing.T) {
	t.Run("caller deadline is honored", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			time.Sleep(100 * time.Millisecond)
			w.WriteHeader(http.StatusCreated)
		}))
		defer server.Close()
		provider := newTestProvider(t, server.URL, time.Minute, time.Now())
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
		defer cancel()

		_, err := provider.Generate(ctx)
		if !errors.Is(err, ErrUnavailable) {
			t.Fatalf("err = %v, want ErrUnavailable", err)
		}
	})

	t.Run("provider detail and token stay opaque", func(t *testing.T) {
		const responseSecret = "provider-body-secret"
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(responseSecret))
		}))
		defer server.Close()
		provider := newTestProvider(t, server.URL, time.Minute, time.Now())

		_, err := provider.Generate(context.Background())
		if !errors.Is(err, ErrUnavailable) {
			t.Fatalf("err = %v, want ErrUnavailable", err)
		}
		if strings.Contains(err.Error(), responseSecret) || strings.Contains(err.Error(), provider.token) {
			t.Fatalf("provider error leaked sensitive detail: %q", err.Error())
		}
	})
}

func newTestProvider(t *testing.T, endpoint string, ttl time.Duration, now time.Time) *CloudflareProvider {
	t.Helper()
	provider, err := NewCloudflareProvider(Config{
		KeyID:    "test-key",
		APIToken: "fake-test-token",
		TTL:      ttl,
		Enabled:  true,
	})
	if err != nil {
		t.Fatal(err)
	}
	provider.endpoint = endpoint
	provider.now = func() time.Time { return now }
	return provider
}
