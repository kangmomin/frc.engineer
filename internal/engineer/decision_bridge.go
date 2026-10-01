package engineer

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"time"

	"frc.engineer/internal/engineer/decision"
)

const decisionLogMaxBytes = 5 << 20

var speakQuestions = map[string]decision.Question{
	"speak": {
		Type:         "noul",
		Instructions: "Should the race engineer say `message.text` to the driver right now, given `race` and `recentMessages`?",
		Criteria: map[string]string{
			"true":  "new, relevant information the driver can act on now",
			"false": "repeats a recent message, has low value, or is distracting at this moment",
		},
	},
	"urgency": {
		Type:         "score",
		Instructions: "How time-critical is `message.text` for the driver?",
		Criteria:     []string{"can wait a lap", "soon", "immediately"},
	},
}

var priorityNames = map[Priority]string{PriorityInfo: "info", PriorityNormal: "normal", PriorityHigh: "high", PriorityUrgent: "urgent"}

// speakState is the model input. Numbers are already computed in code; the
// model only judges relevance. No driver names are sent.
func speakState(c Call, s *snapshot, history []Call, now time.Time) map[string]any {
	state := map[string]any{
		"message": map[string]any{
			"text": c.Text, "category": string(c.Category), "priority": priorityNames[c.Priority], "basis": c.Basis,
		},
	}
	if s != nil {
		race := map[string]any{
			"session": s.SessionType, "lap": s.Player.Lap, "totalLaps": s.TotalLaps, "position": s.Player.Position,
			"safetyCar": s.SafetyCar, "inPitLane": s.Player.PitStatus != 0, "weather": s.Weather,
		}
		if g := s.gapAheadMs(); g > 0 {
			race["gapAheadSeconds"] = float64(g) / 1000
		}
		if g := s.gapBehindMs(); g > 0 {
			race["gapBehindSeconds"] = float64(g) / 1000
		}
		state["race"] = race
	}
	recent := []map[string]any{}
	for i := len(history) - 1; i >= 0 && len(recent) < 3; i-- {
		h := history[i]
		recent = append(recent, map[string]any{"text": h.Text, "secondsAgo": int(now.Sub(h.ReleasedAt).Seconds())})
	}
	state["recentMessages"] = recent
	return state
}

func (e *Engine) recordLocked(r DecisionRecord) {
	e.decisionCount++
	if r.Error != "" {
		e.decisionErrors++
	}
	e.decisions = append(e.decisions, r)
	if len(e.decisions) > decisionRingCap {
		e.decisions = e.decisions[len(e.decisions)-decisionRingCap:]
	}
	if e.settings.Decision.LogDecisions && e.cfg.DecisionLogPath != "" {
		appendDecisionLog(e.cfg.DecisionLogPath, r)
	}
}

func appendDecisionLog(path string, r DecisionRecord) {
	if info, err := os.Stat(path); err == nil && info.Size() > decisionLogMaxBytes {
		_ = os.Rename(path, path+".1")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	defer f.Close()
	b, err := json.Marshal(r)
	if err == nil {
		_, _ = f.Write(append(b, '\n'))
	}
}

// Decisions returns the recent model decisions, oldest first.
func (e *Engine) Decisions() []DecisionRecord {
	e.mu.Lock()
	defer e.mu.Unlock()
	return append([]DecisionRecord(nil), e.decisions...)
}

func speakAnswer(resp *decision.Response) (prob float64, urgency string, ok bool) {
	a, found := resp.Answers["speak"]
	if !found || a.Noul == nil {
		return 0, "", false
	}
	urgency, _ = resp.Answers["urgency"].TopLabel()
	return *a.Noul, urgency, true
}

// startEnforceDecisionLocked asks the model about the highest-priority call
// that is waiting. One request is in flight at a time; queued calls that wait
// past their deadline are released (fail open).
func (e *Engine) startEnforceDecisionLocked() {
	if e.decisionBusy || e.decider == nil || e.settings.Decision.Mode != decision.ModeEnforce {
		return
	}
	e.q.sort()
	var item *queued
	for _, it := range e.q.items {
		if it.awaiting {
			item = it
			break
		}
	}
	if item == nil {
		return
	}
	e.decisionBusy = true
	client, threshold := e.decider, e.settings.Decision.SpeakThreshold
	c := item.call
	state := speakState(c, e.last, e.q.history, e.cfg.Now())
	go func() {
		start := time.Now()
		resp, err := client.Ask(context.Background(), state, speakQuestions)
		e.mu.Lock()
		defer e.signal()
		defer e.mu.Unlock()
		e.decisionBusy = false
		rec := DecisionRecord{At: e.cfg.Now(), Mode: string(decision.ModeEnforce), Kind: "speak", CallKey: c.Key,
			Category: string(c.Category), RulePriority: int(c.Priority), Input: c.Text, RuleAction: "released",
			LatencyMs: time.Since(start).Milliseconds()}
		it := e.q.find(c.ID)
		if it != nil {
			it.awaiting = false
		}
		if err == nil {
			rec.Model = resp.Model
			if prob, urgency, ok := speakAnswer(resp); ok {
				rec.SpeakProb, rec.Urgency = &prob, urgency
				rec.ModelAction = "speak"
				if prob < threshold {
					rec.ModelAction = "suppress"
					rec.Applied = it != nil
					if it != nil {
						it.suppress = true
					}
				}
				e.recordLocked(rec)
				return
			}
			err = errMissingNoul
		}
		rec.Error, rec.ModelAction = err.Error(), "error"
		e.deciderErr = err.Error()
		e.recordLocked(rec)
	}()
}

// startShadowDecisionLocked asks the model about a call that was already
// released. The answer is only recorded.
func (e *Engine) startShadowDecisionLocked(c Call) {
	if e.decider == nil || e.settings.Decision.Mode != decision.ModeShadow {
		return
	}
	if e.decisionBusy {
		e.shadowSkipped++
		return
	}
	e.decisionBusy = true
	client := e.decider
	state := speakState(c, e.last, e.q.history[:max(len(e.q.history)-1, 0)], c.ReleasedAt)
	go func() {
		start := time.Now()
		resp, err := client.Ask(context.Background(), state, speakQuestions)
		e.mu.Lock()
		defer e.mu.Unlock()
		e.decisionBusy = false
		rec := DecisionRecord{At: e.cfg.Now(), Mode: string(decision.ModeShadow), Kind: "speak", CallKey: c.Key,
			Category: string(c.Category), RulePriority: int(c.Priority), Input: c.Text, RuleAction: "released",
			LatencyMs: time.Since(start).Milliseconds()}
		if err == nil {
			rec.Model = resp.Model
			if prob, urgency, ok := speakAnswer(resp); ok {
				rec.SpeakProb, rec.Urgency = &prob, urgency
				rec.ModelAction = "speak"
				if prob < e.settings.Decision.SpeakThreshold {
					rec.ModelAction = "suppress"
				}
				e.recordLocked(rec)
				return
			}
			err = errMissingNoul
		}
		rec.Error, rec.ModelAction = err.Error(), "error"
		e.deciderErr = err.Error()
		e.recordLocked(rec)
	}()
}

type engineError string

func (e engineError) Error() string { return string(e) }

const errMissingNoul = engineError("decision model returned no speak probability")
