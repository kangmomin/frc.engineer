package engineer

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"frc.engineer/internal/dto"
	"frc.engineer/internal/engineer/decision"
	"frc.engineer/internal/packets"
)

const (
	tickInterval    = 200 * time.Millisecond
	staleAfter      = 5 * time.Second
	activeWindow    = 10 * time.Second
	maxActive       = 3
	subscriberBuf   = 32
	maxInboxEvents  = 64
	decisionRingCap = 200
)

// Config wires the engine to the sender. All funcs are optional.
type Config struct {
	Logger *slog.Logger
	// Inputs returns the driver's live inputs for the brake gate.
	Inputs func() Inputs
	// Strategy returns the sender's strategy overlay heuristics.
	Strategy func() *dto.StrategyOverlayData
	// Now overrides the clock in tests.
	Now func() time.Time
	// DecisionLogPath is the JSONL file for shadow-mode decision records.
	DecisionLogPath string
}

type inboxEvent struct {
	player uint8
	event  *packets.PacketEventData
}

// Engine is the virtual race engineer. It is safe for concurrent use.
type Engine struct {
	cfg    Config
	logger *slog.Logger

	inboxMu     sync.Mutex
	inboxSnap   *snapshot
	inboxEvents []inboxEvent
	wake        chan struct{}

	mu          sync.Mutex
	settings    Settings
	rules       *ruleState
	q           *queue
	last        *snapshot
	lastButtons uint32
	subs        map[int]chan Call
	nextSub     int
	suppressed  uint64

	decider        *decision.Client
	deciderErr     string
	decisionBusy   bool
	decisions      []DecisionRecord
	decisionCount  uint64
	decisionErrors uint64
	shadowSkipped  uint64

	// relay is the platform relay for the platform provider; relayReason
	// says why it is unavailable when it has no token.
	relay               decision.Relay
	relayReason         string
	decisionUnavailable string
}

// New builds an engine with the given settings (normalized).
func New(cfg Config, s Settings) *Engine {
	if cfg.Logger == nil {
		cfg.Logger = slog.Default()
	}
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	if cfg.Inputs == nil {
		cfg.Inputs = func() Inputs { return Inputs{} }
	}
	e := &Engine{
		cfg:    cfg,
		logger: cfg.Logger.With("component", "engineer"),
		wake:   make(chan struct{}, 1),
		rules:  newRuleState(),
		q:      newQueue(),
		subs:   map[int]chan Call{},
	}
	if err := e.SetSettings(s); err != nil {
		e.logger.Warn("engineer decision model disabled", "error", err)
		s.Decision.Mode = decision.ModeOff
		_ = e.SetSettings(s)
	}
	return e
}

// Settings returns a copy of the current settings.
func (e *Engine) Settings() Settings {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.settings
}

// SetSettings validates and applies settings, rebuilding the model client.
func (e *Engine) SetSettings(s Settings) error {
	s = s.Normalize()
	e.mu.Lock()
	client, unavailable, err := buildDecider(s.Decision, e.relay, e.relayReason)
	if err != nil {
		e.mu.Unlock()
		return err
	}
	e.settings = s
	e.decider = client
	e.deciderErr = ""
	e.decisionUnavailable = unavailable
	e.mu.Unlock()
	e.signal()
	return nil
}

// SetRelay updates the platform relay. A relay without a token disables the
// platform provider; reason is shown to the driver. Custom endpoints are not
// affected.
func (e *Engine) SetRelay(relay decision.Relay, reason string) {
	e.mu.Lock()
	e.relay, e.relayReason = relay, reason
	if e.settings.Decision.Provider == decision.ProviderPlatform {
		client, unavailable, _ := buildDecider(e.settings.Decision, relay, reason)
		e.decider, e.deciderErr, e.decisionUnavailable = client, "", unavailable
	}
	e.mu.Unlock()
	e.signal()
}

// buildDecider returns the model client for cfg. Only an invalid custom
// endpoint is an error; an unavailable platform relay is a status.
func buildDecider(cfg decision.Config, relay decision.Relay, reason string) (*decision.Client, string, error) {
	if cfg.Mode == decision.ModeOff {
		return nil, "", nil
	}
	if cfg.Provider == decision.ProviderPlatform {
		if relay.Token == "" {
			if reason == "" {
				reason = "platform relay unavailable"
			}
			return nil, reason, nil
		}
		c, err := decision.NewPlatformClient(cfg, relay)
		if err != nil {
			return nil, err.Error(), nil
		}
		return c, "", nil
	}
	c, err := decision.NewClient(cfg)
	if errors.Is(err, decision.ErrDisabled) {
		return nil, "", nil
	}
	return c, "", err
}

// ObserveState is a telemetry.PitwallStateObserver. It copies what the rules
// need and returns immediately; it never blocks the processor goroutine.
func (e *Engine) ObserveState(_ uint64, at time.Time, st *dto.PitwallState) {
	snap := extractSnapshot(at, st)
	if snap == nil {
		return
	}
	e.inboxMu.Lock()
	e.inboxSnap = snap
	e.inboxMu.Unlock()
	e.signal()
}

// ObserveEvent is a telemetry.EventObserver. It never blocks.
func (e *Engine) ObserveEvent(player uint8, ev *packets.PacketEventData) {
	if ev == nil {
		return
	}
	switch ev.EventStringCode {
	case packets.EventButtonStatus, packets.EventSafetyCarStatus, packets.EventRedFlag,
		packets.EventDRSEnabled, packets.EventRetirement, packets.EventFlashback:
	default:
		return
	}
	e.inboxMu.Lock()
	if len(e.inboxEvents) < maxInboxEvents {
		e.inboxEvents = append(e.inboxEvents, inboxEvent{player, ev})
	}
	e.inboxMu.Unlock()
	e.signal()
}

func (e *Engine) signal() {
	select {
	case e.wake <- struct{}{}:
	default:
	}
}

// Run processes snapshots, events and the release queue until ctx ends.
func (e *Engine) Run(ctx context.Context) {
	t := time.NewTicker(tickInterval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			e.closeSubscribers()
			return
		case <-t.C:
		case <-e.wake:
		}
		e.Step()
	}
}

// Step runs one processing cycle. Run calls it; tests may call it directly.
func (e *Engine) Step() {
	e.inboxMu.Lock()
	snap, events := e.inboxSnap, e.inboxEvents
	e.inboxSnap, e.inboxEvents = nil, nil
	e.inboxMu.Unlock()

	var strat *dto.StrategyOverlayData
	if snap != nil && e.cfg.Strategy != nil && snap.race() {
		strat = e.cfg.Strategy()
	}
	inputs := e.cfg.Inputs()
	now := e.cfg.Now()

	e.mu.Lock()
	defer e.mu.Unlock()
	if snap != nil {
		e.last = snap
		calls := e.rules.evaluate(snap, e.settings, strat)
		if e.settings.Enabled {
			for _, c := range calls {
				e.pushLocked(c, now)
			}
		}
	}
	for _, ev := range events {
		e.handleEventLocked(ev, now)
	}
	e.releaseLocked(now, inputs)
}

func (e *Engine) pushLocked(c Call, now time.Time) *queued {
	item, reason := e.q.push(c, now, e.settings)
	if item == nil {
		if reason != "verbosity" && reason != "muted" && reason != "cooldown" {
			e.logger.Debug("engineer call dropped", "key", c.Key, "reason", reason)
		}
		return nil
	}
	if e.settings.Decision.Mode == decision.ModeEnforce && e.decider != nil && !item.call.forced && item.call.Priority < PriorityUrgent {
		item.awaiting = true
		item.deadline = now.Add(time.Duration(e.settings.Decision.TimeoutMs)*time.Millisecond + 250*time.Millisecond)
	}
	return item
}

func (e *Engine) releaseLocked(now time.Time, in Inputs) {
	// Inputs freeze when telemetry stops (game paused or closed). A frozen
	// braking sample must not hold calls until they expire.
	if e.staleLocked(now) {
		in.Valid = false
	}
	for _, it := range e.q.items {
		if it.awaiting && now.After(it.deadline) {
			it.awaiting = false
			e.recordLocked(DecisionRecord{At: now, Mode: string(decision.ModeEnforce), Kind: "speak", CallKey: it.call.Key,
				Category: string(it.call.Category), RulePriority: int(it.call.Priority), RuleAction: "released",
				ModelAction: "timeout", Error: "deadline exceeded"})
		}
	}
	e.startEnforceDecisionLocked()
	for {
		c := e.q.next(now, in, e.settings, func(c Call, reason string) {
			if reason == "suppressed" {
				e.suppressed++
			}
		})
		if c == nil {
			return
		}
		if !c.forced && c.Source == "rule" {
			e.startShadowDecisionLocked(*c)
		}
		e.publishLocked(*c)
	}
}

func (e *Engine) publishLocked(c Call) {
	for id, ch := range e.subs {
		select {
		case ch <- c:
		default:
			e.logger.Debug("engineer subscriber slow; call dropped", "subscriber", id, "key", c.Key)
		}
	}
}

func (e *Engine) handleEventLocked(ev inboxEvent, now time.Time) {
	p := newPhrases(e.settings.Language)
	s := e.last
	lap := 0
	if s != nil {
		lap = s.Player.Lap
	}
	push := func(key string, cat Category, pri Priority, text string) {
		if e.settings.Enabled {
			e.pushLocked(Call{Key: key, Category: cat, Priority: pri, Text: text, Basis: BasisGame, Lap: lap, Source: "rule"}, now)
		}
	}
	switch ev.event.EventStringCode {
	case packets.EventButtonStatus:
		b, ok := ev.event.EventDetails.(*packets.ButtonsEvent)
		if !ok || b == nil {
			return
		}
		pressed := b.ButtonStatus &^ e.lastButtons
		e.lastButtons = b.ButtonStatus
		if m := packets.UDPActionMask(e.settings.BriefingButton); m != 0 && pressed&m != 0 {
			e.briefingLocked(now, "button")
		}
		if m := packets.UDPActionMask(e.settings.RepeatButton); m != 0 && pressed&m != 0 {
			e.repeatLocked(now)
		}
	case packets.EventFlashback:
		if n := e.q.flush(); n > 0 {
			e.logger.Debug("engineer queue flushed after flashback", "dropped", n)
		}
	case packets.EventSafetyCarStatus:
		sc, ok := ev.event.EventDetails.(*packets.SafetyCarEvent)
		if ok && sc != nil && sc.EventType == 1 && s != nil && s.race() {
			push(fmt.Sprintf("sc.in.%d", lap), CatRaceControl, PriorityHigh, p.safetyCarIn())
		}
	case packets.EventRedFlag:
		push(fmt.Sprintf("redflag.%d", lap), CatRaceControl, PriorityUrgent, p.redFlag())
	case packets.EventDRSEnabled:
		if s != nil && s.race() && s.GameFormat != 2026 && lap >= 2 {
			push(fmt.Sprintf("drs.enabled.%d", lap), CatRaceControl, PriorityInfo, p.drsEnabled())
		}
	case packets.EventRetirement:
		r, ok := ev.event.EventDetails.(*packets.RetirementEvent)
		if !ok || r == nil || s == nil || !s.race() || r.Reason == 2 {
			return
		}
		car, ok := s.car(int(r.VehicleIdx))
		if !ok || car.Index == s.Player.Index {
			return
		}
		switch car.Position {
		case s.Player.Position - 1:
			push(fmt.Sprintf("rival.rtmt.%d", car.Index), CatRivals, PriorityNormal, p.rivalRetired(true, car.Name))
		case s.Player.Position + 1:
			push(fmt.Sprintf("rival.rtmt.%d", car.Index), CatRivals, PriorityNormal, p.rivalRetired(false, car.Name))
		}
	}
}

func (e *Engine) staleLocked(now time.Time) bool {
	return e.last == nil || now.Sub(e.last.At) > staleAfter
}

func (e *Engine) briefingLocked(now time.Time, source string) Call {
	p := newPhrases(e.settings.Language)
	text := p.noData()
	if e.last != nil {
		text = briefingText(e.last, p)
		if e.staleLocked(now) {
			text = p.stale()
		}
	}
	c := Call{Key: fmt.Sprintf("brief.req.%d", now.UnixNano()), Category: CatBriefing, Priority: PriorityHigh,
		Text: text, Basis: BasisMeasured, Source: "briefing", forced: true}
	if e.last != nil {
		c.Lap = e.last.Player.Lap
	}
	if item := e.pushLocked(c, now); item != nil {
		return item.call
	}
	return c
}

func (e *Engine) repeatLocked(now time.Time) (Call, bool) {
	h := e.q.history
	if len(h) == 0 {
		return Call{}, false
	}
	last := h[len(h)-1]
	c := Call{Key: fmt.Sprintf("repeat.%d", now.UnixNano()), Category: last.Category, Priority: PriorityHigh,
		Text: last.Text, Basis: last.Basis, Lap: last.Lap, Source: "repeat", forced: true}
	item := e.pushLocked(c, now)
	if item == nil {
		return Call{}, false
	}
	return item.call, true
}

// Briefing queues an on-demand status summary.
func (e *Engine) Briefing(source string) Call {
	e.mu.Lock()
	c := e.briefingLocked(e.cfg.Now(), source)
	e.mu.Unlock()
	e.signal()
	return c
}

// Repeat queues the last released call again.
func (e *Engine) Repeat() (Call, bool) {
	e.mu.Lock()
	c, ok := e.repeatLocked(e.cfg.Now())
	e.mu.Unlock()
	e.signal()
	return c, ok
}

// Test queues a radio check so the driver can hear the configured voice.
func (e *Engine) Test() Call {
	e.mu.Lock()
	now := e.cfg.Now()
	c := Call{Key: fmt.Sprintf("test.%d", now.UnixNano()), Category: CatSystem, Priority: PriorityHigh,
		Text: newPhrases(e.settings.Language).testCall(), Source: "test", forced: true}
	if item := e.pushLocked(c, now); item != nil {
		c = item.call
	}
	e.mu.Unlock()
	e.signal()
	return c
}

// Subscribe returns a channel of released calls and a cancel func.
func (e *Engine) Subscribe() (<-chan Call, func()) {
	ch := make(chan Call, subscriberBuf)
	e.mu.Lock()
	id := e.nextSub
	e.nextSub++
	e.subs[id] = ch
	e.mu.Unlock()
	return ch, func() {
		e.mu.Lock()
		if c, ok := e.subs[id]; ok {
			delete(e.subs, id)
			close(c)
		}
		e.mu.Unlock()
	}
}

func (e *Engine) closeSubscribers() {
	e.mu.Lock()
	for id, ch := range e.subs {
		delete(e.subs, id)
		close(ch)
	}
	e.mu.Unlock()
}

// Recent returns released calls, oldest first.
func (e *Engine) Recent() []Call {
	e.mu.Lock()
	defer e.mu.Unlock()
	return append([]Call(nil), e.q.history...)
}

// Active returns the calls released in the last few seconds, newest first,
// for on-screen display.
func (e *Engine) Active() []Call {
	e.mu.Lock()
	defer e.mu.Unlock()
	now := e.cfg.Now()
	out := []Call{}
	for i := len(e.q.history) - 1; i >= 0 && len(out) < maxActive; i-- {
		c := e.q.history[i]
		if now.Sub(c.ReleasedAt) > activeWindow {
			break
		}
		out = append(out, c)
	}
	return out
}

// Status is a diagnostic summary for the settings UI.
type Status struct {
	Enabled          bool       `json:"enabled"`
	LastStateAt      *time.Time `json:"lastStateAt,omitempty"`
	Stale            bool       `json:"stale"`
	SessionType      string     `json:"sessionType,omitempty"`
	Queued           int        `json:"queued"`
	Released         uint64     `json:"released"`
	Dropped          uint64     `json:"dropped"`
	Suppressed       uint64     `json:"suppressed"`
	Subscribers      int        `json:"subscribers"`
	DecisionMode     string     `json:"decisionMode"`
	DecisionProvider string     `json:"decisionProvider"`
	DecisionReady    bool       `json:"decisionReady"`
	DecisionLastErr  string     `json:"decisionLastError,omitempty"`
	DecisionCount    uint64     `json:"decisionCount"`
	DecisionErrors   uint64     `json:"decisionErrors"`
	ShadowSkipped    uint64     `json:"shadowSkipped"`
	DecisionDisagree int        `json:"decisionDisagree"`

	// DecisionUnavailable explains why the platform relay is not ready.
	DecisionUnavailable string `json:"decisionUnavailable,omitempty"`
}

// Status returns runtime counters.
func (e *Engine) Status() Status {
	e.mu.Lock()
	defer e.mu.Unlock()
	now := e.cfg.Now()
	st := Status{
		Enabled: e.settings.Enabled, Stale: e.staleLocked(now), Queued: len(e.q.items),
		Released: e.q.released, Dropped: e.q.dropped, Suppressed: e.suppressed, Subscribers: len(e.subs),
		DecisionMode: string(e.settings.Decision.Mode), DecisionProvider: string(e.settings.Decision.Provider),
		DecisionReady: e.decider != nil, DecisionUnavailable: e.decisionUnavailable,
		DecisionLastErr: e.deciderErr, DecisionCount: e.decisionCount, DecisionErrors: e.decisionErrors,
		ShadowSkipped: e.shadowSkipped,
	}
	if e.last != nil {
		at := e.last.At
		st.LastStateAt, st.SessionType = &at, e.last.SessionType
	}
	for _, d := range e.decisions {
		if d.Kind == "speak" && d.ModelAction == "suppress" {
			st.DecisionDisagree++
		}
	}
	return st
}
