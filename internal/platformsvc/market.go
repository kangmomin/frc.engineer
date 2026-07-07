package platformsvc

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

// Listing kinds.
const (
	KindSetup    = "setup"
	KindStrategy = "strategy"
)

// Marketplace limits and errors.
const (
	maxListingPrice = 1_000_000
	maxTitleLen     = 80
	minStrategyLaps = 5 // a strategy listing needs a meaningful stint length
	browseLimit     = 100
	similarLimit    = 6
)

var (
	// ErrForbidden: the caller may not act on this resource (not owner, or the
	// race is not plausible / has no setup). ErrConflict: an active listing for
	// this (seller, race, kind) already exists.
	ErrForbidden = errors.New("platformsvc: forbidden")
	ErrConflict  = errors.New("platformsvc: conflict")
)

// ListingCard is the PUBLIC marketplace shape. It deliberately has NO payload,
// content_hash, or params_canonical field — masking is enforced by type
// absence, not by nulling, so it cannot regress into leaking the product.
// Rating/ReviewCount are public review aggregates (0 when a listing has no
// reviews); reviews from banned authors are excluded to match ListReviews.
type ListingCard struct {
	ID            string  `json:"id"`
	Kind          string  `json:"kind"`
	Title         string  `json:"title"`
	SellerPersona string  `json:"sellerPersona"`
	TrackID       int     `json:"trackId"`
	GameFormat    string  `json:"gameFormat"`
	PriceCredits  int64   `json:"priceCredits"`
	Status        string  `json:"status"`
	CreatedAt     string  `json:"createdAt"`
	Rating        float64 `json:"rating"`
	ReviewCount   int     `json:"reviewCount"`
}

// reviewAggJoin is the review rating/count aggregate joined into every card
// query. Banned authors are excluded so a banned reviewer can't skew a rating.
// Reference the joined columns as coalesce(rv.rating, 0), coalesce(rv.review_count, 0).
const reviewAggJoin = `
	LEFT JOIN (
		SELECT r.listing_id, avg(r.stars)::float8 AS rating, count(*)::int AS review_count
		FROM platform.reviews r
		WHERE NOT EXISTS (SELECT 1 FROM platform.account_bans ab WHERE ab.account_id = r.author_id)
		GROUP BY r.listing_id
	) rv ON rv.listing_id = l.id`

// OwnerListing is the OWNER-ONLY detail shape: a card plus the revealed payload.
// It is produced only when the viewer owns the listing (later: or has purchased
// it, 3D1). Non-owners receive a bare ListingCard instead.
type OwnerListing struct {
	ListingCard
	Owned   bool            `json:"owned"`
	Payload json.RawMessage `json:"payload"`
}

// CreateListingRequest is the POST /listings body. It carries NO params — the
// server derives the snapshot from the seller's own race.
type CreateListingRequest struct {
	Kind         string `json:"kind"`
	SourceRaceID string `json:"sourceRaceId"`
	Title        string `json:"title"`
	PriceCredits int64  `json:"priceCredits"`
}

// Stint is one contiguous run on a tyre compound, derived server-side from a
// race's laps (never client-supplied).
type Stint struct {
	Compound string `json:"compound"`
	Laps     int    `json:"laps"`
}

// deriveStints collapses an ordered compound-per-lap sequence into stints.
// Empty compounds (unknown tyre, normalized away) are skipped so they don't
// fragment or bridge real stints.
func deriveStints(compounds []string) []Stint {
	out := []Stint{}
	for _, c := range compounds {
		if c == "" {
			continue
		}
		if n := len(out); n > 0 && out[n-1].Compound == c {
			out[n-1].Laps++
			continue
		}
		out = append(out, Stint{Compound: c, Laps: 1})
	}
	return out
}

// canonicalizeStints serializes stints deterministically and returns the bytes
// plus their sha256 hex (content_hash). Slice order is preserved and struct
// fields are fixed, so identical strategies hash identically.
func canonicalizeStints(stints []Stint) ([]byte, string) {
	b, _ := json.Marshal(stints) // []Stint never fails to marshal
	sum := sha256.Sum256(b)
	return b, hex.EncodeToString(sum[:])
}

// validateListingReq checks and normalizes a create-listing request.
func validateListingReq(req *CreateListingRequest) error {
	if req.Kind != KindSetup && req.Kind != KindStrategy {
		return ErrBadUpload
	}
	if n := utf8.RuneCountInString(req.SourceRaceID); n < 1 || n > maxSourceRaceLen {
		return ErrBadUpload
	}
	req.Title = strings.TrimSpace(req.Title)
	if req.Title == "" || utf8.RuneCountInString(req.Title) > maxTitleLen || hasControlChar(req.Title) {
		return ErrBadUpload
	}
	if req.PriceCredits < 1 || req.PriceCredits > maxListingPrice {
		return ErrBadUpload
	}
	return nil
}

func hasControlChar(s string) bool {
	for _, r := range s {
		if r != '\t' && unicode.IsControl(r) {
			return true
		}
	}
	return false
}

// hasControlCharAllowNewline is hasControlChar but also permits '\n'/'\r'. Used
// for multi-line free text (review bodies) where line breaks are legitimate and
// safe (stored as-is, rendered as text).
func hasControlCharAllowNewline(s string) bool {
	for _, r := range s {
		if r == '\t' || r == '\n' || r == '\r' {
			continue
		}
		if unicode.IsControl(r) {
			return true
		}
	}
	return false
}

// CreateListing derives an immutable snapshot from the seller's OWN plausible
// race (never from client input) and creates a listing, all in one transaction.
// It touches no credits (economy is 3D1). Returns the new listing id.
func (s *Store) CreateListing(ctx context.Context, sellerID string, req CreateListingRequest) (string, error) {
	if err := validateListingReq(&req); err != nil {
		return "", err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("platformsvc: listing begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // no-op after Commit

	// Resolve the seller's OWN race (account_id = caller). A forged/foreign
	// source id simply doesn't match → ErrNotFound.
	var raceID, gameFormat string
	var trackID int
	var plausible bool
	err = tx.QueryRow(ctx, `
		SELECT id, track_id, game_format, plausible
		FROM platform.races WHERE account_id = $1 AND source_race_id = $2`,
		sellerID, req.SourceRaceID,
	).Scan(&raceID, &trackID, &gameFormat, &plausible)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("platformsvc: resolve race: %w", err)
	}
	if !plausible {
		return "", ErrForbidden // only plausible races are sellable
	}

	canon, payload, hash, err := s.deriveSnapshot(ctx, tx, req.Kind, raceID)
	if err != nil {
		return "", err
	}

	var snapshotID string
	if err := tx.QueryRow(ctx, `
		INSERT INTO platform.snapshots (kind, content_hash, params_canonical, payload, race_id, seller_id)
		VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
		req.Kind, hash, canon, string(payload), raceID, sellerID,
	).Scan(&snapshotID); err != nil {
		return "", fmt.Errorf("platformsvc: insert snapshot: %w", err)
	}

	var listingID string
	err = tx.QueryRow(ctx, `
		INSERT INTO platform.listings
		    (seller_id, kind, snapshot_id, race_id, track_id, game_format, title, price_credits)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
		sellerID, req.Kind, snapshotID, raceID, trackID, gameFormat, req.Title, req.PriceCredits,
	).Scan(&listingID)
	if isUniqueViolation(err) {
		return "", ErrConflict // already an active listing for this race+kind
	}
	if err != nil {
		return "", fmt.Errorf("platformsvc: insert listing: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("platformsvc: listing commit: %w", err)
	}
	return listingID, nil
}

// deriveSnapshot builds the canonical bytes, display payload, and content hash
// for a listing kind from the race's server-side data. For setups it freezes
// the (immutable) race_setup; for strategies it derives stints from all laps in
// lap order.
func (s *Store) deriveSnapshot(ctx context.Context, tx pgx.Tx, kind, raceID string) (canon, payload []byte, hash string, err error) {
	switch kind {
	case KindSetup:
		err = tx.QueryRow(ctx,
			`SELECT params_canonical, content_hash FROM platform.race_setup WHERE race_id = $1`, raceID,
		).Scan(&canon, &hash)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil, "", ErrForbidden // no setup captured for this race
		}
		if err != nil {
			return nil, nil, "", fmt.Errorf("platformsvc: read race_setup: %w", err)
		}
		return canon, canon, hash, nil // params_canonical is already the display JSON

	case KindStrategy:
		rows, qerr := tx.Query(ctx,
			`SELECT tyre FROM platform.laps WHERE race_id = $1 ORDER BY lap_number`, raceID)
		if qerr != nil {
			return nil, nil, "", fmt.Errorf("platformsvc: read laps: %w", qerr)
		}
		var compounds []string
		for rows.Next() {
			var tyre string
			if serr := rows.Scan(&tyre); serr != nil {
				rows.Close()
				return nil, nil, "", fmt.Errorf("platformsvc: scan lap tyre: %w", serr)
			}
			compounds = append(compounds, tyre)
		}
		rows.Close()
		if rows.Err() != nil {
			return nil, nil, "", fmt.Errorf("platformsvc: laps iterate: %w", rows.Err())
		}
		stints := deriveStints(compounds)
		total := 0
		for _, st := range stints {
			total += st.Laps
		}
		if len(stints) == 0 || total < minStrategyLaps {
			return nil, nil, "", ErrForbidden // not enough real stint data to sell
		}
		b, h := canonicalizeStints(stints)
		return b, b, h, nil
	}
	return nil, nil, "", ErrBadUpload
}

// BrowseListings returns active listing cards for a kind+track+format, newest
// first, excluding banned sellers. Never exposes payload/hash.
func (s *Store) BrowseListings(ctx context.Context, kind string, trackID int, format string) ([]ListingCard, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT l.id, l.kind, l.title, a.persona, l.track_id, l.game_format,
		       l.price_credits, l.status, l.created_at,
		       coalesce(rv.rating, 0), coalesce(rv.review_count, 0)
		FROM platform.listings l
		JOIN platform.accounts a ON a.id = l.seller_id`+reviewAggJoin+`
		WHERE l.kind = $1 AND l.track_id = $2 AND l.game_format = $3 AND l.status = 'active'
		  AND NOT EXISTS (SELECT 1 FROM platform.account_bans b WHERE b.account_id = l.seller_id)
		ORDER BY l.created_at DESC
		LIMIT $4`,
		kind, trackID, format, browseLimit,
	)
	if err != nil {
		return nil, fmt.Errorf("platformsvc: browse: %w", err)
	}
	return scanCards(rows)
}

// GetListing returns a listing's card and, only when the viewer owns it, the
// revealed payload (json.RawMessage). Non-owners get payload=nil. A listing that
// is delisted or whose seller is banned is invisible to non-owners — returned as
// ErrNotFound (uniform with a missing id, so listing-id probing reveals nothing).
// The payload column is fetched ONLY on the owner branch.
func (s *Store) GetListing(ctx context.Context, id, viewerID string) (*ListingCard, json.RawMessage, error) {
	var card ListingCard
	var sellerID, snapshotID string
	var sellerBanned bool
	var createdAt time.Time
	err := s.pool.QueryRow(ctx, `
		SELECT l.id, l.kind, l.title, a.persona, l.track_id, l.game_format,
		       l.price_credits, l.status, l.created_at, l.seller_id, l.snapshot_id,
		       (b.account_id IS NOT NULL),
		       coalesce(rv.rating, 0), coalesce(rv.review_count, 0)
		FROM platform.listings l
		JOIN platform.accounts a ON a.id = l.seller_id
		LEFT JOIN platform.account_bans b ON b.account_id = l.seller_id`+reviewAggJoin+`
		WHERE l.id = $1`,
		id,
	).Scan(&card.ID, &card.Kind, &card.Title, &card.SellerPersona, &card.TrackID,
		&card.GameFormat, &card.PriceCredits, &card.Status, &createdAt, &sellerID, &snapshotID, &sellerBanned,
		&card.Rating, &card.ReviewCount)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, ErrNotFound
	}
	if err != nil {
		return nil, nil, fmt.Errorf("platformsvc: get listing: %w", err)
	}
	card.CreatedAt = createdAt.Format(time.RFC3339)

	isOwner := viewerID != "" && viewerID == sellerID
	if !isOwner && (card.Status != "active" || sellerBanned) {
		return nil, nil, ErrNotFound // masked-as-missing
	}
	if !isOwner {
		return &card, nil, nil
	}
	// Owner branch: only here is the payload column ever read.
	var payload json.RawMessage
	if err := s.pool.QueryRow(ctx,
		`SELECT payload FROM platform.snapshots WHERE id = $1`, snapshotID,
	).Scan(&payload); err != nil {
		return nil, nil, fmt.Errorf("platformsvc: read payload: %w", err)
	}
	return &card, payload, nil
}

// SimilarListings returns up to similarLimit active listings of the same
// kind+track+format as the target, cheapest first, excluding the target and
// banned sellers. Uses only the target's kind/track/format — never its
// content_hash (which must stay non-observable). The target lookup applies the
// same active + non-banned gate as GetListing so a delisted/banned/missing
// target 404s UNIFORMLY across both endpoints (no id-probing state oracle).
func (s *Store) SimilarListings(ctx context.Context, id string) ([]ListingCard, error) {
	var kind, format string
	var trackID int
	err := s.pool.QueryRow(ctx, `
		SELECT l.kind, l.track_id, l.game_format
		FROM platform.listings l
		WHERE l.id = $1 AND l.status = 'active'
		  AND NOT EXISTS (SELECT 1 FROM platform.account_bans b WHERE b.account_id = l.seller_id)`,
		id,
	).Scan(&kind, &trackID, &format)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("platformsvc: similar target: %w", err)
	}
	rows, err := s.pool.Query(ctx, `
		SELECT l.id, l.kind, l.title, a.persona, l.track_id, l.game_format,
		       l.price_credits, l.status, l.created_at,
		       coalesce(rv.rating, 0), coalesce(rv.review_count, 0)
		FROM platform.listings l
		JOIN platform.accounts a ON a.id = l.seller_id`+reviewAggJoin+`
		WHERE l.kind = $1 AND l.track_id = $2 AND l.game_format = $3 AND l.status = 'active'
		  AND l.id <> $4
		  AND NOT EXISTS (SELECT 1 FROM platform.account_bans b WHERE b.account_id = l.seller_id)
		ORDER BY l.price_credits ASC, l.created_at DESC
		LIMIT $5`,
		kind, trackID, format, id, similarLimit,
	)
	if err != nil {
		return nil, fmt.Errorf("platformsvc: similar: %w", err)
	}
	return scanCards(rows)
}

// SellableRace is one of the caller's OWN plausible races, offered to the sell
// picker. It carries only the caller's own non-sensitive race metadata — never a
// content_hash and never setup params (those reveal only via owner detail).
type SellableRace struct {
	SourceRaceID string `json:"sourceRaceId"`
	TrackID      int    `json:"trackId"`
	TrackName    string `json:"trackName"`
	GameFormat   string `json:"gameFormat"`
	BestLapMS    *int   `json:"bestLapMs"`
	HasSetup     bool   `json:"hasSetup"` // sellable as a setup listing
	LapCount     int    `json:"lapCount"` // sellable as a strategy if ≥ minStrategyLaps
}

// ListMyRaces returns the caller's own plausible races, newest first, with the
// metadata the sell picker needs to decide setup/strategy eligibility. Scoped to
// account_id = caller, so it can never surface another user's races.
func (s *Store) ListMyRaces(ctx context.Context, accountID string) ([]SellableRace, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT r.source_race_id, r.track_id, r.track_name, r.game_format, r.best_lap_ms,
		       (rs.race_id IS NOT NULL) AS has_setup,
		       (SELECT count(*) FROM platform.laps l WHERE l.race_id = r.id) AS lap_count
		FROM platform.races r
		LEFT JOIN platform.race_setup rs ON rs.race_id = r.id
		WHERE r.account_id = $1 AND r.plausible
		ORDER BY r.uploaded_at DESC
		LIMIT $2`,
		accountID, browseLimit,
	)
	if err != nil {
		return nil, fmt.Errorf("platformsvc: my races: %w", err)
	}
	defer rows.Close()
	out := []SellableRace{}
	for rows.Next() {
		var sr SellableRace
		var best *int
		if err := rows.Scan(&sr.SourceRaceID, &sr.TrackID, &sr.TrackName, &sr.GameFormat,
			&best, &sr.HasSetup, &sr.LapCount); err != nil {
			return nil, fmt.Errorf("platformsvc: scan sellable race: %w", err)
		}
		sr.BestLapMS = best
		out = append(out, sr)
	}
	return out, rows.Err()
}

// ListMyListings returns the caller's OWN listings (active AND delisted), newest
// first, as cards. Never exposes payload/hash. Owner-scoped so a delisted card
// stays visible to its seller (for re-listing) but to no one else.
func (s *Store) ListMyListings(ctx context.Context, sellerID string) ([]ListingCard, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT l.id, l.kind, l.title, a.persona, l.track_id, l.game_format,
		       l.price_credits, l.status, l.created_at,
		       coalesce(rv.rating, 0), coalesce(rv.review_count, 0)
		FROM platform.listings l
		JOIN platform.accounts a ON a.id = l.seller_id`+reviewAggJoin+`
		WHERE l.seller_id = $1
		ORDER BY l.created_at DESC
		LIMIT $2`,
		sellerID, browseLimit,
	)
	if err != nil {
		return nil, fmt.Errorf("platformsvc: my listings: %w", err)
	}
	return scanCards(rows)
}

// Delist marks the seller's own active listing delisted. Returns ErrNotFound if
// it doesn't exist, isn't the caller's, or is already delisted.
func (s *Store) Delist(ctx context.Context, sellerID, id string) error {
	tag, err := s.pool.Exec(ctx,
		`UPDATE platform.listings SET status = 'delisted'
		 WHERE id = $1 AND seller_id = $2 AND status = 'active'`,
		id, sellerID,
	)
	if err != nil {
		return fmt.Errorf("platformsvc: delist: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func scanCards(rows pgx.Rows) ([]ListingCard, error) {
	defer rows.Close()
	out := []ListingCard{}
	for rows.Next() {
		var c ListingCard
		var createdAt time.Time
		if err := rows.Scan(&c.ID, &c.Kind, &c.Title, &c.SellerPersona, &c.TrackID,
			&c.GameFormat, &c.PriceCredits, &c.Status, &createdAt, &c.Rating, &c.ReviewCount); err != nil {
			return nil, fmt.Errorf("platformsvc: scan card: %w", err)
		}
		c.CreatedAt = createdAt.Format(time.RFC3339)
		out = append(out, c)
	}
	return out, rows.Err()
}
