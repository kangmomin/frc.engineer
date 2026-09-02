package turncredentials

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	providerTimeout     = 3 * time.Second
	maxResponseBytes    = 64 * 1024
	maxICEServers       = 16
	maxURLsPerServer    = 8
	maxICEURLLength     = 2048
	maxCredentialLength = 4096
)

var (
	// ErrUnavailable is intentionally generic: provider status, response body,
	// headers, and authorization data must never escape this package.
	ErrUnavailable       = errors.New("TURN credentials temporarily unavailable")
	ErrMalformedResponse = errors.New("TURN credential response is malformed")
)

// ICEServer is the safe JSON subset shared with signaling clients. Keeping the
// credential as a string (rather than Pion's any) prevents an unexpected JSON
// object from being relayed to browsers or the sender.
type ICEServer struct {
	URLs       []string `json:"urls"`
	Username   string   `json:"username,omitempty"`
	Credential string   `json:"credential,omitempty"`
}

// Credentials are generated per authenticated room participant and cached by
// the signaling layer for that participant's current room lifetime.
type Credentials struct {
	ICEServers []ICEServer
	IssuedAt   time.Time
	ExpiresAt  time.Time
}

// Provider is deliberately small so signaling tests can use a fake provider
// without needing provider secrets or network access.
type Provider interface {
	Generate(context.Context) (Credentials, error)
}

// CloudflareProvider calls Cloudflare's generate-ice-servers endpoint.
type CloudflareProvider struct {
	endpoint string
	token    string
	ttl      time.Duration
	client   *http.Client
	now      func() time.Time
}

// NewCloudflareProvider builds a provider for an enabled, fully valid config.
func NewCloudflareProvider(config Config) (*CloudflareProvider, error) {
	if !config.Enabled || config.KeyID == "" || config.APIToken == "" {
		return nil, ErrIncompleteConfig
	}
	if config.TTL < time.Duration(MinTTLSeconds)*time.Second || config.TTL > time.Duration(MaxTTLSeconds)*time.Second {
		return nil, ErrInvalidTTL
	}

	return &CloudflareProvider{
		endpoint: "https://rtc.live.cloudflare.com/v1/turn/keys/" + url.PathEscape(config.KeyID) + "/credentials/generate-ice-servers",
		token:    config.APIToken,
		ttl:      config.TTL,
		client: &http.Client{
			Timeout: providerTimeout,
			CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
		now: time.Now,
	}, nil
}

// Generate requests one short-lived credential set. All returned errors are
// deliberately opaque so callers cannot accidentally log provider details.
func (p *CloudflareProvider) Generate(ctx context.Context) (Credentials, error) {
	if p == nil || p.client == nil || p.endpoint == "" || p.token == "" || p.ttl <= 0 {
		return Credentials{}, ErrUnavailable
	}

	body, err := json.Marshal(struct {
		TTL int `json:"ttl"`
	}{TTL: int(p.ttl / time.Second)})
	if err != nil {
		return Credentials{}, ErrUnavailable
	}

	ctx, cancel := context.WithTimeout(ctx, providerTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.endpoint, bytes.NewReader(body))
	if err != nil {
		return Credentials{}, ErrUnavailable
	}
	req.Header.Set("Authorization", "Bearer "+p.token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := p.client.Do(req)
	if err != nil {
		return Credentials{}, ErrUnavailable
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		return Credentials{}, ErrUnavailable
	}

	responseBody, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes+1))
	if err != nil || len(responseBody) > maxResponseBytes {
		return Credentials{}, ErrMalformedResponse
	}

	var payload struct {
		ICEServers []ICEServer `json:"iceServers"`
	}
	decoder := json.NewDecoder(bytes.NewReader(responseBody))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&payload); err != nil {
		return Credentials{}, ErrMalformedResponse
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return Credentials{}, ErrMalformedResponse
	}

	servers, err := ValidateICEServers(payload.ICEServers)
	if err != nil {
		return Credentials{}, ErrMalformedResponse
	}
	issuedAt := p.now()
	return Credentials{
		ICEServers: servers,
		IssuedAt:   issuedAt,
		ExpiresAt:  issuedAt.Add(p.ttl),
	}, nil
}

// ValidateICEServers accepts only the safe WebRTC shape we can forward to a
// client. It intentionally requires an authenticated TURN/TURNS endpoint;
// STUN-only provider output is not a TURN credential response.
func ValidateICEServers(servers []ICEServer) ([]ICEServer, error) {
	if len(servers) == 0 || len(servers) > maxICEServers {
		return nil, ErrMalformedResponse
	}

	valid := make([]ICEServer, 0, len(servers))
	hasRelay := false
	for _, server := range servers {
		if len(server.URLs) == 0 || len(server.URLs) > maxURLsPerServer ||
			len(server.Username) > maxCredentialLength || len(server.Credential) > maxCredentialLength {
			return nil, ErrMalformedResponse
		}
		if strings.TrimSpace(server.Username) != server.Username || strings.TrimSpace(server.Credential) != server.Credential {
			return nil, ErrMalformedResponse
		}
		hasUsername := server.Username != ""
		hasCredential := server.Credential != ""
		if hasUsername != hasCredential {
			return nil, ErrMalformedResponse
		}

		copyServer := ICEServer{
			URLs:       make([]string, 0, len(server.URLs)),
			Username:   server.Username,
			Credential: server.Credential,
		}
		serverHasRelay := false
		for _, rawURL := range server.URLs {
			if rawURL == "" || len(rawURL) > maxICEURLLength || strings.TrimSpace(rawURL) != rawURL {
				return nil, ErrMalformedResponse
			}
			parsed, err := url.Parse(rawURL)
			if err != nil || parsed.Scheme == "" || (parsed.Opaque == "" && parsed.Host == "") {
				return nil, ErrMalformedResponse
			}
			switch strings.ToLower(parsed.Scheme) {
			case "stun":
			case "turn", "turns":
				serverHasRelay = true
			default:
				return nil, ErrMalformedResponse
			}
			copyServer.URLs = append(copyServer.URLs, rawURL)
		}
		if serverHasRelay && !hasUsername {
			return nil, ErrMalformedResponse
		}
		if !serverHasRelay && hasUsername {
			return nil, ErrMalformedResponse
		}
		hasRelay = hasRelay || serverHasRelay
		valid = append(valid, copyServer)
	}
	if !hasRelay {
		return nil, ErrMalformedResponse
	}
	return valid, nil
}
