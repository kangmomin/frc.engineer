package auth

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync"
)

const (
	authBaseURL = "https://f1-rivals-cup-production.up.railway.app/api/v1"
	productID   = "c6da03fd-4b88-48ac-87af-592776ef8dbf"
)

type User struct {
	ID            string   `json:"id"`
	Email         string   `json:"email"`
	Nickname      string   `json:"nickname"`
	Role          string   `json:"role"`
	Permissions   []string `json:"permissions"`
	EmailVerified bool     `json:"emailVerified"`
}

type AuthManager struct {
	mu          sync.RWMutex
	accessToken string
	user        *User
	hasAccess   bool
}

func NewAuthManager() *AuthManager {
	return &AuthManager{}
}

func (am *AuthManager) Login(email, password string) (*User, error) {
	// Call external login API
	body, _ := json.Marshal(map[string]string{"email": email, "password": password})
	resp, err := http.Post(authBaseURL+"/auth/login", "application/json", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("auth server unreachable")
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		var errResp struct {
			Message string `json:"message"`
		}
		if json.Unmarshal(respBody, &errResp) == nil && errResp.Message != "" {
			return nil, fmt.Errorf("%s", errResp.Message)
		}
		return nil, fmt.Errorf("login failed (status %d)", resp.StatusCode)
	}

	var loginResp struct {
		AccessToken string `json:"access_token"`
		User        User   `json:"user"`
	}
	if err := json.Unmarshal(respBody, &loginResp); err != nil {
		return nil, fmt.Errorf("invalid response from auth server")
	}

	// Check product access
	hasAccess, err := am.checkProductAccess(loginResp.AccessToken)
	if err != nil {
		return nil, fmt.Errorf("failed to verify product access")
	}
	if !hasAccess {
		return nil, fmt.Errorf("no access to this product")
	}

	am.mu.Lock()
	am.accessToken = loginResp.AccessToken
	am.user = &loginResp.User
	am.hasAccess = true
	am.mu.Unlock()

	return &loginResp.User, nil
}

func (am *AuthManager) checkProductAccess(token string) (bool, error) {
	req, err := http.NewRequest("GET", authBaseURL+"/products/"+productID+"/access", nil)
	if err != nil {
		return false, err
	}
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))

	var result struct {
		HasAccess bool `json:"has_access"`
	}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return false, err
	}
	return result.HasAccess, nil
}

func (am *AuthManager) GetState() (*User, bool) {
	am.mu.RLock()
	defer am.mu.RUnlock()
	if am.user == nil {
		return nil, false
	}
	u := *am.user
	return &u, true
}

func (am *AuthManager) Logout() {
	am.mu.Lock()
	am.accessToken = ""
	am.user = nil
	am.hasAccess = false
	am.mu.Unlock()
}
