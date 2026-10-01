// Package decision is a small client for "System One" typed-decision models
// that speak the TypeSafe Jev wire protocol: POST {state, questions} and get
// back calibrated probabilities. The open-source laya server (laya-serve)
// implements the same protocol, so one client covers both.
//
// The engineer never lets a model compute numbers. Gaps, wear and fuel are
// evaluated in code; the model only judges whether an already-built message
// is worth saying now, and which fixed intent a driver question maps to.
package decision

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Mode selects how decisions affect the engineer.
type Mode string

const (
	// ModeOff disables all model calls.
	ModeOff Mode = "off"
	// ModeShadow asks the model but never changes what the engineer says.
	ModeShadow Mode = "shadow"
	// ModeEnforce lets the model suppress non-urgent calls. Failures fail open.
	ModeEnforce Mode = "enforce"
)

const (
	defaultPath       = "/v1/systemone"
	defaultTimeoutMs  = 1500
	minTimeoutMs      = 200
	maxTimeoutMs      = 10000
	defaultThreshold  = 0.35
	maxResponseBytes  = 1 << 20
	maxQuestionLength = 400
)

// Config is the persisted model configuration. APIKey is write-only from the
// HTTP API's point of view; callers must not echo it back.
type Config struct {
	Mode           Mode    `json:"mode"`
	URL            string  `json:"url"`
	APIKey         string  `json:"apiKey,omitempty"`
	Model          string  `json:"model,omitempty"`
	TimeoutMs      int     `json:"timeoutMs"`
	AllowRemote    bool    `json:"allowRemote"`
	SpeakThreshold float64 `json:"speakThreshold"`
	LogDecisions   bool    `json:"logDecisions"`
}

// Normalize clamps values and fills defaults. It never validates the URL;
// use Validate for that.
func (c Config) Normalize() Config {
	switch c.Mode {
	case ModeShadow, ModeEnforce:
	default:
		c.Mode = ModeOff
	}
	c.URL = strings.TrimSpace(c.URL)
	c.APIKey = strings.TrimSpace(c.APIKey)
	c.Model = strings.TrimSpace(c.Model)
	if c.TimeoutMs == 0 {
		c.TimeoutMs = defaultTimeoutMs
	}
	c.TimeoutMs = min(max(c.TimeoutMs, minTimeoutMs), maxTimeoutMs)
	if c.SpeakThreshold <= 0 || c.SpeakThreshold >= 1 {
		c.SpeakThreshold = defaultThreshold
	}
	return c
}

// ErrDisabled is returned when the mode is off or no URL is configured.
var ErrDisabled = errors.New("decision model disabled")

// Validate checks that the endpoint is usable under the privacy policy:
// loopback and private-network hosts are always allowed; any other host
// requires AllowRemote and HTTPS so an API key never travels in clear text.
func (c Config) Validate() error {
	if c.Mode == ModeOff {
		return nil
	}
	if c.URL == "" {
		return errors.New("decision model URL is required")
	}
	u, err := url.Parse(c.URL)
	if err != nil || u.Host == "" {
		return fmt.Errorf("invalid decision model URL")
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("decision model URL must use http or https")
	}
	if u.User != nil {
		return fmt.Errorf("put the API key in the key field, not in the URL")
	}
	if isLocalHost(u.Hostname()) {
		return nil
	}
	if !c.AllowRemote {
		return fmt.Errorf("remote decision model host %q requires allowRemote", u.Hostname())
	}
	if u.Scheme != "https" {
		return fmt.Errorf("remote decision model must use https")
	}
	return nil
}

func isLocalHost(host string) bool {
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && (ip.IsLoopback() || ip.IsPrivate())
}

// Endpoint resolves the request URL. A bare base URL gets /v1/systemone.
func (c Config) Endpoint() (string, error) {
	u, err := url.Parse(c.URL)
	if err != nil {
		return "", err
	}
	if u.Path == "" || u.Path == "/" {
		u.Path = defaultPath
	}
	return u.String(), nil
}

// Question is one typed question in the wire protocol.
type Question struct {
	Type         string `json:"type"` // choice | score | noul
	Instructions string `json:"instructions"`
	Criteria     any    `json:"criteria,omitempty"`
}

// Request is the wire request body.
type Request struct {
	State     any                 `json:"state"`
	Questions map[string]Question `json:"questions"`
	Model     string              `json:"model,omitempty"`
}

// Answer is one typed answer. Only the fields for its type are set.
type Answer struct {
	Type          string             `json:"type"`
	Choice        string             `json:"choice,omitempty"`
	Noul          *float64           `json:"noul,omitempty"`
	Score         *float64           `json:"score,omitempty"`
	Probabilities map[string]float64 `json:"probabilities,omitempty"`
	Confidence    float64            `json:"confidence,omitempty"`
}

// Response is the wire response body.
type Response struct {
	Model   string            `json:"model"`
	Answers map[string]Answer `json:"answers"`
	Usage   struct {
		InputTokens  int `json:"input_tokens"`
		OutputTokens int `json:"output_tokens"`
	} `json:"usage"`
}

// TopLabel returns the most probable label of a choice or score answer.
func (a Answer) TopLabel() (string, float64) {
	if a.Choice != "" {
		return a.Choice, a.Probabilities[a.Choice]
	}
	best, bestP := "", -1.0
	for label, p := range a.Probabilities {
		if p > bestP || (p == bestP && label < best) {
			best, bestP = label, p
		}
	}
	return best, max(bestP, 0)
}

// Client calls a Jev-compatible endpoint.
type Client struct {
	cfg  Config
	http *http.Client
}

// NewClient returns a client for cfg, or ErrDisabled / a validation error.
func NewClient(cfg Config) (*Client, error) {
	cfg = cfg.Normalize()
	if cfg.Mode == ModeOff || cfg.URL == "" {
		return nil, ErrDisabled
	}
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	return &Client{cfg: cfg, http: &http.Client{
		Timeout: time.Duration(cfg.TimeoutMs) * time.Millisecond,
		// Never follow redirects: the Authorization header must not leak.
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}}, nil
}

// Config returns the normalized configuration the client was built with.
func (c *Client) Config() Config { return c.cfg }

// Ask sends one request and decodes the typed answers.
func (c *Client) Ask(ctx context.Context, state any, questions map[string]Question) (*Response, error) {
	for id, q := range questions {
		if len(q.Instructions) > maxQuestionLength {
			return nil, fmt.Errorf("question %s too long", id)
		}
	}
	endpoint, err := c.cfg.Endpoint()
	if err != nil {
		return nil, err
	}
	body, err := json.Marshal(Request{State: state, Questions: questions, Model: c.cfg.Model})
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, time.Duration(c.cfg.TimeoutMs)*time.Millisecond)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if c.cfg.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.cfg.APIKey)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return nil, fmt.Errorf("decision model HTTP %d", resp.StatusCode)
	}
	var out Response
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("decision model response: %w", err)
	}
	for id := range questions {
		if _, ok := out.Answers[id]; !ok {
			return nil, fmt.Errorf("decision model omitted answer %q", id)
		}
	}
	return &out, nil
}
