package bandb

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestClientIP(t *testing.T) {
	cases := []struct {
		name string
		xff  string
		xr   string
		addr string
		want string
	}{
		{"xff single", "203.0.113.5", "", "10.0.0.1:1234", "203.0.113.5"},
		{"xff multi takes first", "203.0.113.5, 70.1.2.3", "", "10.0.0.1:1234", "203.0.113.5"},
		{"xff spaces trimmed", "  203.0.113.5 , 70.1.2.3 ", "", "10.0.0.1:1234", "203.0.113.5"},
		{"x-real-ip fallback", "", "198.51.100.7", "10.0.0.1:1234", "198.51.100.7"},
		{"remoteaddr fallback", "", "", "192.0.2.9:5555", "192.0.2.9"},
		{"ipv4-mapped normalized", "::ffff:192.0.2.9", "", "10.0.0.1:1", "192.0.2.9"},
		{"ipv6", "2001:db8::1", "", "10.0.0.1:1", "2001:db8::1"},
		{"invalid xff falls through", "not-an-ip", "", "192.0.2.9:5555", "192.0.2.9"},
		{"all empty", "", "", "", ""},
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
			if got := ClientIP(r); got != tc.want {
				t.Errorf("ClientIP() = %q, want %q", got, tc.want)
			}
		})
	}
}
