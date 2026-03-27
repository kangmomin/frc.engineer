package main

import "testing"

func TestERSCompareGateEnableDisable(t *testing.T) {
	gate, err := newERSCompareGate("123456")
	if err != nil {
		t.Fatalf("newERSCompareGate error: %v", err)
	}
	if gate.Enabled() {
		t.Fatal("gate should start disabled")
	}
	if gate.Enable("000000") {
		t.Fatal("gate should reject invalid password")
	}
	if gate.Enabled() {
		t.Fatal("gate should remain disabled after invalid password")
	}
	if !gate.Enable("123456") {
		t.Fatal("gate should accept valid password")
	}
	if !gate.Enabled() {
		t.Fatal("gate should be enabled after valid password")
	}
	gate.Disable()
	if gate.Enabled() {
		t.Fatal("gate should be disabled after Disable")
	}
}

func TestERSCompareGateGeneratesPINWhenSecretMissing(t *testing.T) {
	gate, err := newERSCompareGate("")
	if err != nil {
		t.Fatalf("newERSCompareGate error: %v", err)
	}
	if !gate.SecretGenerated() {
		t.Fatal("gate should mark generated secret")
	}
	pin := gate.SecretForDisplay()
	if len(pin) != 6 {
		t.Fatalf("pin length = %d, want 6", len(pin))
	}
	if !gate.Enable(pin) {
		t.Fatal("generated pin should unlock gate")
	}
}
