package platformsvc

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

// setupFixture is a representative car setup; FrontWing is the sentinel we assert
// never leaks to non-owners.
func setupFixture() *UploadSetup {
	return &UploadSetup{FrontWing: 5, RearWing: 7, BrakeBias: 58, FuelLoad: 10.5}
}

// tlap builds a client-valid lap on a given compound whose sectors sum to lap_ms.
func tlap(n int, ms uint32, tyre string) UploadLap {
	s := ms / 3
	return UploadLap{LapNumber: n, LapMs: ms, S1Ms: s, S2Ms: s, S3Ms: ms - 2*s, Tyre: tyre, Valid: true}
}

// ingestWithSetup ingests a race (optionally with a setup) for the account.
func ingestWithSetup(t *testing.T, store *Store, accountID, source string, trackID int, setup *UploadSetup, laps ...UploadLap) *UploadResult {
	t.Helper()
	res, err := store.IngestRace(context.Background(), accountID, UploadRequest{
		SourceRaceID: source, TrackID: trackID, TrackName: "X",
		SessionType: "Time Trial", GameFormat: "F1 26", Laps: laps, Setup: setup,
	})
	if err != nil {
		t.Fatalf("ingest(%s): %v", source, err)
	}
	return res
}

func TestCreateSetupListingOwnerSeesPayloadNonOwnerMasked(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	seller, _ := store.UpsertSteamAccount(ctx, steamA, "Seller", "")
	buyer, _ := store.UpsertSteamAccount(ctx, steamB, "Buyer", "")
	ingestWithSetup(t, store, seller, "r1", 99, setupFixture(), vlap(1, 88000))

	id, err := store.CreateListing(ctx, seller, CreateListingRequest{
		Kind: KindSetup, SourceRaceID: "r1", Title: "My Bahrain Setup", PriceCredits: 100,
	})
	if err != nil {
		t.Fatalf("CreateListing: %v", err)
	}

	// Owner: payload revealed, contains the product (frontWing).
	card, payload, err := store.GetListing(ctx, id, seller)
	if err != nil {
		t.Fatalf("GetListing(owner): %v", err)
	}
	if payload == nil || !strings.Contains(string(payload), "frontWing") {
		t.Fatalf("owner payload missing product: %s", payload)
	}
	owner := OwnerListing{ListingCard: *card, Owned: true, Payload: payload}
	if ob, _ := json.Marshal(owner); !strings.Contains(string(ob), "frontWing") {
		t.Fatalf("owner JSON should include product: %s", ob)
	}

	// Non-owner: no payload, and the marshaled card leaks nothing sensitive.
	ncard, npayload, err := store.GetListing(ctx, id, buyer)
	if err != nil {
		t.Fatalf("GetListing(non-owner): %v", err)
	}
	if npayload != nil {
		t.Fatal("non-owner must not receive a payload")
	}
	assertNoProductLeak(t, ncard)
}

// assertNoProductLeak marshals a public shape and fails if it contains any
// server-only field: the setup product, content_hash, params_canonical, or a
// payload envelope. This is the type-level masking guarantee, checked at the wire.
func assertNoProductLeak(t *testing.T, v any) {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	s := string(b)
	for _, forbidden := range []string{"frontWing", "contentHash", "content_hash", "paramsCanonical", "params_canonical", "payload"} {
		if strings.Contains(s, forbidden) {
			t.Fatalf("public shape leaked %q: %s", forbidden, s)
		}
	}
}

func TestCreateListingForeignRaceRejected(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	owner, _ := store.UpsertSteamAccount(ctx, steamA, "Owner", "")
	attacker, _ := store.UpsertSteamAccount(ctx, steamB, "Attacker", "")
	ingestWithSetup(t, store, owner, "r1", 99, setupFixture(), vlap(1, 88000))

	// The attacker never ingested "r1"; the account-scoped lookup finds nothing.
	_, err := store.CreateListing(ctx, attacker, CreateListingRequest{
		Kind: KindSetup, SourceRaceID: "r1", Title: "Stolen", PriceCredits: 100,
	})
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("foreign race err = %v, want ErrNotFound", err)
	}
}

func TestCreateListingNonPlausibleRejected(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	seller, _ := store.UpsertSteamAccount(ctx, steamA, "Seller", "")
	// 30s on track 99 (generic 45s floor) → race stored but not plausible.
	ingestWithSetup(t, store, seller, "r1", 99, setupFixture(), vlap(1, 30000))

	_, err := store.CreateListing(ctx, seller, CreateListingRequest{
		Kind: KindSetup, SourceRaceID: "r1", Title: "Slow", PriceCredits: 100,
	})
	if !errors.Is(err, ErrForbidden) {
		t.Fatalf("non-plausible err = %v, want ErrForbidden", err)
	}
}

func TestCreateSetupListingNoSetupForbidden(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	seller, _ := store.UpsertSteamAccount(ctx, steamA, "Seller", "")
	// Plausible race, but no setup captured → nothing to sell as a setup.
	ingestWithSetup(t, store, seller, "r1", 99, nil, vlap(1, 88000))

	_, err := store.CreateListing(ctx, seller, CreateListingRequest{
		Kind: KindSetup, SourceRaceID: "r1", Title: "No Setup", PriceCredits: 100,
	})
	if !errors.Is(err, ErrForbidden) {
		t.Fatalf("no-setup err = %v, want ErrForbidden", err)
	}
}

func TestCreateListingDuplicateConflict(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	seller, _ := store.UpsertSteamAccount(ctx, steamA, "Seller", "")
	ingestWithSetup(t, store, seller, "r1", 99, setupFixture(), vlap(1, 88000))

	if _, err := store.CreateListing(ctx, seller, CreateListingRequest{
		Kind: KindSetup, SourceRaceID: "r1", Title: "First", PriceCredits: 100,
	}); err != nil {
		t.Fatalf("first CreateListing: %v", err)
	}
	_, err := store.CreateListing(ctx, seller, CreateListingRequest{
		Kind: KindSetup, SourceRaceID: "r1", Title: "Second", PriceCredits: 200,
	})
	if !errors.Is(err, ErrConflict) {
		t.Fatalf("duplicate err = %v, want ErrConflict", err)
	}
}

func TestStrategyListingDerivesStints(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	seller, _ := store.UpsertSteamAccount(ctx, steamA, "Seller", "")
	// 3 Soft + 3 Medium = two derived stints, 6 laps ≥ minStrategyLaps.
	ingestWithSetup(t, store, seller, "r1", 99, nil,
		tlap(1, 90000, "Soft"), tlap(2, 90500, "Soft"), tlap(3, 90200, "Soft"),
		tlap(4, 91000, "Medium"), tlap(5, 91200, "Medium"), tlap(6, 91100, "Medium"))

	id, err := store.CreateListing(ctx, seller, CreateListingRequest{
		Kind: KindStrategy, SourceRaceID: "r1", Title: "2-stop", PriceCredits: 50,
	})
	if err != nil {
		t.Fatalf("CreateListing(strategy): %v", err)
	}
	_, payload, err := store.GetListing(ctx, id, seller)
	if err != nil {
		t.Fatalf("GetListing: %v", err)
	}
	var stints []Stint
	if err := json.Unmarshal(payload, &stints); err != nil {
		t.Fatalf("payload not stints: %v (%s)", err, payload)
	}
	if len(stints) != 2 || stints[0].Compound != "Soft" || stints[0].Laps != 3 ||
		stints[1].Compound != "Medium" || stints[1].Laps != 3 {
		t.Fatalf("derived stints = %+v", stints)
	}
}

func TestStrategyListingTooFewLaps(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	seller, _ := store.UpsertSteamAccount(ctx, steamA, "Seller", "")
	ingestWithSetup(t, store, seller, "r1", 99, nil, tlap(1, 90000, "Soft"), tlap(2, 90500, "Soft"))

	_, err := store.CreateListing(ctx, seller, CreateListingRequest{
		Kind: KindStrategy, SourceRaceID: "r1", Title: "Short", PriceCredits: 50,
	})
	if !errors.Is(err, ErrForbidden) {
		t.Fatalf("too-few-laps err = %v, want ErrForbidden", err)
	}
}

func TestBrowseFiltersByTrackAndKind(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	seller, _ := store.UpsertSteamAccount(ctx, steamA, "Seller", "")
	ingestWithSetup(t, store, seller, "r99", 99, setupFixture(), vlap(1, 88000))
	ingestWithSetup(t, store, seller, "r5", 5, setupFixture(), vlap(1, 70000)) // Monaco, 70s valid

	mustList(t, store, seller, KindSetup, "r99", 100)
	mustList(t, store, seller, KindSetup, "r5", 100)

	cards, err := store.BrowseListings(ctx, KindSetup, 99, "F1 26")
	if err != nil {
		t.Fatalf("browse: %v", err)
	}
	if len(cards) != 1 || cards[0].TrackID != 99 {
		t.Fatalf("browse track99 = %+v, want single track-99 card", cards)
	}
	// No strategy listings exist → empty (not nil-panic) result.
	strat, err := store.BrowseListings(ctx, KindStrategy, 99, "F1 26")
	if err != nil || len(strat) != 0 {
		t.Fatalf("browse strategy = %+v (err %v), want empty", strat, err)
	}
	assertNoProductLeak(t, cards)
}

func TestSimilarExcludesTargetCheapestFirst(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	s1, _ := store.UpsertSteamAccount(ctx, steamA, "S1", "")
	s2, _ := store.UpsertSteamAccount(ctx, steamB, "S2", "")
	s3, _ := store.UpsertSteamAccount(ctx, steamC, "S3", "")
	ingestWithSetup(t, store, s1, "r1", 99, setupFixture(), vlap(1, 88000))
	ingestWithSetup(t, store, s2, "r2", 99, setupFixture(), vlap(1, 88000))
	ingestWithSetup(t, store, s3, "r3", 99, setupFixture(), vlap(1, 88000))
	target := mustList(t, store, s1, KindSetup, "r1", 300)
	mustList(t, store, s2, KindSetup, "r2", 100)
	mustList(t, store, s3, KindSetup, "r3", 200)

	rows, err := store.SimilarListings(ctx, target)
	if err != nil {
		t.Fatalf("similar: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("similar rows = %d, want 2 (target excluded)", len(rows))
	}
	if rows[0].PriceCredits != 100 || rows[1].PriceCredits != 200 {
		t.Fatalf("similar not cheapest-first: %+v", rows)
	}
	assertNoProductLeak(t, rows)
}

func TestDelistMasksFromNonOwner(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	seller, _ := store.UpsertSteamAccount(ctx, steamA, "Seller", "")
	other, _ := store.UpsertSteamAccount(ctx, steamB, "Other", "")
	ingestWithSetup(t, store, seller, "r1", 99, setupFixture(), vlap(1, 88000))
	id := mustList(t, store, seller, KindSetup, "r1", 100)

	if err := store.Delist(ctx, seller, id); err != nil {
		t.Fatalf("delist: %v", err)
	}
	// Non-owner: masked as missing (uniform 404 with a truly-absent id).
	if _, _, err := store.GetListing(ctx, id, other); !errors.Is(err, ErrNotFound) {
		t.Fatalf("delisted GetListing(non-owner) err = %v, want ErrNotFound", err)
	}
	// Gone from browse.
	if cards, _ := store.BrowseListings(ctx, KindSetup, 99, "F1 26"); len(cards) != 0 {
		t.Fatalf("delisted still browsable: %+v", cards)
	}
	// Similar must 404 uniformly with GetListing — no delisted-vs-missing oracle.
	if _, err := store.SimilarListings(ctx, id); !errors.Is(err, ErrNotFound) {
		t.Fatalf("delisted SimilarListings err = %v, want ErrNotFound (uniform 404)", err)
	}
	// Delisting again is a no-op → ErrNotFound.
	if err := store.Delist(ctx, seller, id); !errors.Is(err, ErrNotFound) {
		t.Fatalf("second delist err = %v, want ErrNotFound", err)
	}
	// Relist is allowed after delist (partial unique only over active rows).
	if _, err := store.CreateListing(ctx, seller, CreateListingRequest{
		Kind: KindSetup, SourceRaceID: "r1", Title: "Relisted", PriceCredits: 120,
	}); err != nil {
		t.Fatalf("relist after delist: %v", err)
	}
}

func TestGetListingMissing(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	_, _, err := store.GetListing(ctx, "11111111-1111-1111-1111-111111111111", "")
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing GetListing err = %v, want ErrNotFound", err)
	}
}

func TestBannedSellerListingHiddenFromBrowse(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	seller, _ := store.UpsertSteamAccount(ctx, steamA, "Seller", "")
	ingestWithSetup(t, store, seller, "r1", 99, setupFixture(), vlap(1, 88000))
	id := mustList(t, store, seller, KindSetup, "r1", 100)

	if _, err := store.pool.Exec(ctx,
		`INSERT INTO platform.account_bans (account_id, reason) VALUES ($1,'poison')`, seller); err != nil {
		t.Fatalf("ban: %v", err)
	}
	if cards, _ := store.BrowseListings(ctx, KindSetup, 99, "F1 26"); len(cards) != 0 {
		t.Fatalf("banned seller listing leaked to browse: %+v", cards)
	}
	// Non-owner detail is masked-as-missing too.
	other, _ := store.UpsertSteamAccount(ctx, steamB, "Other", "")
	if _, _, err := store.GetListing(ctx, id, other); !errors.Is(err, ErrNotFound) {
		t.Fatalf("banned seller listing detail err = %v, want ErrNotFound", err)
	}
	// Similar for a banned seller's target also 404s uniformly.
	if _, err := store.SimilarListings(ctx, id); !errors.Is(err, ErrNotFound) {
		t.Fatalf("banned seller SimilarListings err = %v, want ErrNotFound (uniform 404)", err)
	}
}

func TestListMyRacesOwnPlausibleOnly(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	me, _ := store.UpsertSteamAccount(ctx, steamA, "Me", "")
	other, _ := store.UpsertSteamAccount(ctx, steamB, "Other", "")
	// Mine: one plausible with setup (1 lap), one plausible strategy-length (6 laps, no setup),
	// one implausible (excluded).
	ingestWithSetup(t, store, me, "s1", 99, setupFixture(), vlap(1, 88000))
	ingestWithSetup(t, store, me, "s2", 99, nil,
		tlap(1, 90000, "Soft"), tlap(2, 90100, "Soft"), tlap(3, 90200, "Soft"),
		tlap(4, 91000, "Medium"), tlap(5, 91100, "Medium"), tlap(6, 91200, "Medium"))
	ingestWithSetup(t, store, me, "s3", 99, setupFixture(), vlap(1, 30000)) // out-of-bounds → not plausible
	ingestWithSetup(t, store, other, "o1", 99, setupFixture(), vlap(1, 88000))

	races, err := store.ListMyRaces(ctx, me)
	if err != nil {
		t.Fatalf("ListMyRaces: %v", err)
	}
	if len(races) != 2 {
		t.Fatalf("my races = %d, want 2 (plausible only, no foreign)", len(races))
	}
	by := map[string]SellableRace{}
	for _, r := range races {
		by[r.SourceRaceID] = r
	}
	if s1, ok := by["s1"]; !ok || !s1.HasSetup || s1.LapCount != 1 || s1.BestLapMS == nil || *s1.BestLapMS != 88000 {
		t.Fatalf("s1 = %+v, want hasSetup, 1 lap, best 88000", by["s1"])
	}
	if s2, ok := by["s2"]; !ok || s2.HasSetup || s2.LapCount != 6 {
		t.Fatalf("s2 = %+v, want no setup, 6 laps", by["s2"])
	}
	if _, ok := by["s3"]; ok {
		t.Fatal("implausible race must not be sellable")
	}
	if _, ok := by["o1"]; ok {
		t.Fatal("another account's race leaked into ListMyRaces")
	}
}

func TestListMyListingsOwnBothStatuses(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	me, _ := store.UpsertSteamAccount(ctx, steamA, "Me", "")
	other, _ := store.UpsertSteamAccount(ctx, steamB, "Other", "")
	ingestWithSetup(t, store, me, "s1", 99, setupFixture(), vlap(1, 88000))
	ingestWithSetup(t, store, me, "s2", 5, setupFixture(), vlap(1, 70000))
	ingestWithSetup(t, store, other, "o1", 99, setupFixture(), vlap(1, 88000))
	id1 := mustList(t, store, me, KindSetup, "s1", 100)
	mustList(t, store, me, KindSetup, "s2", 200)
	mustList(t, store, other, KindSetup, "o1", 300)
	if err := store.Delist(ctx, me, id1); err != nil {
		t.Fatalf("delist: %v", err)
	}

	mine, err := store.ListMyListings(ctx, me)
	if err != nil {
		t.Fatalf("ListMyListings: %v", err)
	}
	if len(mine) != 2 {
		t.Fatalf("my listings = %d, want 2 (own, both statuses, no foreign)", len(mine))
	}
	var active, delisted int
	for _, c := range mine {
		switch c.Status {
		case "active":
			active++
		case "delisted":
			delisted++
		}
	}
	if active != 1 || delisted != 1 {
		t.Fatalf("statuses active=%d delisted=%d, want 1/1", active, delisted)
	}
	assertNoProductLeak(t, mine)
}

func mustList(t *testing.T, store *Store, sellerID, kind, source string, price int64) string {
	t.Helper()
	id, err := store.CreateListing(context.Background(), sellerID, CreateListingRequest{
		Kind: kind, SourceRaceID: source, Title: "L-" + source, PriceCredits: price,
	})
	if err != nil {
		t.Fatalf("CreateListing(%s): %v", source, err)
	}
	return id
}
