package websocket

import "testing"

func TestIsOriginAllowed(t *testing.T) {
	tests := []struct {
		name    string
		origin  string
		allow   []string
		wantOK  bool
	}{
		{
			name:   "exact origin match",
			origin: "http://localhost:5173",
			allow:  []string{"http://localhost:5173"},
			wantOK: true,
		},
		{
			name:   "wildcard local port match",
			origin: "http://localhost:5173",
			allow:  []string{"http://localhost:*"},
			wantOK: true,
		},
		{
			name:   "scheme and host match without explicit port",
			origin: "https://example.com:443",
			allow:  []string{"https://example.com"},
			wantOK: true,
		},
		{
			name:   "global wildcard",
			origin: "https://random.example",
			allow:  []string{"*"},
			wantOK: true,
		},
		{
			name:   "origin rejected",
			origin: "https://evil.example",
			allow:  []string{"https://good.example"},
			wantOK: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := isOriginAllowed(tt.origin, tt.allow)
			if got != tt.wantOK {
				t.Fatalf("isOriginAllowed() = %v, want %v", got, tt.wantOK)
			}
		})
	}
}

