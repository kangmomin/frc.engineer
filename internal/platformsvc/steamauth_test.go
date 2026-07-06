package platformsvc

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestClaimedIDRegex(t *testing.T) {
	cases := []struct {
		in   string
		want string // "" means no match
	}{
		{"https://steamcommunity.com/openid/id/76561197960287930", "76561197960287930"},
		{"https://steamcommunity.com/openid/id/7656119796028793", ""},   // 16 digits
		{"https://steamcommunity.com/openid/id/765611979602879300", ""}, // 18 digits
		{"http://steamcommunity.com/openid/id/76561197960287930", ""},   // not https
		{"https://evil.com/openid/id/76561197960287930", ""},            // wrong host
		{"https://steamcommunity.com.evil.com/openid/id/76561197960287930", ""},
		{"prefixhttps://steamcommunity.com/openid/id/76561197960287930", ""},
		{"https://steamcommunity.com/openid/id/76561197960287930/extra", ""},
		{"https://steamcommunity.com/openid/id/7656119796028793X", ""}, // non-digit
	}
	for _, c := range cases {
		m := claimedIDRe.FindStringSubmatch(c.in)
		got := ""
		if m != nil {
			got = m[1]
		}
		if got != c.want {
			t.Errorf("claimedIDRe(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestParseNonceTime(t *testing.T) {
	if tm, ok := parseNonceTime("2026-07-06T12:00:00Zabc123"); !ok {
		t.Fatal("expected parse ok")
	} else if tm.Year() != 2026 {
		t.Fatalf("year = %d, want 2026", tm.Year())
	}
	if _, ok := parseNonceTime("not-a-nonce"); ok {
		t.Fatal("expected parse fail for garbage")
	}
	if _, ok := parseNonceTime(""); ok {
		t.Fatal("expected parse fail for empty")
	}
}

func TestLoginURL(t *testing.T) {
	a := NewSteamAuth(nil, "", "https://p.example.com/", "https://p.example.com/auth/steam/callback", slog.Default())
	u, err := url.Parse(a.LoginURL("st4te"))
	if err != nil {
		t.Fatalf("parse login url: %v", err)
	}
	q := u.Query()
	if q.Get("openid.mode") != "checkid_setup" {
		t.Errorf("mode = %q", q.Get("openid.mode"))
	}
	if q.Get("openid.claimed_id") != "http://specs.openid.net/auth/2.0/identifier_select" {
		t.Errorf("claimed_id = %q", q.Get("openid.claimed_id"))
	}
	ret, _ := url.Parse(q.Get("openid.return_to"))
	if ret.Query().Get("state") != "st4te" {
		t.Errorf("return_to state = %q, want st4te", ret.Query().Get("state"))
	}
	if !strings.HasPrefix(a.LoginURL(""), steamOpenIDEndpoint) {
		t.Error("login url not pinned to steam endpoint")
	}
}

func TestVerifyWithSteam(t *testing.T) {
	var gotMode string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		gotMode = r.Form.Get("openid.mode")
		if r.URL.Path == "/valid" {
			io.WriteString(w, "ns:http://specs.openid.net/auth/2.0\nis_valid:true\n")
			return
		}
		io.WriteString(w, "ns:http://specs.openid.net/auth/2.0\nis_valid:false\n")
	}))
	defer srv.Close()

	a := NewSteamAuth(nil, "", "", "", slog.Default())
	a.endpoint = srv.URL + "/valid"
	vals := url.Values{"openid.sig": {"abc"}, "openid.mode": {"id_res"}, "other": {"x"}}
	if err := a.verifyWithSteam(context.Background(), vals); err != nil {
		t.Fatalf("verifyWithSteam(valid) = %v, want nil", err)
	}
	if gotMode != "check_authentication" {
		t.Errorf("posted mode = %q, want check_authentication", gotMode)
	}

	a.endpoint = srv.URL + "/invalid"
	if err := a.verifyWithSteam(context.Background(), vals); err == nil {
		t.Fatal("verifyWithSteam(invalid) = nil, want error")
	}
}

// freshNonce builds a response_nonce whose timestamp is now (within freshness).
func freshNonce() string {
	return time.Now().UTC().Format(time.RFC3339) + "salt"
}
