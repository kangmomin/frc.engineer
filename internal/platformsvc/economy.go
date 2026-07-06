package platformsvc

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// Economy constants. Credits are virtual and have no cash value.
const (
	signupGrant  = 1000 // one-time welcome grant, treasury → user
	feePercent   = 15   // marketplace fee, floor(price*15/100), routed to fee_sink
	ledgerLimit  = 200
	maxReviewLen = 500
)

// ErrInsufficient: the buyer's wallet balance is below the listing price.
var ErrInsufficient = errors.New("platformsvc: insufficient balance")

// LedgerEntry is one append-only double-entry row from the caller's perspective.
type LedgerEntry struct {
	Kind      string `json:"kind"`   // grant | purchase | sale | fee | sink_unlock
	Amount    int64  `json:"amount"` // signed
	Ref       string `json:"ref"`
	CreatedAt string `json:"createdAt"`
}

// PurchaseResult unlocks the product for the buyer. AlreadyOwned is true when the
// call was idempotent (a prior settled purchase existed) — no second charge.
type PurchaseResult struct {
	PurchaseID   string          `json:"purchaseId"`
	Kind         string          `json:"kind"`
	Price        int64           `json:"price"`
	Fee          int64           `json:"fee"`
	Payload      json.RawMessage `json:"payload"`
	AlreadyOwned bool            `json:"alreadyOwned"`
}

// systemAccountID resolves the singleton treasury/fee_sink account id.
func systemAccountID(ctx context.Context, q pgx.Tx, kind string) (string, error) {
	var id string
	if err := q.QueryRow(ctx, `SELECT id FROM platform.accounts WHERE kind = $1`, kind).Scan(&id); err != nil {
		return "", fmt.Errorf("platformsvc: system account %s: %w", kind, err)
	}
	return id, nil
}

// grantIfNew ensures the account's wallet exists, locks it FOR UPDATE (which both
// serializes concurrent grants and holds the row for a following debit), and, if
// the account has never been granted, credits the one-time signup grant as a
// zero-sum transaction (treasury −G / user +G). The FOR UPDATE lock is the sole
// serialization point, so two concurrent callers can never double-grant.
func grantIfNew(ctx context.Context, tx pgx.Tx, accountID string) error {
	if _, err := tx.Exec(ctx,
		`INSERT INTO platform.wallets (account_id) VALUES ($1) ON CONFLICT DO NOTHING`, accountID); err != nil {
		return fmt.Errorf("platformsvc: ensure wallet: %w", err)
	}
	var balance int64
	if err := tx.QueryRow(ctx,
		`SELECT balance FROM platform.wallets WHERE account_id = $1 FOR UPDATE`, accountID).Scan(&balance); err != nil {
		return fmt.Errorf("platformsvc: lock wallet: %w", err)
	}
	var granted bool
	if err := tx.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM platform.ledger_entries WHERE account_id = $1 AND kind = 'grant')`,
		accountID).Scan(&granted); err != nil {
		return fmt.Errorf("platformsvc: grant check: %w", err)
	}
	if granted {
		return nil
	}
	treasury, err := systemAccountID(ctx, tx, "treasury")
	if err != nil {
		return err
	}
	var txnID string
	if err := tx.QueryRow(ctx, `SELECT gen_random_uuid()`).Scan(&txnID); err != nil {
		return fmt.Errorf("platformsvc: txn id: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO platform.ledger_entries (transaction_id, account_id, kind, amount, ref) VALUES
		    ($1, $2, 'grant', $3, 'signup'),
		    ($1, $4, 'grant', $5, 'signup')`,
		txnID, treasury, int64(-signupGrant), accountID, int64(signupGrant)); err != nil {
		return fmt.Errorf("platformsvc: grant ledger: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`UPDATE platform.wallets SET balance = balance + $2, updated_at = now() WHERE account_id = $1`,
		accountID, int64(signupGrant)); err != nil {
		return fmt.Errorf("platformsvc: grant credit: %w", err)
	}
	return nil
}

// GetWallet returns the caller's balance, lazily provisioning the one-time signup
// grant on first read so a new account is funded before its first purchase.
func (s *Store) GetWallet(ctx context.Context, accountID string) (int64, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, fmt.Errorf("platformsvc: wallet begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // no-op after Commit
	if err := grantIfNew(ctx, tx, accountID); err != nil {
		return 0, err
	}
	var balance int64
	if err := tx.QueryRow(ctx,
		`SELECT balance FROM platform.wallets WHERE account_id = $1`, accountID).Scan(&balance); err != nil {
		return 0, fmt.Errorf("platformsvc: read balance: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, fmt.Errorf("platformsvc: wallet commit: %w", err)
	}
	return balance, nil
}

// GetLedger returns the caller's own ledger rows, newest first.
func (s *Store) GetLedger(ctx context.Context, accountID string) ([]LedgerEntry, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT kind, amount, ref, created_at
		FROM platform.ledger_entries WHERE account_id = $1
		ORDER BY id DESC LIMIT $2`,
		accountID, ledgerLimit,
	)
	if err != nil {
		return nil, fmt.Errorf("platformsvc: ledger: %w", err)
	}
	defer rows.Close()
	out := []LedgerEntry{}
	for rows.Next() {
		var e LedgerEntry
		var created time.Time
		if err := rows.Scan(&e.Kind, &e.Amount, &e.Ref, &created); err != nil {
			return nil, fmt.Errorf("platformsvc: scan ledger: %w", err)
		}
		e.CreatedAt = created.Format(time.RFC3339)
		out = append(out, e)
	}
	return out, rows.Err()
}

// Purchase settles a listing immediately in one atomic transaction:
//
//	buyer −price / seller +(price−fee) / fee_sink +fee   (SUM = 0)
//
// with fee = floor(price*15/100). Both wallets are locked FOR UPDATE in
// account_id order (so two crossing purchases can never deadlock), and
// CHECK(balance>=0) backstops any race — no double-spend. It is idempotent: a
// prior settled purchase re-unlocks the frozen payload with no second charge —
// and that check runs BEFORE the listing-status gate, so a buyer never loses
// access to a product they paid for if the seller later delists or is banned.
// For a NEW purchase, a delisted listing / banned seller is ErrNotFound (uniform
// with a missing id); self-purchase is ErrForbidden.
func (s *Store) Purchase(ctx context.Context, buyerID, listingID string) (*PurchaseResult, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("platformsvc: purchase begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // no-op after Commit

	// Ownership FIRST: a settled buyer always re-unlocks their frozen snapshot,
	// even after the listing was delisted or the seller banned. Price/fee come
	// from the immutable purchase row, not the (mutable) listing.
	var existingID, existingSnap, existingKind string
	var existingPrice, existingFee int64
	err = tx.QueryRow(ctx, `
		SELECT id, snapshot_id, kind, price, fee FROM platform.purchases
		WHERE buyer_id = $1 AND listing_id = $2 AND state <> 'refunded'`,
		buyerID, listingID,
	).Scan(&existingID, &existingSnap, &existingKind, &existingPrice, &existingFee)
	if err == nil {
		payload, perr := snapshotPayload(ctx, tx, existingSnap)
		if perr != nil {
			return nil, perr
		}
		if cerr := tx.Commit(ctx); cerr != nil {
			return nil, fmt.Errorf("platformsvc: purchase commit: %w", cerr)
		}
		return &PurchaseResult{PurchaseID: existingID, Kind: existingKind, Price: existingPrice, Fee: existingFee, Payload: payload, AlreadyOwned: true}, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("platformsvc: existing purchase: %w", err)
	}

	// New purchase: resolve a purchasable listing (active + non-banned seller).
	var sellerID, kind, snapshotID string
	var price int64
	err = tx.QueryRow(ctx, `
		SELECT l.seller_id, l.kind, l.snapshot_id, l.price_credits
		FROM platform.listings l
		WHERE l.id = $1 AND l.status = 'active'
		  AND NOT EXISTS (SELECT 1 FROM platform.account_bans b WHERE b.account_id = l.seller_id)`,
		listingID,
	).Scan(&sellerID, &kind, &snapshotID, &price)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("platformsvc: resolve listing: %w", err)
	}
	if buyerID == sellerID {
		return nil, ErrForbidden // no self-purchase
	}

	// Ensure both wallets exist, then lock them in canonical (account_id) order so
	// two crossing purchases (A buys B while B buys A) acquire locks in the same
	// order and cannot deadlock.
	lo, hi := buyerID, sellerID
	if lo > hi {
		lo, hi = hi, lo
	}
	for _, id := range []string{lo, hi} {
		if _, err := tx.Exec(ctx,
			`INSERT INTO platform.wallets (account_id) VALUES ($1) ON CONFLICT DO NOTHING`, id); err != nil {
			return nil, fmt.Errorf("platformsvc: ensure wallet: %w", err)
		}
	}
	if _, err := tx.Exec(ctx,
		`SELECT 1 FROM platform.wallets WHERE account_id = $1 FOR UPDATE`, lo); err != nil {
		return nil, fmt.Errorf("platformsvc: lock wallet lo: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`SELECT 1 FROM platform.wallets WHERE account_id = $1 FOR UPDATE`, hi); err != nil {
		return nil, fmt.Errorf("platformsvc: lock wallet hi: %w", err)
	}

	// Fund the buyer (idempotent one-time grant); the buyer wallet is already
	// locked above, so grantIfNew's re-lock is a no-op in this tx.
	if err := grantIfNew(ctx, tx, buyerID); err != nil {
		return nil, err
	}

	var balance int64
	if err := tx.QueryRow(ctx,
		`SELECT balance FROM platform.wallets WHERE account_id = $1`, buyerID).Scan(&balance); err != nil {
		return nil, fmt.Errorf("platformsvc: buyer balance: %w", err)
	}
	fee := price * feePercent / 100
	gain := price - fee
	if balance < price {
		return nil, ErrInsufficient
	}

	if _, err := tx.Exec(ctx,
		`UPDATE platform.wallets SET balance = balance - $2, updated_at = now() WHERE account_id = $1`,
		buyerID, price); err != nil {
		return nil, fmt.Errorf("platformsvc: debit buyer: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`UPDATE platform.wallets SET balance = balance + $2, updated_at = now() WHERE account_id = $1`,
		sellerID, gain); err != nil {
		return nil, fmt.Errorf("platformsvc: credit seller: %w", err)
	}

	var purchaseID string
	err = tx.QueryRow(ctx, `
		INSERT INTO platform.purchases (buyer_id, seller_id, listing_id, snapshot_id, kind, price, fee)
		VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
		buyerID, sellerID, listingID, snapshotID, kind, price, fee,
	).Scan(&purchaseID)
	if isUniqueViolation(err) {
		return nil, ErrConflict // lost a concurrent race for the same (buyer, listing)
	}
	if err != nil {
		return nil, fmt.Errorf("platformsvc: insert purchase: %w", err)
	}

	feeSink, err := systemAccountID(ctx, tx, "fee_sink")
	if err != nil {
		return nil, err
	}
	var txnID string
	if err := tx.QueryRow(ctx, `SELECT gen_random_uuid()`).Scan(&txnID); err != nil {
		return nil, fmt.Errorf("platformsvc: purchase txn id: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO platform.ledger_entries (transaction_id, account_id, kind, amount, ref) VALUES
		    ($1, $2, 'purchase', $3, $6),
		    ($1, $4, 'sale',     $5, $6),
		    ($1, $7, 'fee',      $8, $6)`,
		txnID, buyerID, -price, sellerID, gain, purchaseID, feeSink, fee,
	); err != nil {
		return nil, fmt.Errorf("platformsvc: purchase ledger: %w", err)
	}

	payload, err := snapshotPayload(ctx, tx, snapshotID)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("platformsvc: purchase commit: %w", err)
	}
	return &PurchaseResult{PurchaseID: purchaseID, Kind: kind, Price: price, Fee: fee, Payload: payload}, nil
}

func snapshotPayload(ctx context.Context, tx pgx.Tx, snapshotID string) (json.RawMessage, error) {
	var payload json.RawMessage
	if err := tx.QueryRow(ctx,
		`SELECT payload FROM platform.snapshots WHERE id = $1`, snapshotID).Scan(&payload); err != nil {
		return nil, fmt.Errorf("platformsvc: purchase payload: %w", err)
	}
	return payload, nil
}
