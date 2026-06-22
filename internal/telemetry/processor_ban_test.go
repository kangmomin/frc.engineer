package telemetry

import (
	"testing"

	"frc.engineer/internal/banlist"
	"frc.engineer/internal/packets"
)

// banTestProcessor builds a minimal Processor whose pitwall manager reports the
// given player name at the given car index — enough to exercise evaluateBan
// without a full packet pipeline.
func banTestProcessor(playerName string, playerIdx uint8) *Processor {
	pm := &PitwallManager{}
	parts := &packets.PacketParticipantsData{}
	copy(parts.Participants[playerIdx].Name[:], []byte(playerName))
	pm.participants = parts
	pm.playerIndex = playerIdx
	return &Processor{pitwallManager: pm}
}

func TestGetPlayerName(t *testing.T) {
	pm := &PitwallManager{}
	if pm.GetPlayerName() != "" {
		t.Error("nil participants should yield empty name")
	}

	parts := &packets.PacketParticipantsData{}
	copy(parts.Participants[3].Name[:], []byte("Driver3"))
	pm.participants = parts
	pm.playerIndex = 3
	if got := pm.GetPlayerName(); got != "Driver3" {
		t.Errorf("GetPlayerName = %q, want %q", got, "Driver3")
	}

	pm.playerIndex = 200 // out of range
	if pm.GetPlayerName() != "" {
		t.Error("out-of-range player index should yield empty name")
	}
}

func TestEvaluateBanNilLookup(t *testing.T) {
	p := banTestProcessor("Anyone", 0)
	if p.evaluateBan() || p.IsBanned() {
		t.Error("nil banLookup must never ban")
	}
}

func TestEvaluateBanTransitions(t *testing.T) {
	p := banTestProcessor("BannedGuy", 0)
	var transitions []bool
	p.SetBanStateChangeHandler(func(b bool) { transitions = append(transitions, b) })

	store := banlist.NewStore()
	store.Replace([]string{"bannedguy"}) // normalized match against "BannedGuy"
	p.SetBanChecker(store.IsBanned)

	if !p.evaluateBan() || !p.IsBanned() {
		t.Fatal("player on the list should be banned")
	}
	if !p.evaluateBan() {
		t.Error("should remain banned on repeat evaluation")
	}

	store.Replace(nil) // removed from list → auto-lift
	if p.evaluateBan() || p.IsBanned() {
		t.Error("ban should auto-lift once the list no longer matches")
	}

	if len(transitions) != 2 || transitions[0] != true || transitions[1] != false {
		t.Errorf("transitions = %v, want [true false] (one callback per change only)", transitions)
	}
}

func TestEvaluateBanEmptyPlayerNotBanned(t *testing.T) {
	p := banTestProcessor("", 0) // name unavailable (game not started / hidden)
	store := banlist.NewStore()
	store.Replace([]string{"bannedguy"})
	p.SetBanChecker(store.IsBanned)

	if p.evaluateBan() || p.IsBanned() {
		t.Error("empty player name must never be banned")
	}
}
