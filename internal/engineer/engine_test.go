package engineer

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"frc.engineer/internal/dto"
	"frc.engineer/internal/engineer/decision"
	"frc.engineer/internal/packets"
)

type harness struct {
	t      *testing.T
	e      *Engine
	now    time.Time
	inputs Inputs
	state  *dto.PitwallState
	got    <-chan Call
	mu     sync.Mutex
}

func newHarness(t *testing.T, mutate func(*Settings)) *harness {
	t.Helper()
	h := &harness{t: t, now: time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC)}
	s := DefaultSettings()
	if mutate != nil {
		mutate(&s)
	}
	h.e = New(Config{
		Now:             func() time.Time { h.mu.Lock(); defer h.mu.Unlock(); return h.now },
		Inputs:          func() Inputs { h.mu.Lock(); defer h.mu.Unlock(); return h.inputs },
		DecisionLogPath: t.TempDir() + "/decisions.jsonl",
	}, s)
	h.got, _ = h.e.Subscribe()
	h.state = raceState()
	return h
}

// raceState: player (index 1) P2 on lap 5 of 20, Alpha P1 ahead, Bravo P3 behind.
func raceState() *dto.PitwallState {
	return &dto.PitwallState{
		SessionUID:  "77",
		PlayerIndex: 1,
		GameFormat:  2025,
		Session: &dto.SessionInfo{SessionType: "Race", TotalLaps: 20, SafetyCar: "none", Weather: "clear",
			PitStopWindowIdealLap: 10, PitStopWindowLatestLap: 13, PitStopRejoinPosition: 4},
		Drivers: []dto.DriverInfo{
			{Index: 0, Name: "Alpha", Position: 1, CurrentLapNum: 5, ResultStatus: 2, TireCompound: "medium", TireAge: 4},
			{Index: 1, Name: "Me", Position: 2, CurrentLapNum: 5, ResultStatus: 2, DeltaToCarInFront: 2500,
				FuelInTank: 50, FuelRemainingLaps: 0.4, TireWear: [4]int{20, 22, 18, 19}, TireCompound: "medium", TireAge: 4,
				Damage: &dto.CarDamage{}},
			{Index: 2, Name: "Bravo", Position: 3, CurrentLapNum: 5, ResultStatus: 2, DeltaToCarInFront: 3000, TireCompound: "hard", TireAge: 4},
		},
	}
}

func (h *harness) me() *dto.DriverInfo { return &h.state.Drivers[1] }

func (h *harness) advance(d time.Duration) {
	h.mu.Lock()
	h.now = h.now.Add(d)
	h.mu.Unlock()
}

// emit sends a deep copy of the current state and runs one step.
func (h *harness) emit() {
	b, _ := json.Marshal(h.state)
	var cp dto.PitwallState
	_ = json.Unmarshal(b, &cp)
	h.e.ObserveState(0, h.now, &cp)
	h.e.Step()
}

// drain lets queued calls out by advancing time in small steps.
func (h *harness) drain(steps int) []Call {
	var out []Call
	for i := 0; i < steps; i++ {
		h.advance(time.Second)
		h.e.Step()
		out = append(out, h.take()...)
	}
	return out
}

func (h *harness) take() []Call {
	var out []Call
	for {
		select {
		case c := <-h.got:
			out = append(out, c)
		default:
			return out
		}
	}
}

func keys(calls []Call) string {
	k := make([]string, len(calls))
	for i, c := range calls {
		k[i] = c.Key
	}
	return strings.Join(k, ",")
}

func hasKey(calls []Call, prefix string) bool {
	for _, c := range calls {
		if strings.HasPrefix(c.Key, prefix) {
			return true
		}
	}
	return false
}

func TestFirstSnapshotIsSilentAndPitWindowFiresOnce(t *testing.T) {
	h := newHarness(t, nil)
	h.emit()
	if c := h.drain(3); len(c) != 0 {
		t.Fatalf("baseline snapshot spoke: %s", keys(c))
	}
	h.me().CurrentLapNum = 9
	h.emit()
	c := h.drain(3)
	if !hasKey(c, "pit.soon.10-13") {
		t.Fatalf("missing pit soon: %s", keys(c))
	}
	h.me().CurrentLapNum = 10
	h.emit()
	c = h.drain(5)
	if !hasKey(c, "pit.open.10-13") || !strings.Contains(c[len(c)-1].Text+keys(c), "pit.open") {
		t.Fatalf("missing pit open: %s", keys(c))
	}
	for _, call := range c {
		if strings.HasPrefix(call.Key, "pit.open") && (!strings.Contains(call.Text, "P4") || call.Basis != BasisGame) {
			t.Fatalf("pit call must cite game projection: %+v", call)
		}
	}
	h.emit()
	if c := h.drain(3); hasKey(c, "pit.open") {
		t.Fatal("pit window repeated")
	}
}

func TestFuelShortThenRecoveredWithHysteresis(t *testing.T) {
	h := newHarness(t, func(s *Settings) { s.Verbosity = VerbosityDetailed })
	h.emit()
	h.me().FuelRemainingLaps = -0.4
	h.emit()
	c := h.drain(3)
	if !hasKey(c, "fuel.short") {
		t.Fatalf("missing fuel short: %s", keys(c))
	}
	if !strings.Contains(c[0].Text, "0.4랩 부족") {
		t.Fatalf("fuel text: %q", c[0].Text)
	}
	h.me().FuelRemainingLaps = -0.5
	h.emit()
	if c := h.drain(2); hasKey(c, "fuel.short") {
		t.Fatal("fuel short repeated without re-arm")
	}
	h.me().FuelRemainingLaps = 0.2
	h.emit()
	if c := h.drain(3); !hasKey(c, "fuel.ok") {
		t.Fatalf("missing fuel recovered: %s", keys(c))
	}
}

func TestUrgentBypassesBrakeGateButNormalWaits(t *testing.T) {
	h := newHarness(t, nil)
	h.emit()
	h.inputs = Inputs{Valid: true, SpeedKPH: 250, Brake: 0.9}
	h.me().TireWear = [4]int{61, 20, 20, 20} // normal priority tyre warning
	h.state.Session.SafetyCar = "full"       // urgent
	h.emit()
	c := h.drain(3)
	if keys(c) != "sc.full.5" {
		t.Fatalf("while braking only urgent should pass, got %s", keys(c))
	}
	h.inputs = Inputs{Valid: true, SpeedKPH: 300}
	c = h.drain(4)
	if !hasKey(c, "tyre.warn.0") {
		t.Fatalf("held call not released on the straight: %s", keys(c))
	}
}

func TestSpacingKeepsCallsFromOverlapping(t *testing.T) {
	h := newHarness(t, nil)
	h.emit()
	h.me().TireWear = [4]int{61, 20, 20, 20}
	h.me().TotalWarnings = 1
	h.emit()
	first := h.take()
	if len(first) != 1 {
		t.Fatalf("expected exactly one immediate call, got %s", keys(first))
	}
	h.advance(500 * time.Millisecond)
	h.e.Step()
	if c := h.take(); len(c) != 0 {
		t.Fatalf("second call talked over the first: %s", keys(c))
	}
	if c := h.drain(8); len(c) != 1 {
		t.Fatalf("second call never released: %s", keys(c))
	}
}

func TestRivalPitAndGapCalls(t *testing.T) {
	h := newHarness(t, nil)
	h.emit()
	h.state.Drivers[0].NumPitStops = 1
	h.state.Drivers[0].TireCompound = "hard"
	h.state.Drivers[2].DeltaToCarInFront = 900
	h.emit()
	c := h.drain(10)
	if !hasKey(c, "rival.pit.0.1") || !hasKey(c, "gap.behind.2") {
		t.Fatalf("rival calls missing: %s", keys(c))
	}
	for _, call := range c {
		if call.Key == "rival.pit.0.1" && !strings.Contains(call.Text, "하드") {
			t.Fatalf("new compound missing: %q", call.Text)
		}
	}
	// Still within a second: no repeat until the gap opens past the re-arm line.
	h.state.Drivers[2].DeltaToCarInFront = 800
	h.emit()
	if c := h.drain(3); hasKey(c, "gap.behind") {
		t.Fatal("gap call repeated without re-arm")
	}
}

func TestPenaltiesAndUnserved(t *testing.T) {
	h := newHarness(t, nil)
	h.emit()
	h.me().Penalties = 5
	h.me().NumUnservedDriveThroughs = 1
	h.emit()
	c := h.drain(6)
	if !hasKey(c, "pen.5") || !hasKey(c, "unserved.dt.1") || c[0].Key != "unserved.dt.1" {
		t.Fatalf("penalty calls wrong (urgent first): %s", keys(c))
	}
}

func TestDamageJumpAndFault(t *testing.T) {
	h := newHarness(t, nil)
	h.emit()
	h.me().Damage = &dto.CarDamage{FrontLeftWing: 35, Floor: 5, DRSFault: true}
	h.emit()
	c := h.drain(6)
	if !hasKey(c, "damage.frontLeftWing") || !hasKey(c, "fault.drs") {
		t.Fatalf("damage calls: %s", keys(c))
	}
}

func TestWeatherForecastRainSoon(t *testing.T) {
	h := newHarness(t, nil)
	h.emit()
	h.state.Session.WeatherForecast = []dto.WeatherForecastDTO{{TimeOffset: 0, RainPercentage: 10}, {TimeOffset: 10, RainPercentage: 60, Weather: "light_rain"}}
	h.emit()
	c := h.drain(3)
	if !hasKey(c, "rain.soon.10") {
		t.Fatalf("rain forecast missing: %s", keys(c))
	}
	h.emit()
	if c := h.drain(3); hasKey(c, "rain.soon") {
		t.Fatal("rain call repeated")
	}
}

func TestSessionChangeResetsAndFlashbackIsSilent(t *testing.T) {
	h := newHarness(t, nil)
	h.emit()
	h.me().CurrentLapNum = 10
	h.emit()
	h.drain(4)
	// Flashback to lap 9 then forward to 10 again: no repeat.
	h.me().CurrentLapNum = 9
	h.emit()
	h.me().CurrentLapNum = 10
	h.emit()
	if c := h.drain(4); hasKey(c, "pit.") {
		t.Fatalf("flashback repeated pit calls: %s", keys(c))
	}
	// New session: the first snapshot is a baseline again.
	h.state.SessionUID = "78"
	h.emit()
	if c := h.drain(3); len(c) != 0 {
		t.Fatalf("new session baseline spoke: %s", keys(c))
	}
}

func TestVerbosityAndCategoryFilters(t *testing.T) {
	h := newHarness(t, func(s *Settings) { s.Verbosity = VerbosityMinimal; s.Categories.Tyres = false })
	h.emit()
	h.me().TireWear = [4]int{90, 20, 20, 20} // high priority but muted category
	h.me().TotalWarnings = 1                 // normal priority, below minimal
	h.me().Penalties = 5                     // high
	h.emit()
	c := h.drain(6)
	if keys(c) != "pen.5" {
		t.Fatalf("filters wrong: %s", keys(c))
	}
}

func TestDisabledEngineStaysSilentButBriefingAnswers(t *testing.T) {
	h := newHarness(t, func(s *Settings) { s.Enabled = false })
	h.emit()
	h.me().Penalties = 5
	h.emit()
	if c := h.drain(3); len(c) != 0 {
		t.Fatalf("disabled engine spoke: %s", keys(c))
	}
	h.e.Briefing("api")
	c := h.drain(2)
	if len(c) != 1 || !strings.Contains(c[0].Text, "P2") || !strings.Contains(c[0].Text, "앞차 2.5초") {
		t.Fatalf("briefing: %+v", c)
	}
}

func TestButtonBriefingAndRepeatRisingEdge(t *testing.T) {
	h := newHarness(t, func(s *Settings) { s.BriefingButton = 1; s.RepeatButton = 2 })
	h.emit()
	press := func(status uint32) {
		h.e.ObserveEvent(1, &packets.PacketEventData{EventStringCode: packets.EventButtonStatus, EventDetails: &packets.ButtonsEvent{ButtonStatus: status}})
		h.e.Step()
	}
	press(packets.UDPActionMask(1))
	press(packets.UDPActionMask(1)) // held: no second briefing
	c := h.drain(3)
	if len(c) != 1 || c[0].Source != "briefing" {
		t.Fatalf("button briefing: %+v", c)
	}
	press(0)
	press(packets.UDPActionMask(2))
	c = h.drain(12) // waits for the long briefing to finish speaking
	if len(c) != 1 || c[0].Source != "repeat" || c[0].Text != h.e.Recent()[0].Text {
		t.Fatalf("repeat: %+v", c)
	}
}

func TestSafetyCarEventAndFlashbackFlush(t *testing.T) {
	h := newHarness(t, nil)
	h.emit()
	h.inputs = Inputs{Valid: true, Brake: 1}
	h.e.ObserveEvent(1, &packets.PacketEventData{EventStringCode: packets.EventSafetyCarStatus, EventDetails: &packets.SafetyCarEvent{SafetyCarType: 1, EventType: 1}})
	h.e.Step()
	if c := h.take(); len(c) != 0 {
		t.Fatal("high priority call must wait for the brake gate")
	}
	h.e.ObserveEvent(1, &packets.PacketEventData{EventStringCode: packets.EventFlashback})
	h.inputs = Inputs{}
	if c := h.drain(3); len(c) != 0 {
		t.Fatalf("flashback did not flush queue: %s", keys(c))
	}
}

func TestAskKeywordAnswersAndStaleness(t *testing.T) {
	h := newHarness(t, func(s *Settings) { s.Language = "en" })
	if a := h.e.Ask(context.Background(), "gap behind?"); a.Text != "No data yet." {
		t.Fatalf("no data answer: %+v", a)
	}
	h.emit()
	for q, want := range map[string]string{
		"what's the gap to the car behind": "Bravo is 3.0 behind.",
		"how is the fuel":                  "Fuel plus 0.4 laps. Game figure.",
		"pit window?":                      "Game pit window laps 10 to 13. Current lap 5. Boxing now rejoins P4, game projection.",
		"hello":                            "I did not catch that",
	} {
		a := h.e.Ask(context.Background(), q)
		if !strings.HasPrefix(a.Text, want) || a.Call == nil {
			t.Errorf("%q: got %q", q, a.Text)
		}
	}
	h.advance(10 * time.Second)
	if a := h.e.Ask(context.Background(), "fuel"); a.Text != "No recent telemetry." {
		t.Fatalf("stale: %q", a.Text)
	}
	if got := classifyKeywords("앞차랑 몇 초야?"); got != IntentGapAhead {
		t.Fatalf("korean keyword: %s", got)
	}
	if got := classifyKeywords("비교해줘"); got != IntentUnknown {
		t.Fatalf("'비' must not match inside other words: %s", got)
	}
}

func modelServer(t *testing.T, speak float64, intent string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req decision.Request
		_ = json.NewDecoder(r.Body).Decode(&req)
		answers := map[string]any{}
		if _, ok := req.Questions["speak"]; ok {
			answers["speak"] = map[string]any{"type": "noul", "noul": speak}
			answers["urgency"] = map[string]any{"type": "score", "probabilities": map[string]float64{"soon": 0.7, "immediately": 0.3}}
		}
		if _, ok := req.Questions["intent"]; ok {
			answers["intent"] = map[string]any{"type": "choice", "choice": intent, "probabilities": map[string]float64{intent: 0.9}}
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"model": "fake", "answers": answers})
	}))
}

func waitFor(t *testing.T, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatal("timed out")
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestEnforceModeSuppressesLowValueCalls(t *testing.T) {
	srv := modelServer(t, 0.1, IntentFuel)
	defer srv.Close()
	h := newHarness(t, func(s *Settings) {
		s.Decision = decision.Config{Mode: decision.ModeEnforce, URL: srv.URL, TimeoutMs: 2000, LogDecisions: true}
	})
	h.emit()
	h.me().TotalWarnings = 1 // normal priority → asks the model
	h.me().Penalties = 5     // high priority → asks the model
	h.emit()
	waitFor(t, func() bool { h.e.Step(); return len(h.e.Decisions()) >= 2 })
	c := h.drain(4)
	if len(c) != 0 {
		t.Fatalf("model suppression ignored: %s", keys(c))
	}
	st := h.e.Status()
	if st.Suppressed != 2 || st.DecisionCount != 2 {
		t.Fatalf("status: %+v", st)
	}
	if d := h.e.Decisions()[0]; !d.Applied || d.ModelAction != "suppress" || d.SpeakProb == nil {
		t.Fatalf("record: %+v", d)
	}
	// Urgent calls never wait for the model.
	h.state.Session.SafetyCar = "full"
	h.emit()
	if c := h.take(); keys(c) != "sc.full.5" {
		t.Fatalf("urgent waited for model: %s", keys(c))
	}
	// Intent: enforce mode uses a confident model intent.
	a := h.e.Ask(context.Background(), "음 그거 어때")
	if a.Intent != IntentFuel || a.Source != "model" {
		t.Fatalf("model intent not applied: %+v", a)
	}
}

func TestShadowModeNeverChangesOutput(t *testing.T) {
	srv := modelServer(t, 0.05, IntentWeather)
	defer srv.Close()
	h := newHarness(t, func(s *Settings) {
		s.Decision = decision.Config{Mode: decision.ModeShadow, URL: srv.URL}
	})
	h.emit()
	h.me().Penalties = 5
	h.emit()
	c := h.drain(2)
	if !hasKey(c, "pen.5") {
		t.Fatalf("shadow mode changed output: %s", keys(c))
	}
	waitFor(t, func() bool { return len(h.e.Decisions()) == 1 })
	if d := h.e.Decisions()[0]; d.Applied || d.ModelAction != "suppress" || d.Mode != "shadow" {
		t.Fatalf("shadow record: %+v", d)
	}
	a := h.e.Ask(context.Background(), "fuel?")
	if a.Intent != IntentFuel || a.ModelIntent != IntentWeather || a.Source != "keywords" {
		t.Fatalf("shadow intent applied: %+v", a)
	}
}

func TestEnforceFailsOpenWhenModelDown(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "down", http.StatusServiceUnavailable)
	}))
	defer srv.Close()
	h := newHarness(t, func(s *Settings) {
		s.Decision = decision.Config{Mode: decision.ModeEnforce, URL: srv.URL}
	})
	h.emit()
	h.me().Penalties = 5
	h.emit()
	waitFor(t, func() bool { h.e.Step(); return len(h.e.Decisions()) == 1 })
	if c := h.drain(2); !hasKey(c, "pen.5") {
		t.Fatalf("model failure suppressed call: %s", keys(c))
	}
	if st := h.e.Status(); st.DecisionErrors != 1 || st.DecisionLastErr == "" {
		t.Fatalf("error not reported: %+v", st)
	}
}

func TestSetSettingsRejectsUnsafeRemoteModel(t *testing.T) {
	h := newHarness(t, nil)
	s := h.e.Settings()
	s.Decision = decision.Config{Mode: decision.ModeShadow, URL: "https://api.typesafe.ai"}
	if err := h.e.SetSettings(s); err == nil {
		t.Fatal("remote host accepted without allowRemote")
	}
	s.Decision.AllowRemote = true
	if err := h.e.SetSettings(s); err != nil {
		t.Fatal(err)
	}
}

func TestRunStopsAndClosesSubscribers(t *testing.T) {
	e := New(Config{}, DefaultSettings())
	ch, _ := e.Subscribe()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { e.Run(ctx); close(done) }()
	e.Test()
	select {
	case c := <-ch:
		if c.Source != "test" {
			t.Fatalf("unexpected call %+v", c)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("test call not delivered by Run")
	}
	cancel()
	<-done
	if _, ok := <-ch; ok {
		t.Fatal("subscriber not closed")
	}
}

func TestLapBriefingFinalLapAndUndercutSignal(t *testing.T) {
	var strat dto.StrategyOverlayData
	h := &harness{t: t, now: time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC)}
	s := DefaultSettings()
	s.Categories.LapBriefing = true
	h.e = New(Config{
		Now:      func() time.Time { return h.now },
		Strategy: func() *dto.StrategyOverlayData { cp := strat; return &cp },
	}, s)
	h.got, _ = h.e.Subscribe()
	h.state = raceState()
	strat = dto.StrategyOverlayData{Mode: "race", UndercutVerdict: "NO"}
	h.emit()
	h.me().CurrentLapNum = 20
	strat = dto.StrategyOverlayData{Mode: "race", UndercutVerdict: "VIABLE", CarAhead: &dto.StrategyCar{Name: "Alpha"}}
	h.emit()
	c := h.drain(30)
	if !hasKey(c, "final") || !hasKey(c, "brief.lap.20") || !hasKey(c, "strategy.undercut.20") {
		t.Fatalf("line calls missing: %s", keys(c))
	}
	for _, call := range c {
		if strings.HasPrefix(call.Key, "strategy.") && call.Basis != BasisHeuristic {
			t.Fatalf("undercut must be labelled heuristic: %+v", call)
		}
	}
}

func TestStaleTelemetryReleasesBrakeGate(t *testing.T) {
	h := newHarness(t, nil)
	h.emit()
	h.inputs = Inputs{Valid: true, SpeedKPH: 200, Brake: 1}
	h.me().Penalties = 5
	h.emit()
	if c := h.drain(2); len(c) != 0 {
		t.Fatalf("call released while braking: %s", keys(c))
	}
	// Telemetry stops (game paused) with the last sample still braking.
	if c := h.drain(5); !hasKey(c, "pen.5") {
		t.Fatalf("frozen braking input held the call: %s", keys(c))
	}
}
