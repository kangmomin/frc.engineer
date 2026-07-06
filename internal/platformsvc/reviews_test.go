package platformsvc

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func goodPerf() ReviewPerf {
	return ReviewPerf{Downforce: 80, TopSpeed: 60, Cornering: 90, Tyre: 70, Response: 65}
}

func TestReviewRequiresSettledPurchase(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	buyer, _ := buyerAccount(t, store, steamA)
	_, listing := sellerListing(t, store, steamB, "s1", 100)

	// No purchase yet → forbidden.
	if err := store.CreateReview(ctx, buyer, listing, CreateReviewRequest{Stars: 5, Perf: goodPerf(), Body: "nice"}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("pre-purchase review err = %v, want ErrForbidden", err)
	}
	// After purchase → allowed.
	if _, err := store.Purchase(ctx, buyer, listing); err != nil {
		t.Fatalf("purchase: %v", err)
	}
	if err := store.CreateReview(ctx, buyer, listing, CreateReviewRequest{Stars: 5, Perf: goodPerf(), Body: "great setup"}); err != nil {
		t.Fatalf("post-purchase review: %v", err)
	}
	// Duplicate → conflict.
	if err := store.CreateReview(ctx, buyer, listing, CreateReviewRequest{Stars: 4, Perf: goodPerf(), Body: "again"}); !errors.Is(err, ErrConflict) {
		t.Fatalf("duplicate review err = %v, want ErrConflict", err)
	}

	reviews, err := store.ListReviews(ctx, listing)
	if err != nil {
		t.Fatalf("ListReviews: %v", err)
	}
	if len(reviews) != 1 || reviews[0].Stars != 5 || reviews[0].Perf.Cornering != 90 || reviews[0].Body != "great setup" {
		t.Fatalf("reviews = %+v", reviews)
	}
}

func TestReviewInputValidation(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	buyer, _ := buyerAccount(t, store, steamA)
	_, listing := sellerListing(t, store, steamB, "s1", 100)
	if _, err := store.Purchase(ctx, buyer, listing); err != nil {
		t.Fatalf("purchase: %v", err)
	}
	bad := []CreateReviewRequest{
		{Stars: 0, Perf: goodPerf()},
		{Stars: 6, Perf: goodPerf()},
		{Stars: 3, Perf: ReviewPerf{Downforce: 101}},
		{Stars: 3, Perf: ReviewPerf{TopSpeed: -1}},
		{Stars: 3, Perf: goodPerf(), Body: strings.Repeat("x", maxReviewLen+1)},
	}
	for i, req := range bad {
		if err := store.CreateReview(ctx, buyer, listing, req); !errors.Is(err, ErrBadUpload) {
			t.Fatalf("bad review %d err = %v, want ErrBadUpload", i, err)
		}
	}
}

// TestReviewBodyAllowsNewlines: the review UI is a multi-line textarea, so line
// breaks must pass validation (they are stored/rendered as text); other control
// chars are still rejected.
func TestReviewBodyAllowsNewlines(t *testing.T) {
	ok := CreateReviewRequest{Stars: 5, Perf: goodPerf(), Body: "great high-speed balance\nbit loose in slow corners"}
	if err := ok.validate(); err != nil {
		t.Fatalf("multi-line review body rejected: %v", err)
	}
	bad := CreateReviewRequest{Stars: 5, Perf: goodPerf(), Body: "nul\x00byte"}
	if err := bad.validate(); !errors.Is(err, ErrBadUpload) {
		t.Fatalf("control-char body err = %v, want ErrBadUpload", err)
	}
}

// TestListReviewsMaskedOnDelist (F2): the public reviews endpoint honors the same
// uniform-404 masking as GetListing/SimilarListings — a delisted listing's reviews
// (and its existence) must not leak.
func TestListReviewsMaskedOnDelist(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	buyer, _ := buyerAccount(t, store, steamA)
	seller, listing := sellerListing(t, store, steamB, "s1", 100)
	if _, err := store.Purchase(ctx, buyer, listing); err != nil {
		t.Fatalf("purchase: %v", err)
	}
	if err := store.CreateReview(ctx, buyer, listing, CreateReviewRequest{Stars: 5, Perf: goodPerf(), Body: "ok"}); err != nil {
		t.Fatalf("review: %v", err)
	}
	if rv, err := store.ListReviews(ctx, listing); err != nil || len(rv) != 1 {
		t.Fatalf("active ListReviews = %+v (err %v), want 1", rv, err)
	}
	if err := store.Delist(ctx, seller, listing); err != nil {
		t.Fatalf("delist: %v", err)
	}
	if _, err := store.ListReviews(ctx, listing); !errors.Is(err, ErrNotFound) {
		t.Fatalf("delisted ListReviews err = %v, want ErrNotFound (uniform mask)", err)
	}
}

func TestReviewHidesBannedAuthor(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	buyer, _ := buyerAccount(t, store, steamA)
	_, listing := sellerListing(t, store, steamB, "s1", 100)
	if _, err := store.Purchase(ctx, buyer, listing); err != nil {
		t.Fatalf("purchase: %v", err)
	}
	if err := store.CreateReview(ctx, buyer, listing, CreateReviewRequest{Stars: 5, Perf: goodPerf(), Body: "ok"}); err != nil {
		t.Fatalf("review: %v", err)
	}
	if _, err := store.pool.Exec(ctx, `INSERT INTO platform.account_bans (account_id, reason) VALUES ($1,'spam')`, buyer); err != nil {
		t.Fatalf("ban: %v", err)
	}
	reviews, _ := store.ListReviews(ctx, listing)
	if len(reviews) != 0 {
		t.Fatalf("banned author review leaked: %+v", reviews)
	}
}
