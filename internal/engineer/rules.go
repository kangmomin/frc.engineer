package engineer

import (
	"fmt"
	"sort"
	"strings"

	"frc.engineer/internal/dto"
)

// Thresholds. Gaps are milliseconds, fuel is the game's MFD lap margin.
const (
	gapCloseMs       = 1000
	gapRearmMs       = 1500
	fuelShortLaps    = -0.3
	fuelCriticalLaps = -1.0
	fuelRearmLaps    = 0.1
	damageMinPct     = 20
	damageJumpPct    = 10
	rainSoonMinutes  = 15
	rainSoonPct      = 50
)

// ruleState remembers what has been said for one session so calls fire on
// transitions (edges), never on every snapshot.
type ruleState struct {
	sessionUID string
	prev       *snapshot
	once       map[string]bool
	armed      map[string]bool
	undercut   string
	overcut    string
}

func newRuleState() *ruleState {
	return &ruleState{once: map[string]bool{}, armed: map[string]bool{}}
}

func (r *ruleState) reset(uid string) {
	*r = ruleState{sessionUID: uid, once: map[string]bool{}, armed: map[string]bool{}}
}

// fireOnce returns true the first time key is seen this session.
func (r *ruleState) fireOnce(key string) bool {
	if r.once[key] {
		return false
	}
	r.once[key] = true
	return true
}

// edge fires when trigger becomes true while armed, and re-arms on rearm.
// Keys start armed.
func (r *ruleState) edge(key string, trigger, rearm bool) bool {
	armed, seen := r.armed[key]
	if !seen {
		armed = true
	}
	fired := false
	if trigger && armed {
		armed, fired = false, true
	} else if rearm {
		armed = true
	}
	r.armed[key] = armed
	return fired
}

type ruleCtx struct {
	cur  *snapshot
	prev *snapshot
	p    phrases
	out  []Call
}

func (c *ruleCtx) add(key string, cat Category, pri Priority, text, basis string) {
	c.out = append(c.out, Call{Key: key, Category: cat, Priority: pri, Text: text, Basis: basis, Lap: c.cur.Player.Lap, Source: "rule"})
}

// evaluate turns one snapshot into candidate calls and advances the memory.
func (r *ruleState) evaluate(cur *snapshot, s Settings, strat *dto.StrategyOverlayData) []Call {
	if cur == nil {
		return nil
	}
	if cur.SessionUID != r.sessionUID {
		r.reset(cur.SessionUID)
	}
	prev := r.prev
	r.prev = cur
	if prev == nil {
		return nil
	}
	// A flashback rewinds the lap counter. Say nothing for the rewound frame;
	// once-keys stay set so rewinding never repeats a call.
	if cur.Player.Lap < prev.Player.Lap {
		return nil
	}
	c := &ruleCtx{cur: cur, prev: prev, p: newPhrases(s.Language)}
	r.penalties(c)
	r.damage(c)
	r.weather(c)
	if cur.race() {
		r.safetyCar(c)
		r.pitWindow(c)
		r.fuel(c)
		r.tyres(c, s.TyreWearWarnPct)
		r.rivalsPitted(c)
		r.gaps(c)
		r.strategy(c, strat)
		r.lapLine(c)
	}
	return c.out
}

func (r *ruleState) pitWindow(c *ruleCtx) {
	cur := c.cur
	lap := cur.Player.Lap
	if cur.PitIdeal <= 0 || cur.PitLatest < cur.PitIdeal || lap < 2 || cur.Player.PitStatus != 0 {
		return
	}
	w := fmt.Sprintf("%d-%d", cur.PitIdeal, cur.PitLatest)
	switch {
	case lap == cur.PitIdeal-1:
		if r.fireOnce("pit.soon." + w) {
			c.add("pit.soon."+w, CatPit, PriorityNormal, c.p.pitWindowSoon(cur.PitIdeal), BasisGame)
		}
	case lap >= cur.PitIdeal && lap < cur.PitLatest:
		if r.fireOnce("pit.open." + w) {
			c.add("pit.open."+w, CatPit, PriorityHigh, c.p.pitWindowOpen(cur.PitIdeal, cur.PitLatest, cur.PitRejoin), BasisGame)
		}
	case lap == cur.PitLatest:
		if r.fireOnce("pit.last." + w) {
			c.add("pit.last."+w, CatPit, PriorityHigh, c.p.pitWindowLast(cur.PitRejoin), BasisGame)
		}
	}
}

func (r *ruleState) fuel(c *ruleCtx) {
	pl := c.cur.Player
	if !pl.FuelKnown || pl.Lap < 2 {
		return
	}
	m := pl.FuelMarginLaps
	if m <= fuelCriticalLaps && r.fireOnce("fuel.critical") {
		c.add("fuel.critical", CatFuel, PriorityUrgent, c.p.fuelCritical(m), BasisGame)
		r.armed["fuel.short"] = false
		r.armed["fuel.ok"] = true
		return
	}
	if r.edge("fuel.short", m <= fuelShortLaps, m >= fuelRearmLaps) {
		c.add("fuel.short", CatFuel, PriorityHigh, c.p.fuelShort(m), BasisGame)
		r.armed["fuel.ok"] = true
		return
	}
	if m >= fuelRearmLaps && r.armed["fuel.ok"] {
		r.armed["fuel.ok"] = false
		c.add("fuel.ok", CatFuel, PriorityInfo, c.p.fuelRecovered(m), BasisGame)
	}
}

func (r *ruleState) tyres(c *ruleCtx, warn int) {
	wear, corner := c.cur.maxWear()
	if wear < 0 {
		return
	}
	stint := c.cur.Player.PitStops
	crit := min(warn+15, 95)
	switch {
	case wear >= crit:
		key := fmt.Sprintf("tyre.crit.%d", stint)
		r.once[fmt.Sprintf("tyre.warn.%d", stint)] = true
		if r.fireOnce(key) {
			c.add(key, CatTyres, PriorityHigh, c.p.tyreWear(wear, corner, true), BasisMeasured)
		}
	case wear >= warn:
		key := fmt.Sprintf("tyre.warn.%d", stint)
		if r.fireOnce(key) {
			c.add(key, CatTyres, PriorityNormal, c.p.tyreWear(wear, corner, false), BasisMeasured)
		}
	}
}

func damageParts(d *dto.CarDamage) map[string]int {
	if d == nil {
		return nil
	}
	return map[string]int{
		"frontLeftWing": d.FrontLeftWing, "frontRightWing": d.FrontRightWing, "rearWing": d.RearWing,
		"floor": d.Floor, "diffuser": d.Diffuser, "sidepod": d.Sidepod, "engine": d.Engine, "gearbox": d.Gearbox,
	}
}

func (r *ruleState) damage(c *ruleCtx) {
	cur, prev := c.cur.Player.Damage, c.prev.Player.Damage
	if cur == nil || prev == nil {
		return
	}
	before := damageParts(prev)
	var hit []string
	for part, pct := range damageParts(cur) {
		if pct >= damageMinPct && pct-before[part] >= damageJumpPct {
			hit = append(hit, part)
		}
	}
	if len(hit) > 0 {
		sort.Strings(hit)
		now := damageParts(cur)
		sort.SliceStable(hit, func(i, j int) bool { return now[hit[i]] > now[hit[j]] })
		if len(hit) > 3 {
			hit = hit[:3]
		}
		texts := make([]string, 0, len(hit))
		for _, part := range hit {
			texts = append(texts, c.p.damage(part, now[part]))
		}
		key := fmt.Sprintf("damage.%s.%d", strings.Join(hit, "+"), now[hit[0]]/10)
		c.add(key, CatDamage, PriorityHigh, c.p.join(texts), BasisMeasured)
	}
	if r.edge("fault.drs", cur.DRSFault, !cur.DRSFault) {
		c.add("fault.drs", CatDamage, PriorityHigh, c.p.fault("drs"), BasisMeasured)
	}
	if r.edge("fault.ers", cur.ERSFault, !cur.ERSFault) {
		c.add("fault.ers", CatDamage, PriorityHigh, c.p.fault("ers"), BasisMeasured)
	}
}

func (r *ruleState) safetyCar(c *ruleCtx) {
	before, now := c.prev.SafetyCar, c.cur.SafetyCar
	if before == now || now == "" || now == "unknown" {
		return
	}
	lap := c.cur.Player.Lap
	inWindow := c.cur.PitIdeal > 0 && lap >= c.cur.PitIdeal && lap <= c.cur.PitLatest
	switch now {
	case "full":
		c.add(fmt.Sprintf("sc.full.%d", lap), CatRaceControl, PriorityUrgent, c.p.safetyCar(false, inWindow), BasisGame)
	case "virtual":
		c.add(fmt.Sprintf("sc.vsc.%d", lap), CatRaceControl, PriorityUrgent, c.p.safetyCar(true, inWindow), BasisGame)
	case "none":
		if before == "full" || before == "virtual" {
			c.add(fmt.Sprintf("sc.green.%d", lap), CatRaceControl, PriorityHigh, c.p.green(), BasisGame)
		}
	}
}

func (r *ruleState) rivalsPitted(c *ruleCtx) {
	prevPos := c.prev.Player.Position
	if prevPos <= 0 {
		return
	}
	for _, car := range c.cur.Cars {
		if car.Index == c.cur.Player.Index {
			continue
		}
		before, ok := c.prev.car(car.Index)
		if !ok || car.PitStops <= before.PitStops || !before.active() {
			continue
		}
		var ahead bool
		switch before.Position {
		case prevPos - 1:
			ahead = true
		case prevPos + 1:
			ahead = false
		default:
			continue
		}
		compound := ""
		if car.PitStatus == 0 && car.Compound != before.Compound {
			compound = car.Compound
		}
		key := fmt.Sprintf("rival.pit.%d.%d", car.Index, car.PitStops)
		c.add(key, CatRivals, PriorityNormal, c.p.rivalPitted(ahead, car.Name, compound), BasisGame)
	}
}

func (r *ruleState) gaps(c *ruleCtx) {
	cur := c.cur
	if cur.safetyCarOut() || cur.Player.PitStatus != 0 || cur.Player.Lap < 2 {
		return
	}
	if behind, ok := cur.carAt(cur.Player.Position + 1); ok {
		gap := cur.gapBehindMs()
		key := fmt.Sprintf("gap.behind.%d", behind.Index)
		if r.edge(key, gap > 0 && gap <= gapCloseMs, gap > gapRearmMs) {
			c.add(key, CatRivals, PriorityNormal, c.p.gapBehindClose(behind.Name, gap), BasisMeasured)
		}
	}
	if ahead, ok := cur.carAt(cur.Player.Position - 1); ok {
		gap := cur.gapAheadMs()
		key := fmt.Sprintf("gap.ahead.%d", ahead.Index)
		if r.edge(key, gap > 0 && gap <= gapCloseMs, gap > gapRearmMs) {
			c.add(key, CatRivals, PriorityInfo, c.p.gapAheadClose(ahead.Name, gap), BasisMeasured)
		}
	}
}

func (r *ruleState) penalties(c *ruleCtx) {
	cur, prev := c.cur.Player, c.prev.Player
	if cur.Penalties > prev.Penalties {
		c.add(fmt.Sprintf("pen.%d", cur.Penalties), CatRaceControl, PriorityHigh, c.p.penalty(cur.Penalties-prev.Penalties, cur.Penalties), BasisGame)
	}
	if cur.Warnings > prev.Warnings {
		c.add(fmt.Sprintf("warn.%d", cur.Warnings), CatRaceControl, PriorityNormal, c.p.warning(cur.Warnings, cur.CornerCutWarning > prev.CornerCutWarning), BasisGame)
	}
	if cur.UnservedDT > prev.UnservedDT {
		c.add(fmt.Sprintf("unserved.dt.%d", cur.UnservedDT), CatRaceControl, PriorityUrgent, c.p.unserved(false), BasisGame)
	}
	if cur.UnservedSG > prev.UnservedSG {
		c.add(fmt.Sprintf("unserved.sg.%d", cur.UnservedSG), CatRaceControl, PriorityUrgent, c.p.unserved(true), BasisGame)
	}
}

func isWet(w string) bool { return w == "light_rain" || w == "heavy_rain" || w == "storm" }

func knownWeather(w string) bool { return w != "" && w != "unknown" }

func (r *ruleState) weather(c *ruleCtx) {
	before, now := c.prev.Weather, c.cur.Weather
	if knownWeather(before) && knownWeather(now) && before != now {
		pri := PriorityNormal
		if isWet(before) != isWet(now) {
			pri = PriorityHigh
		}
		c.add(fmt.Sprintf("weather.%s.%d", now, c.cur.Player.Lap), CatWeather, pri, c.p.weatherNow(now), BasisGame)
	}
	if isWet(now) {
		r.armed["rain.soon"] = true
		return
	}
	minutes, pct := nextRain(c.cur.Forecast)
	if r.edge("rain.soon", minutes > 0, minutes == 0) {
		c.add(fmt.Sprintf("rain.soon.%d", minutes), CatWeather, PriorityNormal, c.p.rainSoon(minutes, pct), BasisGame)
	}
}

// nextRain returns the earliest future forecast within rainSoonMinutes whose
// rain probability is at least rainSoonPct, or 0.
func nextRain(forecast []dto.WeatherForecastDTO) (int, int) {
	best, pct := 0, 0
	for _, f := range forecast {
		if f.TimeOffset <= 0 || f.TimeOffset > rainSoonMinutes {
			continue
		}
		if f.RainPercentage >= rainSoonPct || isWet(f.Weather) {
			if best == 0 || f.TimeOffset < best {
				best, pct = f.TimeOffset, f.RainPercentage
			}
		}
	}
	return best, pct
}

func (r *ruleState) strategy(c *ruleCtx, strat *dto.StrategyOverlayData) {
	if strat == nil || strat.Mode == "qualifying" {
		return
	}
	if strat.UndercutVerdict == "VIABLE" && r.undercut != "VIABLE" && strat.CarAhead != nil {
		c.add(fmt.Sprintf("strategy.undercut.%d", c.cur.Player.Lap), CatPit, PriorityNormal, c.p.undercut(true), BasisHeuristic)
	}
	if strat.OvercutVerdict == "VIABLE" && r.overcut != "VIABLE" {
		c.add(fmt.Sprintf("strategy.overcut.%d", c.cur.Player.Lap), CatPit, PriorityNormal, c.p.undercut(false), BasisHeuristic)
	}
	r.undercut, r.overcut = strat.UndercutVerdict, strat.OvercutVerdict
}

// lapLine handles calls tied to crossing the line: final lap and briefings.
func (r *ruleState) lapLine(c *ruleCtx) {
	lap := c.cur.Player.Lap
	if lap <= c.prev.Player.Lap || lap < 2 {
		return
	}
	if c.cur.TotalLaps > 1 && lap == c.cur.TotalLaps && r.fireOnce("final") {
		c.add("final", CatRaceControl, PriorityNormal, c.p.finalLap(), BasisGame)
	}
	c.out = append(c.out, Call{Key: fmt.Sprintf("brief.lap.%d", lap), Category: CatBriefing, Priority: PriorityNormal,
		Text: briefingText(c.cur, c.p), Basis: BasisMeasured, Lap: lap, Source: "rule"})
}

// briefingText summarises position, gaps, fuel and tyres from real fields.
func briefingText(s *snapshot, p phrases) string {
	if s == nil {
		return p.noData()
	}
	pl := s.Player
	parts := []string{}
	if pl.Position > 0 {
		if s.race() && s.TotalLaps > 0 {
			parts = append(parts, p.pick(fmt.Sprintf("P%d, %d랩 중 %d랩째.", pl.Position, s.TotalLaps, pl.Lap),
				fmt.Sprintf("P%d, lap %d of %d.", pl.Position, pl.Lap, s.TotalLaps)))
		} else {
			parts = append(parts, fmt.Sprintf("P%d.", pl.Position))
		}
	}
	if g := s.gapAheadMs(); g > 0 {
		parts = append(parts, p.pick(fmt.Sprintf("앞차 %s초.", sec(g)), fmt.Sprintf("Ahead %s.", sec(g))))
	}
	if g := s.gapBehindMs(); g > 0 {
		parts = append(parts, p.pick(fmt.Sprintf("뒤차 %s초.", sec(g)), fmt.Sprintf("Behind %s.", sec(g))))
	}
	if pl.FuelKnown && s.race() {
		parts = append(parts, fuelText(pl.FuelMarginLaps, p))
	}
	if w, _ := s.maxWear(); w >= 0 {
		parts = append(parts, p.pick(fmt.Sprintf("타이어 최대 마모 %d퍼센트.", w), fmt.Sprintf("Tyres %d percent worn.", w)))
	}
	if len(parts) == 0 {
		return p.noData()
	}
	return p.join(parts)
}

func fuelText(m float32, p phrases) string {
	if m < 0 {
		return p.pick(fmt.Sprintf("연료 %s랩 부족.", laps(m)), fmt.Sprintf("Fuel %s laps short.", laps(m)))
	}
	return p.pick(fmt.Sprintf("연료 플러스 %s랩.", laps(m)), fmt.Sprintf("Fuel plus %s laps.", laps(m)))
}
