package bandb

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestClientIP(t *testing.T) {
	// 대부분의 케이스에서 10.0.0.0/8을 엣지 프록시(신뢰 홉)로 둔다.
	const trusted = "10.0.0.0/8"

	cases := []struct {
		name         string
		xff          string
		xr           string
		addr         string
		trustedCIDRs string
		want         string
	}{
		// RemoteAddr가 신뢰 프록시일 때만 forwarded 헤더 반영.
		{"xff single via trusted proxy", "203.0.113.5", "", "10.0.0.1:1234", trusted, "203.0.113.5"},
		{"xff skips trusted hop", "203.0.113.5, 10.0.0.9", "", "10.0.0.1:1234", trusted, "203.0.113.5"},
		{"xff rightmost untrusted wins (spoof-resistant)", "1.1.1.1, 70.1.2.3", "", "10.0.0.1:1234", trusted, "70.1.2.3"},
		{"xff spaces trimmed", "  203.0.113.5 , 10.0.0.9 ", "", "10.0.0.1:1234", trusted, "203.0.113.5"},
		{"x-real-ip via trusted proxy", "", "198.51.100.7", "10.0.0.1:1234", trusted, "198.51.100.7"},
		{"ipv4-mapped normalized", "::ffff:192.0.2.9", "", "10.0.0.1:1", trusted, "192.0.2.9"},
		{"ipv6 client via trusted", "2001:db8::1", "", "10.0.0.1:1", trusted, "2001:db8::1"},

		// RemoteAddr가 신뢰 밖이면 forwarded 헤더 무시 → RemoteAddr 사용(H8).
		{"untrusted remoteaddr ignores xff", "203.0.113.5", "", "8.8.8.8:1234", trusted, "8.8.8.8"},
		{"untrusted remoteaddr ignores x-real-ip", "", "198.51.100.7", "8.8.8.8:1234", trusted, "8.8.8.8"},

		// 신뢰 프록시 미설정(기본) → 항상 RemoteAddr.
		{"no trusted config ignores xff", "203.0.113.5", "", "10.0.0.1:1234", "", "10.0.0.1"},

		// 폴백/엣지 케이스.
		{"remoteaddr fallback", "", "", "192.0.2.9:5555", trusted, "192.0.2.9"},
		{"invalid xff falls through to remoteaddr", "not-an-ip", "", "10.0.0.1:5555", trusted, "10.0.0.1"},
		{"all empty", "", "", "", trusted, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodGet, "/ws", nil)
			r.RemoteAddr = tc.addr
			if tc.xff != "" {
				r.Header.Set("X-Forwarded-For", tc.xff)
			}
			if tc.xr != "" {
				r.Header.Set("X-Real-IP", tc.xr)
			}
			if got := ClientIP(r, ParseTrustedProxies(tc.trustedCIDRs)); got != tc.want {
				t.Errorf("ClientIP() = %q, want %q", got, tc.want)
			}
		})
	}
}
