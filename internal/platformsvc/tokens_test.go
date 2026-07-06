package platformsvc

import (
	"encoding/base64"
	"testing"
)

func TestNewTokenEntropyAndUniqueness(t *testing.T) {
	seen := map[string]bool{}
	for range 100 {
		tok, err := newToken()
		if err != nil {
			t.Fatalf("newToken: %v", err)
		}
		if seen[tok] {
			t.Fatal("newToken returned a duplicate")
		}
		seen[tok] = true
		raw, err := base64.RawURLEncoding.DecodeString(tok)
		if err != nil {
			t.Fatalf("token not base64url: %v", err)
		}
		if len(raw) != 32 {
			t.Fatalf("token entropy = %d bytes, want 32", len(raw))
		}
	}
}

func TestHashToken(t *testing.T) {
	if hashToken("abc") != hashToken("abc") {
		t.Error("hashToken not deterministic")
	}
	if hashToken("abc") == hashToken("abd") {
		t.Error("hashToken collided on different input")
	}
	if len(hashToken("abc")) != 64 {
		t.Errorf("hashToken length = %d, want 64 hex chars", len(hashToken("abc")))
	}
}
