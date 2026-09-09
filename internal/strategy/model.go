package strategy

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"math"
	"sort"
	"strconv"
)

func clean(l Lap) bool {
	return len(l.Flags) == 0 && l.Flags != nil && l.SetupRevision > 0 && l.FuelKg != nil &&
		l.FuelEndKg != nil && l.Compound == l.EndCompound && ValidTyre(l.Tyre)
}

func contextFor(record Record, l Lap) (Context, bool) {
	e := record.Evidence
	c := e.Conditions
	if c.Rules == nil || c.TeamID == nil || len(e.Reasons) != 0 ||
		(c.Formula != 0 && c.Formula != 13) || l.SetupRevision == 0 {
		return Context{}, false
	}
	if c.Rules.EqualPerformance {
		c.TeamID = nil
	}
	// Compare within five-degree track-temperature bands.
	ctx := Context{TrackID: record.TrackID, Conditions: c, Weather: l.Weather, TrackTempBucket: int(math.Floor(float64(l.TrackTemp)/5)) * 5,
		TractionControl: l.TractionControl, ABS: l.ABS}
	b, _ := json.Marshal(ctx)
	h := sha256.Sum256(b)
	ctx.ID = hex.EncodeToString(h[:16])
	return ctx, true
}

func uniqueRecords(records []Record) []Record {
	byKey := map[string]Record{}
	for _, r := range records {
		if ValidateEvidence(&r.Evidence) != nil || r.AccountID == "" {
			continue
		}
		key := strconv.Itoa(r.TrackID) + "/" + r.AccountID + "/" + r.Evidence.SessionUID
		old, exists := byKey[key]
		if !exists || len(r.Evidence.Laps) > len(old.Evidence.Laps) ||
			(len(r.Evidence.Laps) == len(old.Evidence.Laps) && r.RaceID < old.RaceID) {
			byKey[key] = r
		}
	}
	keys := make([]string, 0, len(byKey))
	for key := range byKey {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	out := make([]Record, 0, len(keys))
	for _, key := range keys {
		out = append(out, byKey[key])
	}
	return out
}

type identities struct{ users, sessions map[string]bool }

func newIdentities() identities { return identities{map[string]bool{}, map[string]bool{}} }
func (i identities) add(r Record) {
	i.users[r.AccountID] = true
	i.sessions[r.Evidence.SessionUID] = true
}

func Contexts(records []Record) []Context {
	contexts := map[string]*Context{}
	ids := map[string]identities{}
	for _, r := range uniqueRecords(records) {
		for _, l := range r.Evidence.Laps {
			if !clean(l) {
				continue
			}
			c, ok := contextFor(r, l)
			if !ok {
				continue
			}
			if contexts[c.ID] == nil {
				contexts[c.ID] = &c
				ids[c.ID] = newIdentities()
			}
			contexts[c.ID].CleanLaps++
			ids[c.ID].add(r)
		}
	}
	out := make([]Context, 0, len(contexts))
	for key, c := range contexts {
		c.Users, c.Sessions = len(ids[key].users), len(ids[key].sessions)
		out = append(out, *c)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].CleanLaps != out[j].CleanLaps {
			return out[i].CleanLaps > out[j].CleanLaps
		}
		return out[i].ID < out[j].ID
	})
	return out
}

type raceData struct {
	record    Record
	laps      []Lap
	intercept float64
}

// Analyze uses a within-race fixed-effects regression. Every uploaded driver's
// race has its own intercept; a fast driver is not treated as a fast compound.
// Fuel and tyre age are fitted together. Singular designs deliberately produce
// no ranking rather than inventing a fuel/age correction.
func Analyze(records []Record, request Request) Result {
	out := Result{Status: "insufficient-data", Reasons: []string{}, Compounds: []CompoundModel{}, Plans: []Plan{},
		ERS: ERSProfile{Status: "insufficient-data", Segments: []EnergySector{}}, Validation: "in-sample-only"}
	if ValidateRequest(request) != nil {
		out.Status = "invalid-request"
		return out
	}
	records = uniqueRecords(records)
	for _, c := range Contexts(records) {
		if c.ID == request.ContextID {
			copy := c
			out.Context = &copy
			break
		}
	}
	if out.Context == nil {
		out.Status = "context-not-found"
		return out
	}
	var races []raceData
	for _, record := range records {
		rd := raceData{record: record}
		setup := 0
		mixedSetup := false
		for _, l := range record.Evidence.Laps {
			c, ok := contextFor(record, l)
			if !ok || c.ID != request.ContextID || !clean(l) {
				continue
			}
			if setup != 0 && setup != l.SetupRevision {
				mixedSetup = true
			}
			setup = l.SetupRevision
			rd.laps = append(rd.laps, l)
		}
		if len(rd.laps) >= 4 && !mixedSetup {
			races = append(races, rd)
		}
	}
	out.ERS = energyProfile(races)
	models := map[int]int{}
	for {
		ids := newIdentities()
		counts := map[int]*CompoundModel{}
		compoundIDs := map[int]identities{}
		for _, r := range races {
			ids.add(r.record)
			for _, l := range r.laps {
				m := counts[l.Compound]
				if m == nil {
					m = &CompoundModel{Compound: l.Compound, Tyre: l.Tyre, MinAge: l.TyreAge, MaxAge: l.TyreAge}
					counts[l.Compound] = m
					compoundIDs[l.Compound] = newIdentities()
				}
				if m.Tyre != l.Tyre {
					out.Reasons = append(out.Reasons, "compound-label-conflict")
					return out
				}
				m.MinAge = min(m.MinAge, l.TyreAge)
				m.MaxAge = max(m.MaxAge, l.TyreAge)
				m.Laps++
				compoundIDs[l.Compound].add(r.record)
			}
		}
		out.Compounds = []CompoundModel{}
		for id, m := range counts {
			m.Users, m.Sessions = len(compoundIDs[id].users), len(compoundIDs[id].sessions)
			if m.Users >= MinUsers && m.Sessions >= MinSessions && m.MaxAge-m.MinAge >= 3 {
				out.Compounds = append(out.Compounds, *m)
			}
		}
		sort.Slice(out.Compounds, func(i, j int) bool { return out.Compounds[i].Compound < out.Compounds[j].Compound })
		models = map[int]int{}
		for i, m := range out.Compounds {
			models[m.Compound] = i
		}
		retained := make([]raceData, 0, len(races))
		lapCount := 0
		for _, r := range races {
			selected := []Lap{}
			for _, l := range r.laps {
				if _, ok := models[l.Compound]; ok {
					selected = append(selected, l)
				}
			}
			if len(selected) >= 4 {
				r.laps = selected
				retained = append(retained, r)
				lapCount += len(selected)
			}
		}
		removedRace := len(retained) < len(races)
		races = retained
		if removedRace {
			// Dropping a sparse race can remove another compound's independent
			// support. Recompute until every counted race and lap reaches fit.
			continue
		}
		// Discovery counts include all compatible clean observations; analysis
		// counts describe only the final fitting sample, including its age range.
		out.Context.Users, out.Context.Sessions = len(ids.users), len(ids.sessions)
		out.Context.CleanLaps = lapCount
		break
	}
	if out.Context.Users < MinUsers || out.Context.Sessions < MinSessions || out.Context.CleanLaps < MinCleanLaps || len(out.Compounds) == 0 {
		out.Reasons = append(out.Reasons, "minimum-evidence")
		return out
	}
	// A compatible event has one actual compound per tyre colour. Conflicting
	// allocations cannot be compared; this also bounds the design to five tyres.
	byTyre := map[string]bool{}
	for _, m := range out.Compounds {
		if byTyre[m.Tyre] {
			out.Reasons = append(out.Reasons, "compound-label-conflict")
			return out
		}
		byTyre[m.Tyre] = true
	}
	beta, ok := fit(races, models)
	if !ok {
		out.Status = "unidentifiable"
		out.Reasons = append(out.Reasons, "fuel-age-not-identifiable")
		return out
	}
	n := len(models)
	// Broad model bounds reject unstable fits; these are not fixed
	// fuel or tyre coefficients. Negative warm-up trends are not called damage.
	if beta[0] < 0 || beta[0] > 500 {
		out.Status = "unidentifiable"
		out.Reasons = append(out.Reasons, "unstable-pace-model")
		return out
	}
	for i := range out.Compounds {
		if beta[n+i] < -100 || beta[n+i] > 5000 {
			out.Status = "unidentifiable"
			out.Reasons = append(out.Reasons, "nonlinear-tyre-profile")
			return out
		}
		if i > 0 {
			out.Compounds[i].OffsetMs = beta[i]
		}
		out.Compounds[i].AgeSlopeMs = beta[n+i]
	}
	var errors []float64
	for i := range races {
		r := &races[i]
		if len(r.laps) == 0 {
			continue
		}
		var intercept float64
		for _, l := range r.laps {
			intercept += float64(l.TimeMs) - dot(features(l, models), beta)
		}
		r.intercept = intercept / float64(len(r.laps))
		for _, l := range r.laps {
			errors = append(errors, math.Abs(float64(l.TimeMs)-r.intercept-dot(features(l, models), beta)))
		}
	}
	mae := median(errors)
	out.FuelSlopeMsPerKg = &beta[0]
	out.LapMedianAbsoluteErrorMs = &mae
	if mae > 3000 {
		out.Status = "unidentifiable"
		out.Reasons = append(out.Reasons, "unstable-pace-model")
		return out
	}
	out.Pit = pitModel(races, models, beta, request.ContextID)
	if request.MaxStops > 0 && out.Pit == nil {
		out.Reasons = append(out.Reasons, "pit-evidence-missing")
	}
	out.Plans = enumeratePlans(out.Compounds, out.Pit, out.Context.Conditions.TotalLaps, request)
	if len(out.Plans) == 0 {
		out.Status = "no-feasible-plan"
		out.Reasons = append(out.Reasons, "tyre-age-or-set-coverage")
		return out
	}
	out.Status = "ready"
	out.Reasons = append(out.Reasons, "not-backtested", "green-clean-running", "new-tyre-warmup-approximation")
	if len(out.Plans) > 1 && out.Plans[1].DeltaMs < mae {
		out.Reasons = append(out.Reasons, "small-model-difference")
	}
	return out
}

func features(l Lap, models map[int]int) []float64 {
	n := len(models)
	x := make([]float64, 2*n)
	if l.FuelKg != nil {
		x[0] = *l.FuelKg
	}
	i := models[l.Compound]
	if i > 0 {
		x[i] = 1
	}
	x[n+i] = float64(l.TyreAge)
	return x
}

func dot(a, b []float64) float64 {
	var v float64
	for i := range a {
		v += a[i] * b[i]
	}
	return v
}

func fit(races []raceData, models map[int]int) ([]float64, bool) {
	n := 2 * len(models)
	a := make([][]float64, n)
	b := make([]float64, n)
	for i := range a {
		a[i] = make([]float64, n)
	}
	userSessions := map[string]map[string]bool{}
	sessionUploads := map[string]int{}
	for _, r := range races {
		if len(r.laps) < 4 {
			continue
		}
		if userSessions[r.record.AccountID] == nil {
			userSessions[r.record.AccountID] = map[string]bool{}
		}
		userSessions[r.record.AccountID][r.record.Evidence.SessionUID] = true
		sessionUploads[r.record.Evidence.SessionUID]++
	}
	for _, r := range races {
		if len(r.laps) < 4 {
			continue
		}
		mean := make([]float64, n)
		var meanY float64
		for _, l := range r.laps {
			x := features(l, models)
			for i, v := range x {
				mean[i] += v
			}
			meanY += float64(l.TimeMs)
		}
		count := float64(len(r.laps))
		for i := range mean {
			mean[i] /= count
		}
		meanY /= count
		weight := 1 / (count * float64(len(userSessions[r.record.AccountID])) * float64(sessionUploads[r.record.Evidence.SessionUID]))
		for _, l := range r.laps {
			x := features(l, models)
			for i := range x {
				x[i] -= mean[i]
			}
			y := float64(l.TimeMs) - meanY
			for i := range x {
				b[i] += weight * x[i] * y
				for j := range x {
					a[i][j] += weight * x[i] * x[j]
				}
			}
		}
	}
	// Scale before pivoting so fuel in kg and times in ms do not manufacture a
	// rank decision. No regularization fills an unidentifiable coefficient.
	scale := make([]float64, n)
	for i := range scale {
		scale[i] = math.Sqrt(a[i][i])
		if scale[i] < 1e-9 {
			return nil, false
		}
	}
	for i := range a {
		b[i] /= scale[i]
		for j := range a[i] {
			a[i][j] /= scale[i] * scale[j]
		}
	}
	for col := 0; col < n; col++ {
		pivot := col
		for row := col + 1; row < n; row++ {
			if math.Abs(a[row][col]) > math.Abs(a[pivot][col]) {
				pivot = row
			}
		}
		if math.Abs(a[pivot][col]) < 1e-6 {
			return nil, false
		}
		a[col], a[pivot] = a[pivot], a[col]
		b[col], b[pivot] = b[pivot], b[col]
		d := a[col][col]
		for j := col; j < n; j++ {
			a[col][j] /= d
		}
		b[col] /= d
		for row := 0; row < n; row++ {
			if row == col {
				continue
			}
			d = a[row][col]
			for j := col; j < n; j++ {
				a[row][j] -= d * a[col][j]
			}
			b[row] -= d * b[col]
		}
	}
	for i := range b {
		b[i] /= scale[i]
		if !finite(b[i]) {
			return nil, false
		}
	}
	return b, true
}

func median(values []float64) float64 {
	if len(values) == 0 {
		return 0
	}
	copy := append([]float64(nil), values...)
	sort.Float64s(copy)
	i := len(copy) / 2
	if len(copy)%2 == 0 {
		return (copy[i-1] + copy[i]) / 2
	}
	return copy[i]
}

// Records are already unique by account/session. These weights bound both a
// user's total contribution and a shared session's total contribution by one,
// using the same record-level policy as fit's per-lap regression weights.
func recordWeights(records []Record) []float64 {
	userSessions, sessionUploads := map[string]int{}, map[string]int{}
	for _, r := range records {
		userSessions[r.AccountID]++
		sessionUploads[r.Evidence.SessionUID]++
	}
	weights := make([]float64, len(records))
	for i, r := range records {
		weights[i] = 1 / (float64(userSessions[r.AccountID]) * float64(sessionUploads[r.Evidence.SessionUID]))
	}
	return weights
}

func weightedMedian(values, weights []float64) float64 {
	if len(values) == 0 {
		return 0
	}
	type sample struct{ value, weight float64 }
	samples := make([]sample, len(values))
	var total float64
	for i, value := range values {
		samples[i] = sample{value, weights[i]}
		total += weights[i]
	}
	sort.Slice(samples, func(i, j int) bool { return samples[i].value < samples[j].value })
	var cumulative float64
	for i, s := range samples {
		cumulative += s.weight
		// Preserve the ordinary median's midpoint for equal half-weights;
		// the tolerance only absorbs floating-point summation roundoff.
		if math.Abs(cumulative-total/2) <= total*1e-12 && i+1 < len(samples) {
			return (s.value + samples[i+1].value) / 2
		}
		if cumulative > total/2 {
			return s.value
		}
	}
	return samples[len(samples)-1].value
}

func weightedMAD(values, weights []float64, center float64) float64 {
	d := make([]float64, 0, len(values))
	for _, v := range values {
		d = append(d, math.Abs(v-center))
	}
	return weightedMedian(d, weights)
}

func pitModel(races []raceData, models map[int]int, beta []float64, contextID string) *PitModel {
	records := []Record{}
	values := []float64{}
	ids := newIdentities()
	stops := 0
	for _, r := range races {
		if len(r.laps) < 4 {
			continue
		}
		byNumber := map[int]Lap{}
		for _, l := range r.record.Evidence.Laps {
			byNumber[l.Number] = l
		}
		observed := []float64{}
		for _, s := range r.record.Evidence.Stops {
			if s.StationaryMs <= 0 || s.StationaryMs > 3500 {
				continue
			} // tyres-only observations
			valid := true
			var extra float64
			for number := s.InLap; number <= s.OutLap; number++ {
				l, ok := byNumber[number]
				c, known := contextFor(r.record, l)
				if !ok || !known || c.ID != contextID || l.FuelKg == nil || l.SetupRevision != r.laps[0].SetupRevision {
					valid = false
					break
				}
				for _, flag := range l.Flags {
					if flag != "pit" {
						valid = false
					}
				}
				if number == s.OutLap {
					l.Compound = l.EndCompound
					l.TyreAge = l.EndTyreAge
				}
				if _, ok := models[l.Compound]; !ok {
					valid = false
					break
				}
				extra += float64(l.TimeMs) - r.intercept - dot(features(l, models), beta)
			}
			if !valid || extra < 5000 || extra > 120000 {
				continue
			}
			observed = append(observed, extra)
			stops++
		}
		if len(observed) > 0 {
			records = append(records, r.record)
			values = append(values, median(observed))
			ids.add(r.record)
		}
	}
	if len(ids.users) < MinUsers || len(ids.sessions) < 3 {
		return nil
	}
	weights := recordWeights(records)
	center := weightedMedian(values, weights)
	return &PitModel{AdditionalTimeMs: center, MedianAbsoluteDeviationMs: weightedMAD(values, weights, center), Users: len(ids.users), Sessions: len(ids.sessions), Stops: stops}
}

func enumeratePlans(models []CompoundModel, pit *PitModel, laps int, request Request) []Plan {
	best := map[string]Plan{}
	var visit func([]Stint, []int, float64, map[string]int, int)
	visit = func(stints []Stint, sequence []int, cost float64, used map[string]int, next int) {
		if next > laps {
			if request.RequireTwoCompounds && len(used) < 2 {
				return
			}
			keyBytes, _ := json.Marshal(sequence)
			key := string(keyBytes)
			p := Plan{Stints: append([]Stint(nil), stints...), PitLaps: []int{}, RelativeCostMs: cost}
			for _, s := range stints[:len(stints)-1] {
				p.PitLaps = append(p.PitLaps, s.EndLap)
			}
			old, ok := best[key]
			if !ok || cost < old.RelativeCostMs {
				best[key] = p
			}
			return
		}
		if len(stints) > request.MaxStops || (len(stints) > 0 && pit == nil) {
			return
		}
		for _, m := range models {
			// Only the first two tyre laps may use the fitted
			// intercept for warm-up. Never extend a stint beyond observed age.
			if m.MinAge > 2 || used[m.Tyre] >= request.AvailableSets[m.Tyre] {
				continue
			}
			maxLength := min(laps-next+1, m.MaxAge+1)
			minLength := 3
			if len(stints) == request.MaxStops {
				minLength = max(minLength, laps-next+1)
			}
			for length := minLength; length <= maxLength; length++ {
				end := next + length - 1
				increment := float64(length)*m.OffsetMs + float64(length*(length-1))/2*m.AgeSlopeMs
				if len(stints) > 0 {
					increment += pit.AdditionalTimeMs
				}
				used[m.Tyre]++
				visit(append(stints, Stint{Tyre: m.Tyre, Compound: m.Compound, StartLap: next, EndLap: end}), append(sequence, m.Compound), cost+increment, used, end+1)
				used[m.Tyre]--
				if used[m.Tyre] == 0 {
					delete(used, m.Tyre)
				}
			}
		}
	}
	visit(nil, nil, 0, map[string]int{}, 1)
	out := make([]Plan, 0, len(best))
	for _, p := range best {
		out = append(out, p)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].RelativeCostMs != out[j].RelativeCostMs {
			return out[i].RelativeCostMs < out[j].RelativeCostMs
		}
		a, _ := json.Marshal(out[i].Stints)
		b, _ := json.Marshal(out[j].Stints)
		return string(a) < string(b)
	})
	if len(out) > 8 {
		out = out[:8]
	}
	if len(out) > 0 {
		for i := range out {
			out[i].DeltaMs = out[i].RelativeCostMs - out[0].RelativeCostMs
		}
	}
	return out
}

func energyProfile(races []raceData) ERSProfile {
	out := ERSProfile{Status: "insufficient-data", Segments: []EnergySector{}}
	ids := newIdentities()
	records := []Record{}
	recordLaps := [][]Lap{}
	for _, r := range races {
		observed := []Lap{}
		for _, l := range r.laps {
			if len(l.Energy) != 3 || l.ERSStartJ == nil || l.ERSEndJ == nil {
				continue
			}
			var duration float64
			valid := true
			for _, s := range l.Energy {
				duration += s.DurationMs
				if s.DurationMs == 0 {
					valid = false
				}
			}
			// At least 98% native status coverage is needed for an
			// observed energy budget. This does not establish an ERS speed benefit.
			if !valid || duration < float64(l.TimeMs)*.98 {
				continue
			}
			observed = append(observed, l)
			out.Laps++
			if *l.ERSEndJ >= *l.ERSStartJ {
				out.SustainableLaps++
			}
		}
		if len(observed) > 0 {
			records = append(records, r.record)
			recordLaps = append(recordLaps, observed)
			ids.add(r.record)
		}
	}
	out.Users, out.Sessions = len(ids.users), len(ids.sessions)
	if out.Users < MinUsers || out.Sessions < MinSessions {
		return out
	}
	out.Status = "observed-budget"
	weights := recordWeights(records)
	out.Segments = make([]EnergySector, 3)
	for segment := 0; segment < 3; segment++ {
		deploy, harvest, duration, speed := []float64{}, []float64{}, []float64{}, []float64{}
		for _, laps := range recordLaps {
			d, h, t, v := []float64{}, []float64{}, []float64{}, []float64{}
			for _, l := range laps {
				s := l.Energy[segment]
				d = append(d, s.DeployedJ)
				h = append(h, s.HarvestedJ)
				t = append(t, s.DurationMs)
				v = append(v, s.MeanSpeedKph)
			}
			deploy = append(deploy, median(d))
			harvest = append(harvest, median(h))
			duration = append(duration, median(t))
			speed = append(speed, median(v))
		}
		out.Segments[segment] = EnergySector{weightedMedian(deploy, weights), weightedMedian(harvest, weights), weightedMedian(duration, weights), weightedMedian(speed, weights)}
	}
	starts, ends := []float64{}, []float64{}
	deploy, harvest, net := []float64{}, []float64{}, []float64{}
	for _, laps := range recordLaps {
		a, b := []float64{}, []float64{}
		d, h, n := []float64{}, []float64{}, []float64{}
		for _, l := range laps {
			a = append(a, *l.ERSStartJ)
			b = append(b, *l.ERSEndJ)
			var lapDeploy, lapHarvest float64
			for _, s := range l.Energy {
				lapDeploy += s.DeployedJ
				lapHarvest += s.HarvestedJ
			}
			d = append(d, lapDeploy)
			h = append(h, lapHarvest)
			n = append(n, lapDeploy-lapHarvest)
		}
		starts = append(starts, median(a))
		ends = append(ends, median(b))
		deploy = append(deploy, median(d))
		harvest = append(harvest, median(h))
		net = append(net, median(n))
	}
	out.StartEnergyJ, out.EndEnergyJ = weightedMedian(starts, weights), weightedMedian(ends, weights)
	// Segment medians are descriptive profiles. Lap totals and net use must
	// preserve paired observations before record medians and weighted aggregation.
	out.DeployedJ, out.HarvestedJ, out.NetUseJ = weightedMedian(deploy, weights), weightedMedian(harvest, weights), weightedMedian(net, weights)
	return out
}
