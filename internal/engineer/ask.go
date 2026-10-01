package engineer

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"frc.engineer/internal/engineer/decision"
)

// Intent ids for driver questions. "unknown" means no confident match.
const (
	IntentGapAhead  = "gap_ahead"
	IntentGapBehind = "gap_behind"
	IntentPosition  = "position"
	IntentFuel      = "fuel"
	IntentTyres     = "tyres"
	IntentPit       = "pit"
	IntentWeather   = "weather"
	IntentDamage    = "damage"
	IntentPenalties = "penalties"
	IntentBriefing  = "briefing"
	IntentUnknown   = "unknown"
)

type intentDef struct {
	id          string
	description string
	keywords    []string
}

// Order matters for keyword matching: more specific intents first.
var intents = []intentDef{
	{IntentGapAhead, "the gap to the car in front", []string{"앞차", "앞 차", "앞에", "ahead", "in front", "car in front"}},
	{IntentGapBehind, "the gap to the car behind", []string{"뒤차", "뒤 차", "뒤에", "behind"}},
	{IntentPit, "pit stop timing or the pit window", []string{"피트", "박스", "pit", "box"}},
	{IntentFuel, "fuel level or fuel saving", []string{"연료", "기름", "fuel"}},
	{IntentTyres, "tyre wear, compound or tyre age", []string{"타이어", "마모", "tyre", "tire", "wear"}},
	{IntentDamage, "damage to the car", []string{"손상", "데미지", "날개", "damage", "wing"}},
	{IntentPenalties, "penalties or warnings", []string{"페널티", "패널티", "경고", "penalty", "penalties", "warning"}},
	{IntentWeather, "weather or rain forecast", []string{"날씨", "비 와", "비와", "비 올", "비올", "강수", "weather", "rain"}},
	{IntentPosition, "current race position or lap", []string{"순위", "몇 등", "몇등", "포지션", "position", "place", "what lap"}},
	{IntentBriefing, "a general status summary", []string{"상황", "브리핑", "요약", "어때", "status", "summary", "update", "briefing"}},
}

func classifyKeywords(text string) string {
	t := strings.ToLower(strings.TrimSpace(text))
	for _, in := range intents {
		for _, k := range in.keywords {
			if strings.Contains(t, k) {
				return in.id
			}
		}
	}
	return IntentUnknown
}

func intentQuestion() map[string]decision.Question {
	criteria := map[string]string{IntentUnknown: "anything else, or not a question about the car or race"}
	for _, in := range intents {
		criteria[in.id] = in.description
	}
	return map[string]decision.Question{"intent": {
		Type:         "choice",
		Instructions: "Which topic is the racing driver asking their engineer about in `question`?",
		Criteria:     criteria,
	}}
}

// Answer is the result of a driver question.
type Answer struct {
	Question     string  `json:"question"`
	Intent       string  `json:"intent"`
	Source       string  `json:"source"` // keywords | model
	KeywordMatch string  `json:"keywordIntent"`
	ModelIntent  string  `json:"modelIntent,omitempty"`
	ModelProb    float64 `json:"modelProb,omitempty"`
	Text         string  `json:"text"`
	Call         *Call   `json:"call,omitempty"`
}

const (
	maxQuestionRunes      = 200
	modelIntentConfidence = 0.5
)

// Ask answers a driver question from the latest telemetry and queues the
// answer as a radio call. The model (when configured) only picks the intent;
// the answer is always built from real fields, or says the data is missing.
func (e *Engine) Ask(ctx context.Context, question string) Answer {
	question = strings.TrimSpace(question)
	if r := []rune(question); len(r) > maxQuestionRunes {
		question = string(r[:maxQuestionRunes])
	}
	ans := Answer{Question: question, KeywordMatch: classifyKeywords(question), Source: "keywords"}
	ans.Intent = ans.KeywordMatch

	e.mu.Lock()
	client, mode := e.decider, e.settings.Decision.Mode
	e.mu.Unlock()
	if client != nil && mode != decision.ModeOff && question != "" {
		start := time.Now()
		resp, err := client.Ask(ctx, map[string]any{"question": question}, intentQuestion())
		rec := DecisionRecord{At: e.cfg.Now(), Mode: string(mode), Kind: "intent", Input: question,
			RuleAction: "answered:" + ans.KeywordMatch, ModelAction: "intent", LatencyMs: time.Since(start).Milliseconds()}
		if err != nil {
			rec.Error, rec.ModelAction = err.Error(), "error"
		} else {
			label, prob := resp.Answers["intent"].TopLabel()
			rec.Intent, rec.IntentProb, rec.Model = label, prob, resp.Model
			ans.ModelIntent, ans.ModelProb = label, prob
			if mode == decision.ModeEnforce && prob >= modelIntentConfidence && validIntent(label) {
				rec.Applied = label != ans.KeywordMatch
				ans.Intent, ans.Source = label, "model"
			}
		}
		e.mu.Lock()
		if rec.Error != "" {
			e.deciderErr = rec.Error
		}
		e.recordLocked(rec)
		e.mu.Unlock()
	}

	e.mu.Lock()
	now := e.cfg.Now()
	p := newPhrases(e.settings.Language)
	switch {
	case ans.Intent == IntentUnknown:
		ans.Text = p.dontKnow()
	case e.last == nil:
		ans.Text = p.noData()
	case e.staleLocked(now):
		ans.Text = p.stale()
	default:
		ans.Text = answerText(ans.Intent, e.last, p)
	}
	c := Call{Key: fmt.Sprintf("answer.%d", now.UnixNano()), Category: CatAnswer, Priority: PriorityHigh,
		Text: ans.Text, Basis: BasisMeasured, Source: "answer", forced: true}
	if e.last != nil {
		c.Lap = e.last.Player.Lap
	}
	if item := e.pushLocked(c, now); item != nil {
		call := item.call
		ans.Call = &call
	}
	e.mu.Unlock()
	e.signal()
	return ans
}

func validIntent(id string) bool {
	if id == IntentUnknown {
		return true
	}
	for _, in := range intents {
		if in.id == id {
			return true
		}
	}
	return false
}

func answerText(intent string, s *snapshot, p phrases) string {
	pl := s.Player
	switch intent {
	case IntentGapAhead:
		if pl.Position == 1 {
			return p.pick("선두입니다. 앞차 없음.", "You are leading. Nobody ahead.")
		}
		car, ok := s.carAt(pl.Position - 1)
		g := s.gapAheadMs()
		if !ok || g <= 0 {
			return p.pick("앞차 갭 데이터가 없습니다.", "No gap data for the car ahead.")
		}
		return p.pick(fmt.Sprintf("앞차 %s, %s초.", car.Name, sec(g)), fmt.Sprintf("%s is %s ahead.", car.Name, sec(g)))
	case IntentGapBehind:
		car, ok := s.carAt(pl.Position + 1)
		g := s.gapBehindMs()
		if !ok || g <= 0 {
			return p.pick("뒤차 갭 데이터가 없습니다.", "No gap data for the car behind.")
		}
		return p.pick(fmt.Sprintf("뒤차 %s, %s초.", car.Name, sec(g)), fmt.Sprintf("%s is %s behind.", car.Name, sec(g)))
	case IntentPosition:
		if pl.Position <= 0 {
			return p.noData()
		}
		if s.TotalLaps > 0 && s.race() {
			return p.pick(fmt.Sprintf("P%d, %d랩 중 %d랩째.", pl.Position, s.TotalLaps, pl.Lap), fmt.Sprintf("P%d, lap %d of %d.", pl.Position, pl.Lap, s.TotalLaps))
		}
		return fmt.Sprintf("P%d.", pl.Position)
	case IntentFuel:
		if !pl.FuelKnown {
			return p.pick("연료 데이터가 없습니다.", "No fuel data.")
		}
		return fuelText(pl.FuelMarginLaps, p) + p.pick(" 게임 기준.", " Game figure.")
	case IntentTyres:
		w, corner := s.maxWear()
		if w < 0 {
			return p.pick("타이어 데이터가 없습니다.", "No tyre data.")
		}
		parts := []string{}
		if c := p.compound(pl.Compound); c != "" {
			parts = append(parts, p.pick(fmt.Sprintf("%s %d랩째.", c, pl.TyreAge), fmt.Sprintf("%s, %d laps old.", capitalize(c), pl.TyreAge)))
		}
		parts = append(parts, p.tyreWear(w, corner, false))
		return p.join(parts)
	case IntentPit:
		if s.PitIdeal <= 0 {
			if pl.Position > 0 && s.PitRejoin > 0 {
				return p.pick("게임 피트 윈도우 정보 없음.", "No game pit window.") + p.rejoin(s.PitRejoin)
			}
			return p.pick("게임 피트 윈도우 정보가 없습니다.", "No pit window from the game.")
		}
		return p.pick(fmt.Sprintf("게임 피트 윈도우 랩 %d부터 %d까지. 현재 랩 %d.", s.PitIdeal, s.PitLatest, pl.Lap),
			fmt.Sprintf("Game pit window laps %d to %d. Current lap %d.", s.PitIdeal, s.PitLatest, pl.Lap)) + p.rejoin(s.PitRejoin)
	case IntentWeather:
		if !knownWeather(s.Weather) {
			return p.pick("날씨 데이터가 없습니다.", "No weather data.")
		}
		text := p.pick(fmt.Sprintf("현재 %s.", p.weather(s.Weather)), fmt.Sprintf("Currently %s.", p.weather(s.Weather)))
		if m, pct := nextRain(s.Forecast); m > 0 {
			text += " " + p.rainSoon(m, pct)
		} else {
			text += p.pick(" 15분 안 강수 예보 없음.", " No rain forecast within 15 minutes.")
		}
		return text
	case IntentDamage:
		if pl.Damage == nil {
			return p.pick("손상 데이터가 없습니다.", "No damage data.")
		}
		parts := damageParts(pl.Damage)
		names := make([]string, 0, len(parts))
		for part, pct := range parts {
			if pct >= 10 {
				names = append(names, part)
			}
		}
		sort.Slice(names, func(i, j int) bool { return parts[names[i]] > parts[names[j]] })
		texts := []string{}
		for _, n := range names {
			texts = append(texts, p.damage(n, parts[n]))
		}
		if pl.Damage.DRSFault {
			texts = append(texts, p.fault("drs"))
		}
		if pl.Damage.ERSFault {
			texts = append(texts, p.fault("ers"))
		}
		if len(texts) == 0 {
			return p.pick("큰 손상 없습니다.", "No significant damage.")
		}
		return p.join(texts)
	case IntentPenalties:
		texts := []string{p.pick(fmt.Sprintf("페널티 누적 %d초, 경고 %d회.", pl.Penalties, pl.Warnings),
			fmt.Sprintf("%d seconds of penalties, %d warnings.", pl.Penalties, pl.Warnings))}
		if pl.UnservedDT > 0 {
			texts = append(texts, p.unserved(false))
		}
		if pl.UnservedSG > 0 {
			texts = append(texts, p.unserved(true))
		}
		return p.join(texts)
	case IntentBriefing:
		return briefingText(s, p)
	}
	return p.dontKnow()
}
