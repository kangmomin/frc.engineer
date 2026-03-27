package main

import (
	"crypto/rand"
	"fmt"
	"math/big"
	"sync"
)

type ersCompareGate struct {
	mu              sync.RWMutex
	secret          string
	enabled         bool
	generatedSecret bool
}

func newERSCompareGate(secret string) (*ersCompareGate, error) {
	gate := &ersCompareGate{}
	if secret == "" {
		pin, err := generateERSComparePIN()
		if err != nil {
			return nil, err
		}
		gate.secret = pin
		gate.generatedSecret = true
		return gate, nil
	}
	gate.secret = secret
	return gate, nil
}

func (g *ersCompareGate) Enable(password string) bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	if password != g.secret {
		return false
	}
	g.enabled = true
	return true
}

func (g *ersCompareGate) Disable() {
	g.mu.Lock()
	g.enabled = false
	g.mu.Unlock()
}

func (g *ersCompareGate) Enabled() bool {
	g.mu.RLock()
	defer g.mu.RUnlock()
	return g.enabled
}

func (g *ersCompareGate) SecretGenerated() bool {
	g.mu.RLock()
	defer g.mu.RUnlock()
	return g.generatedSecret
}

func (g *ersCompareGate) SecretForDisplay() string {
	g.mu.RLock()
	defer g.mu.RUnlock()
	if !g.generatedSecret {
		return ""
	}
	return g.secret
}

func generateERSComparePIN() (string, error) {
	const digits = "0123456789"
	out := make([]byte, 6)
	for i := range out {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(digits))))
		if err != nil {
			return "", fmt.Errorf("generate compare pin: %w", err)
		}
		out[i] = digits[n.Int64()]
	}
	return string(out), nil
}
