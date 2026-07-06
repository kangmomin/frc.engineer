package platformsvc

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
)

// buyerAccount returns a funded buyer (signup grant applied via first wallet read).
func buyerAccount(t *testing.T, store *Store, steam string) (string, int64) {
	t.Helper()
	id, _ := store.UpsertSteamAccount(context.Background(), steam, "Buyer", "")
	bal, err := store.GetWallet(context.Background(), id)
	if err != nil {
		t.Fatalf("GetWallet: %v", err)
	}
	return id, bal
}

// sellerListing creates a seller with a plausible setup race and an active listing.
func sellerListing(t *testing.T, store *Store, steam, source string, price int64) (sellerID, listingID string) {
	t.Helper()
	sellerID, _ = store.UpsertSteamAccount(context.Background(), steam, "Seller", "")
	ingestWithSetup(t, store, sellerID, source, 99, setupFixture(), vlap(1, 88000))
	listingID = mustList(t, store, sellerID, KindSetup, source, price)
	return
}

func ledgerGlobalSum(t *testing.T, store *Store) int64 {
	t.Helper()
	var sum int64
	if err := store.pool.QueryRow(context.Background(),
		`SELECT COALESCE(SUM(amount),0) FROM platform.ledger_entries`).Scan(&sum); err != nil {
		t.Fatalf("global sum: %v", err)
	}
	return sum
}

func assertPerTxnBalanced(t *testing.T, store *Store) {
	t.Helper()
	var bad int
	if err := store.pool.QueryRow(context.Background(), `
		SELECT count(*) FROM (
		    SELECT transaction_id FROM platform.ledger_entries
		    GROUP BY transaction_id HAVING SUM(amount) <> 0) x`).Scan(&bad); err != nil {
		t.Fatalf("per-txn sum: %v", err)
	}
	if bad != 0 {
		t.Fatalf("%d ledger transactions are unbalanced (SUM<>0)", bad)
	}
}

func walletBalance(t *testing.T, store *Store, accountID string) int64 {
	t.Helper()
	var b int64
	if err := store.pool.QueryRow(context.Background(),
		`SELECT COALESCE((SELECT balance FROM platform.wallets WHERE account_id=$1),0)`, accountID).Scan(&b); err != nil {
		t.Fatalf("balance: %v", err)
	}
	return b
}

func TestSignupGrantOnceZeroSum(t *testing.T) {
	store := testStore(t)
	id, bal := buyerAccount(t, store, steamA)
	if bal != signupGrant {
		t.Fatalf("first-read balance = %d, want %d", bal, signupGrant)
	}
	// Idempotent: a second read must not double-grant.
	again, _ := store.GetWallet(context.Background(), id)
	if again != signupGrant {
		t.Fatalf("second-read balance = %d, want %d (no double grant)", again, signupGrant)
	}
	if s := ledgerGlobalSum(t, store); s != 0 {
		t.Fatalf("global ledger sum = %d, want 0 (zero-sum)", s)
	}
	assertPerTxnBalanced(t, store)
}

func TestPurchaseSettlesThreeWay(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	buyer, _ := buyerAccount(t, store, steamA)
	seller, listing := sellerListing(t, store, steamB, "s1", 1000)

	res, err := store.Purchase(ctx, buyer, listing)
	if err != nil {
		t.Fatalf("Purchase: %v", err)
	}
	if res.AlreadyOwned || res.Price != 1000 || res.Fee != 150 { // floor(1000*15/100)
		t.Fatalf("result = %+v, want price 1000 fee 150", res)
	}
	if !strings.Contains(string(res.Payload), "frontWing") {
		t.Fatalf("payload not unlocked: %s", res.Payload)
	}
	if b := walletBalance(t, store, buyer); b != signupGrant-1000 {
		t.Fatalf("buyer balance = %d, want %d", b, signupGrant-1000)
	}
	if s := walletBalance(t, store, seller); s != 850 {
		t.Fatalf("seller balance = %d, want 850 (price-fee)", s)
	}
	if sum := ledgerGlobalSum(t, store); sum != 0 {
		t.Fatalf("global ledger sum = %d, want 0", sum)
	}
	assertPerTxnBalanced(t, store)
	// fee_sink accrued the fee (system account, no wallet row).
	var feeSinkTotal int64
	_ = store.pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(le.amount),0) FROM platform.ledger_entries le
		JOIN platform.accounts a ON a.id = le.account_id WHERE a.kind='fee_sink'`).Scan(&feeSinkTotal)
	if feeSinkTotal != 150 {
		t.Fatalf("fee_sink total = %d, want 150", feeSinkTotal)
	}
}

func TestPurchaseSelfForbidden(t *testing.T) {
	store := testStore(t)
	seller, listing := sellerListing(t, store, steamA, "s1", 100)
	// The seller reads their wallet (grant) then tries to buy their own listing.
	_, _ = store.GetWallet(context.Background(), seller)
	if _, err := store.Purchase(context.Background(), seller, listing); !errors.Is(err, ErrForbidden) {
		t.Fatalf("self-purchase err = %v, want ErrForbidden", err)
	}
}

func TestPurchaseInsufficient(t *testing.T) {
	store := testStore(t)
	buyer, _ := buyerAccount(t, store, steamA)
	_, listing := sellerListing(t, store, steamB, "s1", 1_000_000) // > signup grant
	if _, err := store.Purchase(context.Background(), buyer, listing); !errors.Is(err, ErrInsufficient) {
		t.Fatalf("insufficient err = %v, want ErrInsufficient", err)
	}
	// No partial charge.
	if b := walletBalance(t, store, buyer); b != signupGrant {
		t.Fatalf("buyer charged on failed purchase: balance = %d", b)
	}
	if s := ledgerGlobalSum(t, store); s != 0 {
		t.Fatalf("global sum = %d, want 0", s)
	}
}

func TestPurchaseIdempotent(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	buyer, _ := buyerAccount(t, store, steamA)
	_, listing := sellerListing(t, store, steamB, "s1", 300)

	first, err := store.Purchase(ctx, buyer, listing)
	if err != nil {
		t.Fatalf("first purchase: %v", err)
	}
	second, err := store.Purchase(ctx, buyer, listing)
	if err != nil {
		t.Fatalf("second purchase: %v", err)
	}
	if !second.AlreadyOwned || second.PurchaseID != first.PurchaseID {
		t.Fatalf("re-purchase not idempotent: first=%+v second=%+v", first, second)
	}
	if b := walletBalance(t, store, buyer); b != signupGrant-300 {
		t.Fatalf("buyer double-charged: balance = %d, want %d", b, signupGrant-300)
	}
	var n int
	_ = store.pool.QueryRow(ctx, `SELECT count(*) FROM platform.purchases WHERE buyer_id=$1`, buyer).Scan(&n)
	if n != 1 {
		t.Fatalf("purchase rows = %d, want 1", n)
	}
}

func TestPurchaseDelistedOrBannedNotFound(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	buyer, _ := buyerAccount(t, store, steamA)
	seller, listing := sellerListing(t, store, steamB, "s1", 100)
	if err := store.Delist(ctx, seller, listing); err != nil {
		t.Fatalf("delist: %v", err)
	}
	if _, err := store.Purchase(ctx, buyer, listing); !errors.Is(err, ErrNotFound) {
		t.Fatalf("delisted purchase err = %v, want ErrNotFound", err)
	}
}

// TestConcurrentPurchaseNoDoubleSpend fires two concurrent purchases of DIFFERENT
// listings from one buyer who can only afford one. The buyer wallet row lock
// serializes them and CHECK(balance>=0) backstops: exactly one settles.
func TestConcurrentPurchaseNoDoubleSpend(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	buyer, _ := buyerAccount(t, store, steamA) // 1000
	_, l1 := sellerListing(t, store, steamB, "s1", 1000)
	_, l2 := sellerListing(t, store, steamC, "s2", 1000)

	var wg sync.WaitGroup
	var mu sync.Mutex
	var settled, insufficient, other int
	for _, l := range []string{l1, l2} {
		wg.Add(1)
		go func(listing string) {
			defer wg.Done()
			_, err := store.Purchase(ctx, buyer, listing)
			mu.Lock()
			defer mu.Unlock()
			switch {
			case err == nil:
				settled++
			case errors.Is(err, ErrInsufficient):
				insufficient++
			default:
				other++
			}
		}(l)
	}
	wg.Wait()
	if settled != 1 || insufficient != 1 || other != 0 {
		t.Fatalf("concurrent purchases: settled=%d insufficient=%d other=%d, want 1/1/0", settled, insufficient, other)
	}
	if b := walletBalance(t, store, buyer); b != 0 {
		t.Fatalf("buyer balance = %d, want 0 (exactly one charge)", b)
	}
	if s := ledgerGlobalSum(t, store); s != 0 {
		t.Fatalf("global sum = %d, want 0", s)
	}
	assertPerTxnBalanced(t, store)
}

// TestConcurrentSameListingIdempotent fires many concurrent purchases of the SAME
// listing from one buyer; exactly one charge occurs.
func TestConcurrentSameListingIdempotent(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	buyer, _ := buyerAccount(t, store, steamA)
	_, listing := sellerListing(t, store, steamB, "s1", 300)

	var wg sync.WaitGroup
	errs := make([]error, 6)
	for i := range errs {
		wg.Add(1)
		go func(i int) { defer wg.Done(); _, errs[i] = store.Purchase(ctx, buyer, listing) }(i)
	}
	wg.Wait()
	for i, e := range errs {
		if e != nil && !errors.Is(e, ErrConflict) {
			t.Fatalf("purchase %d unexpected err: %v", i, e)
		}
	}
	var n int
	_ = store.pool.QueryRow(ctx, `SELECT count(*) FROM platform.purchases WHERE buyer_id=$1 AND listing_id=$2`, buyer, listing).Scan(&n)
	if n != 1 {
		t.Fatalf("purchase rows = %d, want exactly 1", n)
	}
	if b := walletBalance(t, store, buyer); b != signupGrant-300 {
		t.Fatalf("buyer balance = %d, want %d (one charge)", b, signupGrant-300)
	}
	assertPerTxnBalanced(t, store)
}

// TestPurchaseSurvivesDelist (F3): a settled buyer must not lose access to a
// product they paid for when the seller later delists it.
func TestPurchaseSurvivesDelist(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	buyer, _ := buyerAccount(t, store, steamA)
	seller, listing := sellerListing(t, store, steamB, "s1", 200)
	first, err := store.Purchase(ctx, buyer, listing)
	if err != nil {
		t.Fatalf("purchase: %v", err)
	}
	if err := store.Delist(ctx, seller, listing); err != nil {
		t.Fatalf("delist: %v", err)
	}
	// A NEW buyer now sees the listing as gone.
	other, _ := buyerAccount(t, store, steamC)
	if _, err := store.Purchase(ctx, other, listing); !errors.Is(err, ErrNotFound) {
		t.Fatalf("new purchase of delisted err = %v, want ErrNotFound", err)
	}
	// But the original buyer re-unlocks their frozen payload, no second charge.
	again, err := store.Purchase(ctx, buyer, listing)
	if err != nil {
		t.Fatalf("owner re-fetch after delist: %v", err)
	}
	if !again.AlreadyOwned || again.PurchaseID != first.PurchaseID || again.Fee != 30 { // floor(200*15/100)
		t.Fatalf("owner lost paid access: %+v", again)
	}
	if !strings.Contains(string(again.Payload), "frontWing") {
		t.Fatalf("payload not re-unlocked: %s", again.Payload)
	}
	if b := walletBalance(t, store, buyer); b != signupGrant-200 {
		t.Fatalf("buyer re-charged: balance = %d", b)
	}
}

// TestCrossingPurchasesNoDeadlock (F1): A buys B's listing while B buys A's,
// concurrently. Canonical wallet lock ordering means neither deadlocks.
func TestCrossingPurchasesNoDeadlock(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	a, _ := buyerAccount(t, store, steamA)
	b, _ := buyerAccount(t, store, steamB)
	ingestWithSetup(t, store, a, "ra", 99, setupFixture(), vlap(1, 88000))
	ingestWithSetup(t, store, b, "rb", 99, setupFixture(), vlap(1, 88000))
	aListing := mustList(t, store, a, KindSetup, "ra", 300)
	bListing := mustList(t, store, b, KindSetup, "rb", 300)

	var wg sync.WaitGroup
	errs := make([]error, 2)
	wg.Add(2)
	go func() { defer wg.Done(); _, errs[0] = store.Purchase(ctx, a, bListing) }()
	go func() { defer wg.Done(); _, errs[1] = store.Purchase(ctx, b, aListing) }()
	wg.Wait()
	for i, e := range errs {
		if e != nil {
			t.Fatalf("crossing purchase %d failed (deadlock?): %v", i, e)
		}
	}
	// Each: −300 bought, +255 sold (fee floor(300*15/100)=45). 1000-300+255=955.
	if ba := walletBalance(t, store, a); ba != 955 {
		t.Fatalf("A balance = %d, want 955", ba)
	}
	if bb := walletBalance(t, store, b); bb != 955 {
		t.Fatalf("B balance = %d, want 955", bb)
	}
	if s := ledgerGlobalSum(t, store); s != 0 {
		t.Fatalf("global sum = %d, want 0", s)
	}
	assertPerTxnBalanced(t, store)
}

func TestLedgerAppendOnly(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	buyer, _ := buyerAccount(t, store, steamA) // creates grant ledger rows
	_ = buyer
	if _, err := store.pool.Exec(ctx,
		`UPDATE platform.ledger_entries SET amount = 0 WHERE id = (SELECT min(id) FROM platform.ledger_entries)`); err == nil {
		t.Fatal("expected append-only trigger to reject UPDATE")
	}
	if _, err := store.pool.Exec(ctx,
		`DELETE FROM platform.ledger_entries WHERE id = (SELECT min(id) FROM platform.ledger_entries)`); err == nil {
		t.Fatal("expected append-only trigger to reject DELETE")
	}
}

func TestGetLedgerEntries(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	buyer, _ := buyerAccount(t, store, steamA)
	_, listing := sellerListing(t, store, steamB, "s1", 200)
	if _, err := store.Purchase(ctx, buyer, listing); err != nil {
		t.Fatalf("purchase: %v", err)
	}
	entries, err := store.GetLedger(ctx, buyer)
	if err != nil {
		t.Fatalf("GetLedger: %v", err)
	}
	// Grant (+1000) and purchase (-200) from the buyer's perspective.
	if len(entries) != 2 {
		t.Fatalf("buyer ledger = %d entries, want 2", len(entries))
	}
	var sum int64
	for _, e := range entries {
		sum += e.Amount
	}
	if sum != signupGrant-200 {
		t.Fatalf("buyer ledger sum = %d, want %d", sum, signupGrant-200)
	}
}
