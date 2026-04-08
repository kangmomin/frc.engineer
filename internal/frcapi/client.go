package frcapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Client calls the FRC site API to resolve account keys to permissions.
type Client struct {
	baseURL string
	http    *http.Client
}

type checkPermissionsResponse struct {
	AccountKey  string          `json:"account_key"`
	Nickname    string          `json:"nickname"`
	Role        string          `json:"role"`
	Permissions map[string]bool `json:"permissions"`
	HasAll      bool            `json:"has_all"`
}

// NewClient creates a new FRC API client.
func NewClient(baseURL string) *Client {
	return &Client{
		baseURL: strings.TrimRight(baseURL, "/"),
		http:    &http.Client{Timeout: 10 * time.Second},
	}
}

// CheckPermissions calls the FRC check-permissions endpoint.
// Returns nil map on 404 (key not found). Returns error on network/server failures.
func (c *Client) CheckPermissions(ctx context.Context, accountKey string, permissionKeys []string) (map[string]bool, error) {
	endpoint := fmt.Sprintf("%s/api/v1/users/check-permissions/%s?permissions=%s",
		c.baseURL,
		url.PathEscape(accountKey),
		url.QueryEscape(strings.Join(permissionKeys, ",")),
	)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("frcapi: build request: %w", err)
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("frcapi: request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil, nil
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("frcapi: unexpected status %d", resp.StatusCode)
	}

	var result checkPermissionsResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("frcapi: decode response: %w", err)
	}
	return result.Permissions, nil
}

// VerifyKeyResult holds the result of a verify-key call.
type VerifyKeyResult struct {
	Valid      bool    `json:"valid"`
	AccountKey string  `json:"account_key"`
	ID         string  `json:"id"`
	Nickname   string  `json:"nickname"`
	AvatarURL  *string `json:"avatar_url"`
	Role       string  `json:"role"`
	CreatedAt  string  `json:"created_at"`
}

// VerifyKey calls the FRC verify-key endpoint.
// Returns nil on 404 (key not found).
func (c *Client) VerifyKey(ctx context.Context, accountKey string) (*VerifyKeyResult, error) {
	endpoint := fmt.Sprintf("%s/api/v1/users/verify-key/%s", c.baseURL, url.PathEscape(accountKey))

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("frcapi: build request: %w", err)
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("frcapi: request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil, nil
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("frcapi: unexpected status %d", resp.StatusCode)
	}

	var result VerifyKeyResult
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("frcapi: decode response: %w", err)
	}
	return &result, nil
}

// IsAccountKey returns true if the code looks like an FRC account key (F1RC-XXXXX).
func IsAccountKey(code string) bool {
	return strings.HasPrefix(strings.ToUpper(strings.TrimSpace(code)), "F1RC-")
}
