package platformsvc

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// ReviewPerf is the fixed 5-axis performance vector a reviewer scores, each 0..100.
// The keys are a closed set validated server-side (no arbitrary client JSON).
type ReviewPerf struct {
	Downforce int `json:"downforce"`
	TopSpeed  int `json:"topSpeed"`
	Cornering int `json:"cornering"`
	Tyre      int `json:"tyre"`
	Response  int `json:"response"`
}

// Review is a public review row.
type Review struct {
	Author    string     `json:"author"`
	Stars     int        `json:"stars"`
	Perf      ReviewPerf `json:"perf"`
	Body      string     `json:"body"`
	CreatedAt string     `json:"createdAt"`
}

// CreateReviewRequest is the POST body. The listing is taken from the path.
type CreateReviewRequest struct {
	Stars int        `json:"stars"`
	Perf  ReviewPerf `json:"perf"`
	Body  string     `json:"body"`
}

func validPerfAxis(v int) bool { return v >= 0 && v <= 100 }

// validateReview checks and normalizes a review request.
func (r *CreateReviewRequest) validate() error {
	if r.Stars < 1 || r.Stars > 5 {
		return ErrBadUpload
	}
	if !validPerfAxis(r.Perf.Downforce) || !validPerfAxis(r.Perf.TopSpeed) ||
		!validPerfAxis(r.Perf.Cornering) || !validPerfAxis(r.Perf.Tyre) || !validPerfAxis(r.Perf.Response) {
		return ErrBadUpload
	}
	r.Body = strings.TrimSpace(r.Body)
	if len([]rune(r.Body)) > maxReviewLen || hasControlCharAllowNewline(r.Body) {
		return ErrBadUpload
	}
	return nil
}

// CreateReview records a review, gated to a settled buyer of the listing. Returns
// ErrForbidden if the author has no settled purchase, ErrConflict if they already
// reviewed it, ErrBadUpload on invalid input.
func (s *Store) CreateReview(ctx context.Context, authorID, listingID string, req CreateReviewRequest) error {
	if err := req.validate(); err != nil {
		return err
	}
	// Proof-of-purchase: only a settled buyer may review.
	var ok bool
	if err := s.pool.QueryRow(ctx, `
		SELECT EXISTS(SELECT 1 FROM platform.purchases
		              WHERE buyer_id = $1 AND listing_id = $2 AND state = 'settled')`,
		authorID, listingID,
	).Scan(&ok); err != nil {
		return fmt.Errorf("platformsvc: review purchase check: %w", err)
	}
	if !ok {
		return ErrForbidden
	}
	perf, _ := json.Marshal(req.Perf) // fixed struct never fails to marshal
	_, err := s.pool.Exec(ctx, `
		INSERT INTO platform.reviews (listing_id, author_id, stars, perf, body)
		VALUES ($1, $2, $3, $4, $5)`,
		listingID, authorID, req.Stars, string(perf), req.Body,
	)
	if isUniqueViolation(err) {
		return ErrConflict // one review per (listing, author)
	}
	if err != nil {
		return fmt.Errorf("platformsvc: insert review: %w", err)
	}
	return nil
}

// ListReviews returns a listing's reviews, newest first (public). Author is the
// reviewer's persona; a banned reviewer's review is hidden. The target listing
// is gated to active + non-banned seller (else ErrNotFound), the same uniform
// masking GetListing/SimilarListings use — a delisted/banned/missing listing must
// not leak its reviews or its existence.
func (s *Store) ListReviews(ctx context.Context, listingID string) ([]Review, error) {
	var visible int
	err := s.pool.QueryRow(ctx, `
		SELECT 1 FROM platform.listings l
		WHERE l.id = $1 AND l.status = 'active'
		  AND NOT EXISTS (SELECT 1 FROM platform.account_bans b WHERE b.account_id = l.seller_id)`,
		listingID,
	).Scan(&visible)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("platformsvc: review target: %w", err)
	}
	rows, err := s.pool.Query(ctx, `
		SELECT a.persona, r.stars, r.perf, r.body, r.created_at
		FROM platform.reviews r
		JOIN platform.accounts a ON a.id = r.author_id
		WHERE r.listing_id = $1
		  AND NOT EXISTS (SELECT 1 FROM platform.account_bans b WHERE b.account_id = r.author_id)
		ORDER BY r.created_at DESC
		LIMIT $2`,
		listingID, browseLimit,
	)
	if err != nil {
		return nil, fmt.Errorf("platformsvc: list reviews: %w", err)
	}
	defer rows.Close()
	out := []Review{}
	for rows.Next() {
		var rv Review
		var perf []byte
		var created time.Time
		if err := rows.Scan(&rv.Author, &rv.Stars, &perf, &rv.Body, &created); err != nil {
			return nil, fmt.Errorf("platformsvc: scan review: %w", err)
		}
		if err := json.Unmarshal(perf, &rv.Perf); err != nil {
			return nil, fmt.Errorf("platformsvc: decode perf: %w", err)
		}
		rv.CreatedAt = created.Format(time.RFC3339)
		out = append(out, rv)
	}
	return out, rows.Err()
}
