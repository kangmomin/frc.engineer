package bandb

import "testing"

func TestCacheIP(t *testing.T) {
	c := NewCache()
	if c.HasIP("1.2.3.4") {
		t.Fatal("empty cache should ban no IPs")
	}
	c.AddIP("1.2.3.4")
	if !c.HasIP("1.2.3.4") {
		t.Error("AddIP should make HasIP true")
	}
	if c.HasIP("") {
		t.Error("empty IP must never be banned")
	}

	c.ReplaceIPs([]string{"5.6.7.8", ""})
	if c.HasIP("1.2.3.4") {
		t.Error("ReplaceIPs should swap wholesale, dropping old entries")
	}
	if !c.HasIP("5.6.7.8") {
		t.Error("ReplaceIPs should add new entries")
	}
	if c.IPCount() != 1 {
		t.Errorf("IPCount = %d, want 1 (empty dropped)", c.IPCount())
	}
}

func TestCacheNick(t *testing.T) {
	c := NewCache()
	c.ReplaceNicks([]string{"baddriver", "spammer", ""})
	if !c.HasNick("baddriver") {
		t.Error("baddriver should be banned")
	}
	if c.HasNick("gooddriver") {
		t.Error("gooddriver should not be banned")
	}
	if c.HasNick("") {
		t.Error("empty nick must never be banned")
	}
	if c.NickCount() != 2 {
		t.Errorf("NickCount = %d, want 2 (empty dropped)", c.NickCount())
	}
	if len(c.Nicknames()) != 2 {
		t.Errorf("Nicknames len = %d, want 2", len(c.Nicknames()))
	}
}
