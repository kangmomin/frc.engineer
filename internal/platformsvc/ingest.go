package platformsvc

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// ErrDuplicate is returned when a race with the same (account, source) was
// already uploaded. ErrBadUpload flags a malformed payload (no laps, too many
// laps, duplicate lap numbers).
var (
	ErrDuplicate = errors.New("platformsvc: duplicate upload")
	ErrBadUpload = errors.New("platformsvc: bad upload")
)

// Generic plausibility bounds (milliseconds) used when a track has no
// track_bounds row. Deliberately wide — this is anti-noise, not anti-cheat
// (§trust model): it rejects garbage, not a determined forger. The min is a
// globally-safe floor: no official F1 lap is under ~63s, so 45s never rejects a
// real lap while still lifting the toppable floor well above zero.
const (
	genericMinLapMs = 45_000  // 45s: safely below any real F1 lap
	genericMaxLapMs = 900_000 // 15min: above any plausible lap incl. incidents
)

// sectorSumToleranceMs bounds how far the three sector times may sum away from
// the lap time before the lap is treated as inconsistent. Sectors carry sub-ms
// rounding, so a small slack is expected.
const sectorSumToleranceMs = 1500

// Input caps (worst-case ingest bounds; DoS guard).
const (
	maxLapsPerUpload  = 500
	maxLapNumber      = 1000
	maxSourceRaceLen  = 128
	maxGameFormatLen  = 32
	maxSessionTypeLen = 48
	maxTrackNameLen   = 64

	// Rich Detail caps (player-centric; worst-case 2026 24-car/78-lap fits well
	// under the 512 KiB body cap).
	maxDetailStints   = 30
	maxDetailDynamics = 500
	maxDetailEvents   = 200
	maxSchemaVersion  = 32767 // SMALLINT ceiling (race_detail.schema_version)
)

// validTyres whitelists the compound strings that may reach the public pace
// leaderboard (mode() aggregation). Anything else normalizes to "" so attacker
// text can't be surfaced. Mirrors internal/analysis compoundName.
var validTyres = map[string]struct{}{
	"Soft": {}, "Medium": {}, "Hard": {}, "Inter": {}, "Wet": {},
}

func normalizeTyre(t string) string {
	if _, ok := validTyres[t]; ok {
		return t
	}
	return ""
}

// validateUpload enforces the payload's structural bounds before any DB work and
// normalizes tyre strings in place. Returns ErrBadUpload on any violation
// (including duplicate lap numbers, caught here for a clean 400 rather than a
// unique-violation backstop).
func validateUpload(req *UploadRequest) error {
	n := utf8.RuneCountInString(req.SourceRaceID)
	if n < 1 || n > maxSourceRaceLen {
		return ErrBadUpload
	}
	if utf8.RuneCountInString(req.GameFormat) > maxGameFormatLen ||
		utf8.RuneCountInString(req.SessionType) > maxSessionTypeLen ||
		utf8.RuneCountInString(req.TrackName) > maxTrackNameLen {
		return ErrBadUpload
	}
	if req.TrackID < -1 || req.TrackID > 255 {
		return ErrBadUpload
	}
	if len(req.Laps) == 0 || len(req.Laps) > maxLapsPerUpload {
		return ErrBadUpload
	}
	seen := make(map[int]struct{}, len(req.Laps))
	for i := range req.Laps {
		lp := &req.Laps[i]
		if lp.LapNumber < 1 || lp.LapNumber > maxLapNumber {
			return ErrBadUpload
		}
		if _, dup := seen[lp.LapNumber]; dup {
			return ErrBadUpload
		}
		// ms columns are int4: a value in (2^31, 2^32) is JSON-decodable into
		// uint32 but overflows the column, turning a bad payload into a 500 at
		// INSERT time. Reject here for a clean 400.
		if lp.LapMs > math.MaxInt32 || lp.S1Ms > math.MaxInt32 || lp.S2Ms > math.MaxInt32 || lp.S3Ms > math.MaxInt32 {
			return ErrBadUpload
		}
		seen[lp.LapNumber] = struct{}{}
		lp.Tyre = normalizeTyre(lp.Tyre)
	}
	// A huge-but-JSON-legal setup float (|f| > ~1.8e305) rounds to ±Inf in
	// canonicalizeSetup and fails json.Marshal → 500. Reject non-finite /
	// implausible values here for a clean 400 before any DB work.
	if req.Setup != nil && !setupFloatsFinite(req.Setup) {
		return ErrBadUpload
	}
	// schema_version is a SMALLINT column: a value past its range would 500 at
	// INSERT (mirrors the int4 lap-ms guard above). Detail requires a real version.
	if req.SchemaVersion < 0 || req.SchemaVersion > maxSchemaVersion {
		return ErrBadUpload
	}
	if req.Detail != nil {
		if req.SchemaVersion < 1 {
			return ErrBadUpload
		}
		if len(req.Detail.Stints) > maxDetailStints ||
			len(req.Detail.Dynamics) > maxDetailDynamics ||
			len(req.Detail.Events) > maxDetailEvents {
			return ErrBadUpload
		}
	}
	return nil
}

// setupNumericMax bounds any single float setup field. Real setups are tiny
// (camber ~ -3, tyre pressure ~ 20, fuel ~ 0..110); 1e6 is absurdly generous
// while keeping round3 (×1000) finite so canonicalizeSetup never marshals ±Inf.
const setupNumericMax = 1e6

func floatFinite(f float64) bool {
	return !math.IsNaN(f) && !math.IsInf(f, 0) && math.Abs(f) <= setupNumericMax
}

func setupFloatsFinite(s *UploadSetup) bool {
	return floatFinite(s.FrontCamber) && floatFinite(s.RearCamber) &&
		floatFinite(s.FrontToe) && floatFinite(s.RearToe) &&
		floatFinite(s.RearLeftTyrePressure) && floatFinite(s.RearRightTyrePressure) &&
		floatFinite(s.FrontLeftTyrePressure) && floatFinite(s.FrontRightTyrePressure) &&
		floatFinite(s.FuelLoad)
}

// UploadLap is one lap in an ingest payload. Every field is attacker-controlled;
// `Valid` is only an advisory input to the server-side validity decision.
type UploadLap struct {
	LapNumber int    `json:"lapNumber"`
	LapMs     uint32 `json:"lapMs"`
	S1Ms      uint32 `json:"s1Ms"`
	S2Ms      uint32 `json:"s2Ms"`
	S3Ms      uint32 `json:"s3Ms"`
	Tyre      string `json:"tyre"`
	Valid     bool   `json:"valid"`
}

// UploadSetup mirrors packets.CarSetupData (23 fields). Stored privately in
// race_setup; never returned on a public endpoint.
type UploadSetup struct {
	FrontWing              int     `json:"frontWing"`
	RearWing               int     `json:"rearWing"`
	OnThrottle             int     `json:"onThrottle"`
	OffThrottle            int     `json:"offThrottle"`
	FrontCamber            float64 `json:"frontCamber"`
	RearCamber             float64 `json:"rearCamber"`
	FrontToe               float64 `json:"frontToe"`
	RearToe                float64 `json:"rearToe"`
	FrontSuspension        int     `json:"frontSuspension"`
	RearSuspension         int     `json:"rearSuspension"`
	FrontAntiRollBar       int     `json:"frontAntiRollBar"`
	RearAntiRollBar        int     `json:"rearAntiRollBar"`
	FrontSuspensionHeight  int     `json:"frontSuspensionHeight"`
	RearSuspensionHeight   int     `json:"rearSuspensionHeight"`
	BrakePressure          int     `json:"brakePressure"`
	BrakeBias              int     `json:"brakeBias"`
	EngineBraking          int     `json:"engineBraking"`
	RearLeftTyrePressure   float64 `json:"rearLeftTyrePressure"`
	RearRightTyrePressure  float64 `json:"rearRightTyrePressure"`
	FrontLeftTyrePressure  float64 `json:"frontLeftTyrePressure"`
	FrontRightTyrePressure float64 `json:"frontRightTyrePressure"`
	Ballast                int     `json:"ballast"`
	FuelLoad               float64 `json:"fuelLoad"`
}

// UploadRequest is the POST /races body. sourceRaceId is the local
// RaceSummary.ID; (account, sourceRaceId) is unique so re-upload is a no-op
// reject. Laps feed the (public) leaderboards; Setup is the private sellable
// snapshot; Detail is the private rich document (stints/dynamics/events) stored
// opaquely in race_detail and never surfaced on a public endpoint.
type UploadRequest struct {
	SourceRaceID  string        `json:"sourceRaceId"`
	TrackID       int           `json:"trackId"`
	TrackName     string        `json:"trackName"`
	SessionType   string        `json:"sessionType"`
	GameFormat    string        `json:"gameFormat"`
	Laps          []UploadLap   `json:"laps"`
	Setup         *UploadSetup  `json:"setup,omitempty"`
	SchemaVersion int           `json:"schemaVersion,omitempty"`
	Detail        *UploadDetail `json:"detail,omitempty"`
}

// UploadDetail is the rich, private per-race document stored (versioned) in
// race_detail. Per-lap timing lives in Laps (leaderboard) and the setup in Setup,
// so Detail carries only what has no relational home: stints, per-lap dynamics,
// and the event/issue timeline. Stored opaquely — validated for size, re-marshaled
// canonically, never trusted for any server-derived value.
type UploadDetail struct {
	Stints   []UploadStint   `json:"stints,omitempty"`
	Dynamics []UploadDynamic `json:"dynamics,omitempty"`
	Events   []UploadEvent   `json:"events,omitempty"`
}

// UploadStint mirrors races.RaceStint.
type UploadStint struct {
	Compound    string `json:"compound"`
	Laps        int    `json:"laps"`
	StartLap    int    `json:"startLap,omitempty"`
	EndLap      int    `json:"endLap,omitempty"`
	TireWearPct int    `json:"tireWearPct,omitempty"`
}

// UploadDynamic mirrors dto.DynamicsLapDTO.
type UploadDynamic struct {
	LapNum        int     `json:"lapNum"`
	UndersteerPct float64 `json:"understeerPct"`
	OversteerPct  float64 `json:"oversteerPct"`
	LockupCount   int     `json:"lockupCount"`
	SpinCount     int     `json:"spinCount"`
}

// UploadEvent mirrors dto.RaceControlNotification (the race lap tag + text).
type UploadEvent struct {
	Lap        int    `json:"lap,omitempty"`
	Timestamp  int64  `json:"timestamp,omitempty"`
	Category   string `json:"category"`
	Message    string `json:"message"`
	Severity   string `json:"severity"`
	DriverName string `json:"driverName,omitempty"`
}

// UploadResult is the ingest response. Plausible reports whether the race
// passed the anti-noise gate (NOT trust). BestLapMS is 0 when no lap was valid.
// Duplicate is true on an idempotent re-upload (the race already existed).
type UploadResult struct {
	RaceID     string `json:"raceId"`
	Plausible  bool   `json:"plausible"`
	BestLapMS  uint32 `json:"bestLapMs"`
	StoredLaps int    `json:"storedLaps"`
	ValidLaps  int    `json:"validLaps"`
	Duplicate  bool   `json:"duplicate"`
}

// canonicalizeSetup produces deterministic bytes for a setup so that identical
// setups hash identically (content_hash). Struct field order is fixed by Go's
// json marshaller; floats are rounded to 3 decimals to absorb telemetry jitter.
func canonicalizeSetup(s UploadSetup) ([]byte, string, error) {
	q := s
	q.FrontCamber = round3(q.FrontCamber)
	q.RearCamber = round3(q.RearCamber)
	q.FrontToe = round3(q.FrontToe)
	q.RearToe = round3(q.RearToe)
	q.RearLeftTyrePressure = round3(q.RearLeftTyrePressure)
	q.RearRightTyrePressure = round3(q.RearRightTyrePressure)
	q.FrontLeftTyrePressure = round3(q.FrontLeftTyrePressure)
	q.FrontRightTyrePressure = round3(q.FrontRightTyrePressure)
	q.FuelLoad = round3(q.FuelLoad)
	b, err := json.Marshal(q)
	if err != nil {
		return nil, "", err
	}
	sum := sha256.Sum256(b)
	return b, hex.EncodeToString(sum[:]), nil
}

func round3(f float64) float64 {
	return math.Round(f*1000) / 1000
}

// validateLap applies the plausibility gate to one lap given the resolved
// bounds. Returns the server-decided validity (advisory).
func validateLap(l UploadLap, minMs, maxMs uint32) bool {
	if l.LapMs < minMs || l.LapMs > maxMs {
		return false
	}
	// Bound each sector individually: a single garbage sector (e.g. 2e9 ms) paired
	// with a zero sector would otherwise skip the sum gate below and be served raw
	// on the public leaderboard. Partial telemetry (a zero sector) stays valid.
	lapTol := int64(l.LapMs) + sectorSumToleranceMs
	if int64(l.S1Ms) > lapTol || int64(l.S2Ms) > lapTol || int64(l.S3Ms) > lapTol {
		return false
	}
	if l.S1Ms > 0 && l.S2Ms > 0 && l.S3Ms > 0 {
		sum := int64(l.S1Ms) + int64(l.S2Ms) + int64(l.S3Ms)
		if diff := int64(l.LapMs) - sum; diff > sectorSumToleranceMs || diff < -sectorSumToleranceMs {
			return false
		}
	}
	return l.Valid
}

// IngestRace stores an uploaded race, its laps, and (optionally) its setup in
// one transaction, deriving best_lap_ms and `verified` on the server. It writes
// NOTHING to the ledger — verified races mint no credits (§trust model). A
// re-upload of the same (account, source) yields ErrDuplicate; a malformed
// payload yields ErrBadUpload.
func (s *Store) IngestRace(ctx context.Context, accountID string, req UploadRequest) (*UploadResult, error) {
	if err := validateUpload(&req); err != nil {
		return nil, err
	}
	minMs, maxMs := s.trackBounds(ctx, req.TrackID)

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("platformsvc: ingest begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // no-op after Commit

	var raceID string
	err = tx.QueryRow(ctx, `
		INSERT INTO platform.races
		    (account_id, source_race_id, track_id, track_name, session_type, game_format)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (account_id, source_race_id) DO NOTHING
		RETURNING id`,
		accountID, req.SourceRaceID, req.TrackID, req.TrackName, req.SessionType, req.GameFormat,
	).Scan(&raceID)
	if errors.Is(err, pgx.ErrNoRows) {
		// Idempotent re-upload: return the already-stored race instead of failing,
		// so a client retrying after a post-commit timeout doesn't strand a race.
		return s.existingRace(ctx, tx, accountID, req.SourceRaceID)
	}
	if err != nil {
		return nil, fmt.Errorf("platformsvc: insert race: %w", err)
	}

	var best uint32
	validCount := 0
	for _, lp := range req.Laps {
		sv := validateLap(lp, minMs, maxMs)
		if _, err := tx.Exec(ctx, `
			INSERT INTO platform.laps
			    (race_id, lap_number, lap_ms, s1_ms, s2_ms, s3_ms, tyre, valid)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
			raceID, lp.LapNumber, lp.LapMs, lp.S1Ms, lp.S2Ms, lp.S3Ms, lp.Tyre, sv,
		); err != nil {
			if isUniqueViolation(err) { // duplicate lap_number (validateUpload backstop)
				return nil, ErrBadUpload
			}
			return nil, fmt.Errorf("platformsvc: insert lap: %w", err)
		}
		if sv {
			validCount++
			if best == 0 || lp.LapMs < best {
				best = lp.LapMs
			}
		}
	}
	plausible := validCount > 0

	// best_lap_ms is NULL (not 0) when no lap was valid.
	var bestArg any
	if plausible {
		bestArg = int32(best)
	}
	if _, err := tx.Exec(ctx,
		`UPDATE platform.races SET best_lap_ms = $1, plausible = $2 WHERE id = $3`,
		bestArg, plausible, raceID,
	); err != nil {
		return nil, fmt.Errorf("platformsvc: update race: %w", err)
	}

	if req.Setup != nil {
		canon, hash, err := canonicalizeSetup(*req.Setup)
		if err != nil {
			return nil, fmt.Errorf("platformsvc: canonicalize setup: %w", err)
		}
		if _, err := tx.Exec(ctx,
			`INSERT INTO platform.race_setup (race_id, params_canonical, content_hash) VALUES ($1, $2, $3)`,
			raceID, canon, hash,
		); err != nil {
			return nil, fmt.Errorf("platformsvc: insert setup: %w", err)
		}
	}

	// Rich detail (versioned JSONB), in the same tx as races/laps/setup. Only on
	// the new-race path — a duplicate re-upload returns via existingRace above, so
	// the PK=race_id row is written exactly once with no ON CONFLICT needed.
	if req.Detail != nil {
		payload, err := json.Marshal(req.Detail)
		if err != nil {
			return nil, fmt.Errorf("platformsvc: marshal race detail: %w", err)
		}
		if _, err := tx.Exec(ctx,
			`INSERT INTO platform.race_detail (race_id, schema_version, payload) VALUES ($1, $2, $3)`,
			raceID, req.SchemaVersion, string(payload),
		); err != nil {
			return nil, fmt.Errorf("platformsvc: insert race detail: %w", err)
		}
	}

	// Proof-of-play: stamp verified_at on the account's first plausible race.
	// NO-FAUCET INVARIANT: this mints no credits and must never touch the ledger.
	if plausible {
		if _, err := tx.Exec(ctx,
			`UPDATE platform.accounts SET verified_at = now() WHERE id = $1 AND verified_at IS NULL`,
			accountID,
		); err != nil {
			return nil, fmt.Errorf("platformsvc: stamp verified_at: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("platformsvc: ingest commit: %w", err)
	}
	return &UploadResult{
		RaceID: raceID, Plausible: plausible, BestLapMS: best,
		StoredLaps: len(req.Laps), ValidLaps: validCount,
	}, nil
}

// existingRace returns the already-stored race for an idempotent re-upload.
// StoredLaps/ValidLaps are left 0 on this path (the counts are not re-derived);
// a client MUST treat Duplicate=true as "already synced" and not read lap counts.
func (s *Store) existingRace(ctx context.Context, tx pgx.Tx, accountID, sourceRaceID string) (*UploadResult, error) {
	res := &UploadResult{Duplicate: true}
	var best *int32
	err := tx.QueryRow(ctx,
		`SELECT id, plausible, best_lap_ms FROM platform.races
		 WHERE account_id = $1 AND source_race_id = $2`,
		accountID, sourceRaceID,
	).Scan(&res.RaceID, &res.Plausible, &best)
	if errors.Is(err, pgx.ErrNoRows) {
		// Concurrent in-flight insert not yet visible; caller retries.
		return nil, ErrDuplicate
	}
	if err != nil {
		return nil, fmt.Errorf("platformsvc: existing race: %w", err)
	}
	if best != nil {
		res.BestLapMS = uint32(*best)
	}
	return res, nil
}

// trackBounds resolves plausibility bounds for a track, falling back to generic
// physical bounds when the track has no configured row.
func (s *Store) trackBounds(ctx context.Context, trackID int) (uint32, uint32) {
	var mn, mx int
	err := s.pool.QueryRow(ctx,
		`SELECT min_lap_ms, max_lap_ms FROM platform.track_bounds WHERE track_id = $1`, trackID,
	).Scan(&mn, &mx)
	if err != nil || mn <= 0 || mx <= mn {
		return genericMinLapMs, genericMaxLapMs
	}
	return uint32(mn), uint32(mx)
}

// AllowRate records a hit against a fixed one-minute window for key and reports
// whether the caller is still within maxPerMinute. Counters live in the DB so
// limits survive restarts and hold across instances.
func (s *Store) AllowRate(ctx context.Context, key string, maxPerMinute int) (bool, error) {
	var count int
	err := s.pool.QueryRow(ctx, `
		INSERT INTO platform.rate_limits (key, window_start, count)
		VALUES ($1, date_trunc('minute', now()), 1)
		ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1
		RETURNING count`,
		key,
	).Scan(&count)
	if err != nil {
		return false, fmt.Errorf("platformsvc: rate limit: %w", err)
	}
	return count <= maxPerMinute, nil
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}
