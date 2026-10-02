// Package engineer is the solo driver's virtual race engineer. It turns the
// sender's live pitwall snapshots and game events into short radio calls,
// queues them by priority, holds non-urgent calls while the driver is braking
// or turning, and publishes released calls to the overlay and voice clients.
//
// Every call is built from real telemetry fields. When a value is the game's
// own projection or a heuristic it says so; when data is missing the engineer
// says nothing (or, for a driver question, says it does not know).
package engineer

import (
	"strings"
	"time"

	"frc.engineer/internal/engineer/decision"
)

// Priority orders calls. Urgent calls bypass the braking gate and spacing.
type Priority int

const (
	PriorityInfo Priority = iota
	PriorityNormal
	PriorityHigh
	PriorityUrgent
)

// Category groups calls so the driver can mute whole topics.
type Category string

const (
	CatPit         Category = "pit"
	CatFuel        Category = "fuel"
	CatTyres       Category = "tyres"
	CatDamage      Category = "damage"
	CatRaceControl Category = "raceControl"
	CatRivals      Category = "rivals"
	CatWeather     Category = "weather"
	CatBriefing    Category = "briefing"
	CatAnswer      Category = "answer"
	CatSystem      Category = "system"
)

// Basis tells the driver how much to trust a number in the call.
const (
	BasisGame      = "game"      // game's own projection or field
	BasisMeasured  = "measured"  // telemetry measurement
	BasisHeuristic = "heuristic" // sender heuristic, not a measured probability
)

// Call is one radio message.
type Call struct {
	ID         uint64          `json:"id"`
	Key        string          `json:"key"`
	Category   Category        `json:"category"`
	Priority   Priority        `json:"priority"`
	Text       string          `json:"text"`
	Basis      string          `json:"basis,omitempty"`
	Lap        int             `json:"lap,omitempty"`
	Source     string          `json:"source"` // rule | briefing | answer | repeat | test
	CreatedAt  time.Time       `json:"createdAt"`
	ReleasedAt time.Time       `json:"releasedAt,omitempty"`
	ExpiresAt  time.Time       `json:"expiresAt"`
	Decision   *DecisionRecord `json:"decision,omitempty"`

	// forced calls (driver requests) ignore verbosity and category mutes.
	forced bool
}

// Verbosity filters calls by priority.
type Verbosity string

const (
	VerbosityMinimal  Verbosity = "minimal"  // high and urgent only
	VerbosityNormal   Verbosity = "normal"   // normal and above
	VerbosityDetailed Verbosity = "detailed" // everything, including lap briefings
)

// Categories toggles call topics. Driver-requested answers and briefings are
// never muted.
type Categories struct {
	Pit         bool `json:"pit"`
	Fuel        bool `json:"fuel"`
	Tyres       bool `json:"tyres"`
	Damage      bool `json:"damage"`
	RaceControl bool `json:"raceControl"`
	Rivals      bool `json:"rivals"`
	Weather     bool `json:"weather"`
	LapBriefing bool `json:"lapBriefing"`
}

func (c Categories) allows(cat Category) bool {
	switch cat {
	case CatPit:
		return c.Pit
	case CatFuel:
		return c.Fuel
	case CatTyres:
		return c.Tyres
	case CatDamage:
		return c.Damage
	case CatRaceControl:
		return c.RaceControl
	case CatRivals:
		return c.Rivals
	case CatWeather:
		return c.Weather
	case CatBriefing:
		return c.LapBriefing
	default:
		return true
	}
}

// Settings is the persisted engineer configuration.
type Settings struct {
	Enabled    bool       `json:"enabled"`
	Language   string     `json:"language"` // ko | en
	Verbosity  Verbosity  `json:"verbosity"`
	Categories Categories `json:"categories"`
	// BrakeGate holds non-urgent calls while the driver brakes or steers hard.
	BrakeGate bool `json:"brakeGate"`
	// BriefingButton / RepeatButton are game "UDP Action" numbers (1-12); 0 = off.
	BriefingButton int `json:"briefingButton"`
	RepeatButton   int `json:"repeatButton"`
	// TyreWearWarnPct is the highest-corner wear that triggers a tyre call.
	TyreWearWarnPct int             `json:"tyreWearWarnPct"`
	Decision        decision.Config `json:"decision"`
}

// DefaultSettings returns the out-of-the-box configuration.
func DefaultSettings() Settings {
	return Settings{
		Enabled:   true,
		Language:  "ko",
		Verbosity: VerbosityNormal,
		Categories: Categories{
			Pit: true, Fuel: true, Tyres: true, Damage: true,
			RaceControl: true, Rivals: true, Weather: true, LapBriefing: false,
		},
		BrakeGate:       true,
		TyreWearWarnPct: 60,
		// The platform relay is offered by default in shadow mode: it only
		// records what the model would do. It stays unavailable until the
		// paired account holds the RBAC grant and the server has a key.
		Decision: decision.Config{Mode: decision.ModeShadow, Provider: decision.ProviderPlatform,
			TimeoutMs: decision.PlatformTimeoutMs}.Normalize(),
	}
}

// UpgradeSaved adapts settings saved by an older sender. Before providers
// existed the model stayed off unless the driver entered an endpoint, so an
// install without one gets the platform default instead.
func UpgradeSaved(s Settings) Settings {
	if s.Decision.Provider == "" && strings.TrimSpace(s.Decision.URL) == "" {
		d := DefaultSettings().Decision
		d.LogDecisions = s.Decision.LogDecisions
		s.Decision = d
	}
	return s
}

// Normalize clamps fields to valid values.
func (s Settings) Normalize() Settings {
	s.Language = strings.ToLower(strings.TrimSpace(s.Language))
	if s.Language != "en" {
		s.Language = "ko"
	}
	switch s.Verbosity {
	case VerbosityMinimal, VerbosityNormal, VerbosityDetailed:
	default:
		s.Verbosity = VerbosityNormal
	}
	if s.BriefingButton < 0 || s.BriefingButton > 12 {
		s.BriefingButton = 0
	}
	if s.RepeatButton < 0 || s.RepeatButton > 12 || s.RepeatButton == s.BriefingButton {
		s.RepeatButton = 0
	}
	if s.TyreWearWarnPct == 0 {
		s.TyreWearWarnPct = 60
	}
	s.TyreWearWarnPct = min(max(s.TyreWearWarnPct, 30), 95)
	s.Decision = s.Decision.Normalize()
	return s
}

func (s Settings) minPriority() Priority {
	switch s.Verbosity {
	case VerbosityMinimal:
		return PriorityHigh
	case VerbosityDetailed:
		return PriorityInfo
	default:
		return PriorityNormal
	}
}

// Inputs is the driver's live pedal/steering state, used by the brake gate.
type Inputs struct {
	Valid     bool
	SpeedKPH  int
	Brake     float32
	Steer     float32
	PitStatus int
}

// busy reports whether the driver is in a braking zone or a corner.
func (in Inputs) busy() bool {
	if !in.Valid || in.PitStatus != 0 {
		return false
	}
	if in.Brake > 0.15 {
		return true
	}
	steer := in.Steer
	if steer < 0 {
		steer = -steer
	}
	return in.SpeedKPH > 60 && steer > 0.25
}

// DecisionRecord is one model decision, kept for shadow comparison.
type DecisionRecord struct {
	At           time.Time `json:"at"`
	Mode         string    `json:"mode"`
	Kind         string    `json:"kind"` // speak | intent
	CallKey      string    `json:"callKey,omitempty"`
	Category     string    `json:"category,omitempty"`
	RulePriority int       `json:"rulePriority,omitempty"`
	Input        string    `json:"input,omitempty"`
	SpeakProb    *float64  `json:"speakProb,omitempty"`
	Urgency      string    `json:"urgency,omitempty"`
	Intent       string    `json:"intent,omitempty"`
	IntentProb   float64   `json:"intentProb,omitempty"`
	RuleAction   string    `json:"ruleAction"`  // released | answered:<intent>
	ModelAction  string    `json:"modelAction"` // speak | suppress | intent
	Applied      bool      `json:"applied"`     // model changed the outcome
	LatencyMs    int64     `json:"latencyMs"`
	Error        string    `json:"error,omitempty"`
	Model        string    `json:"model,omitempty"`
}
