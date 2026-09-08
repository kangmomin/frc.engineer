package main

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"frc.engineer/internal/platformsvc"
)

func automationTestConfig(t *testing.T, proxies string) (*updateLogAutomationConfig, string) {
	t.Helper()
	key := base64.RawURLEncoding.EncodeToString(make([]byte, 32))
	digest := sha256.Sum256([]byte(key))
	config, err := parseUpdateLogAutomationConfig(hex.EncodeToString(digest[:]), proxies)
	if err != nil {
		t.Fatal(err)
	}
	return config, key
}

func TestAutomationKeyConfigurationAndHeader(t *testing.T) {
	if config, err := parseUpdateLogAutomationConfig("", ""); err != nil || config != nil {
		t.Fatalf("disabled = %v/%v", config, err)
	}
	for _, raw := range []string{"secret", strings.Repeat("g", 64), strings.Repeat("a", 63)} {
		if _, err := parseUpdateLogAutomationConfig(raw, ""); err == nil || strings.Contains(err.Error(), raw) {
			t.Fatal("invalid hash accepted or exposed")
		}
	}
	for _, proxies := range []string{"all", "0.0.0.0/0", "::/0", "::ffff:10.0.0.0/104"} {
		if _, err := parseUpdateLogAutomationConfig(strings.Repeat("a", 64), proxies); err == nil {
			t.Fatalf("unsafe proxy accepted %q", proxies)
		}
	}
	config, key := automationTestConfig(t, "")
	for _, auth := range []string{"", "Basic " + key, "Bearer short", "Bearer " + key + "=", "Bearer " + key + " ", "Bearer " + strings.Repeat("A", 42) + "B"} {
		req := httptest.NewRequest("POST", "/automation/update-logs", nil)
		req.Header.Set("Authorization", auth)
		if config.validKey(req) {
			t.Fatal("invalid authorization accepted")
		}
	}
	req := httptest.NewRequest("POST", "/automation/update-logs", nil)
	req.Header.Set("Authorization", "Bearer "+key)
	if !config.validKey(req) {
		t.Fatal("valid key rejected")
	}
	req.Header.Add("Authorization", "Bearer "+key)
	if config.validKey(req) {
		t.Fatal("duplicate headers accepted")
	}
	rec := httptest.NewRecorder()
	(&server{}).handleAutomationUpdateLog(rec, req)
	if rec.Code != 404 || rec.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("disabled = %d", rec.Code)
	}
}

func TestAutomationTrustedClientIP(t *testing.T) {
	for _, tc := range []struct{ proxies, peer, forwarded, want string }{
		{"", "10.0.0.1:80", "203.0.113.1", "10.0.0.1"},
		{"10.0.0.0/8", "192.0.2.1:80", "203.0.113.1", "192.0.2.1"},
		{"10.0.0.0/8", "10.0.0.1:80", "198.51.100.1, 203.0.113.1, 10.0.0.2", "203.0.113.1"},
		{"10.0.0.0/8", "10.0.0.1:80", "invalid", "10.0.0.1"},
		{"", "[::ffff:192.0.2.1]:80", "", "192.0.2.1"},
		{"fd00::/8", "[fd00::1]:80", "2001:db8::1", "2001:db8::1"},
	} {
		config, _ := automationTestConfig(t, tc.proxies)
		req := httptest.NewRequest("POST", "/automation/update-logs", nil)
		req.RemoteAddr = tc.peer
		req.Header.Set("X-Forwarded-For", tc.forwarded)
		ip, err := config.clientIP(req)
		if err != nil || ip.String() != tc.want {
			t.Fatalf("%+v = %s/%v", tc, ip, err)
		}
	}
}

func TestAutomationHTTPAuthenticationPublicationAndThrottling(t *testing.T) {
	dsn := os.Getenv("PLATFORM_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("PLATFORM_TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	store, err := platformsvc.Open(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(store.Close)
	if err := store.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	releaseKey := fmt.Sprintf("http-test:%d", time.Now().UnixNano())
	cleanup := func() {
		_, _ = store.Pool().Exec(ctx, `DELETE FROM platform.rate_limits WHERE key LIKE 'update-log:%'`)
		_, _ = store.Pool().Exec(ctx, `DELETE FROM platform.update_logs WHERE release_key = $1`, releaseKey)
	}
	cleanup()
	t.Cleanup(cleanup)
	config, key := automationTestConfig(t, "")
	srv := &server{store: store, updateLogAutomation: config}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /automation/update-logs", srv.handleAutomationUpdateLog)
	request := func(requestCtx context.Context, ip, token, body string, want int) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest("POST", "/automation/update-logs", strings.NewReader(body)).WithContext(requestCtx)
		req.RemoteAddr = ip + ":1234"
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("X-Forwarded-For", fmt.Sprintf("203.0.113.%d", time.Now().UnixNano()%200))
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		if rec.Code != want || rec.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("response = %d/%s, want %d", rec.Code, rec.Body, want)
		}
		return rec
	}
	for range 5 {
		request(ctx, "192.0.2.1", "wrong", "not json", 401)
	}
	blocked := request(ctx, "192.0.2.1", key, "{}", 429)
	if blocked.Header().Get("Retry-After") == "" {
		t.Fatal("missing retry-after")
	}
	body := fmt.Sprintf(`{"releaseKey":%q,"title":"새 공지","body":"내용"}`, releaseKey)
	rec := request(ctx, "192.0.2.2", key, body, 201)
	var first platformsvc.UpdateLogPublication
	if err := json.Unmarshal(rec.Body.Bytes(), &first); err != nil || first.Replayed {
		t.Fatalf("first receipt = %+v/%v", first, err)
	}
	rec = request(ctx, "192.0.2.2", key, body, 200)
	var replay platformsvc.UpdateLogPublication
	if err := json.Unmarshal(rec.Body.Bytes(), &replay); err != nil || !replay.Replayed || replay.Entry.ID != first.Entry.ID {
		t.Fatalf("replay = %+v/%v", replay, err)
	}
	request(ctx, "192.0.2.2", key, strings.Replace(body, "내용", "다른 내용", 1), 409)
	request(ctx, "192.0.2.2", key, `{"title":"x","body":"y"}`, 400)
	request(ctx, "192.0.2.2", key, strings.Replace(body, `"title":`, `"extra":true,"title":`, 1), 400)
	// No fallback to a normal web session or administrator account is involved.
	request(ctx, "192.0.2.3", strings.Repeat("B", 43), body, 401)
	canceled, cancel := context.WithCancel(ctx)
	cancel()
	request(canceled, "192.0.2.4", key, body, 500)
}
