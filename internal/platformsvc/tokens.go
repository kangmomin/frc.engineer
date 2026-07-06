package platformsvc

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
)

// newToken returns a fresh opaque token with 256 bits of entropy, URL-safe and
// unpadded. The raw token is shown to the client exactly once; only its hash is
// persisted.
func newToken() (string, error) {
	var b [32]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", fmt.Errorf("platformsvc: read random: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(b[:]), nil
}

// hashToken returns the sha256 hex digest of a token. Storing only the hash
// means a DB or backup leak does not hand out live sessions.
func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}
