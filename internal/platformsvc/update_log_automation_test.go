package platformsvc

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
)

func TestAutomationPublicationIdempotency(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	req := PublishUpdateLogRequest{ReleaseKey: "commit:abc123", Title: " 새 기능 ", Body: "본문\n개선 내용 "}
	const callers = 8
	results := make([]*UpdateLogPublication, callers)
	errs := make([]error, callers)
	var wg sync.WaitGroup
	for i := range results {
		wg.Go(func() { results[i], errs[i] = s.PublishUpdateLog(ctx, req) })
	}
	wg.Wait()
	created := 0
	for i, result := range results {
		if errs[i] != nil {
			t.Fatal(errs[i])
		}
		if !result.Replayed {
			created++
		}
		if result.Entry.ID != results[0].Entry.ID || result.Entry.Title != "새 기능" || result.Entry.Body != "본문\n개선 내용" {
			t.Fatalf("publication differs: %+v", result)
		}
	}
	if created != 1 {
		t.Fatalf("new publications = %d, want 1", created)
	}
	var allocated int64
	if err := s.pool.QueryRow(ctx, `SELECT last_value FROM platform.update_logs_id_seq`).Scan(&allocated); err != nil || allocated != 1 {
		t.Fatalf("retry allocated extra identities: %d/%v", allocated, err)
	}
	req.Body = "changed"
	if _, err := s.PublishUpdateLog(ctx, req); !errors.Is(err, ErrConflict) {
		t.Fatalf("conflict = %v", err)
	}
	for _, key := range []string{"", " key", "key\n", "<script>", strings.Repeat("a", 129)} {
		req.ReleaseKey = key
		if _, err := s.PublishUpdateLog(ctx, req); !errors.Is(err, ErrBadUpload) {
			t.Fatalf("key %q = %v", key, err)
		}
	}
	for range 2 {
		if _, err := s.CreateUpdateLog(ctx, CreateUpdateLogRequest{Title: "manual", Body: "body"}); err != nil {
			t.Fatal(err)
		}
	}
	var manual int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM platform.update_logs WHERE release_key IS NULL`).Scan(&manual); err != nil || manual != 2 {
		t.Fatalf("manual = %d/%v", manual, err)
	}
}

func TestAutomationFailureLimitConcurrentAndExpiry(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	const callers = 20
	retries := make([]int, callers)
	errs := make([]error, callers)
	var wg sync.WaitGroup
	for i := range retries {
		wg.Go(func() { retries[i], errs[i] = s.CheckUpdateLogAutomationRate(ctx, "same-ip", false) })
	}
	wg.Wait()
	admitted := 0
	for i, retry := range retries {
		if errs[i] != nil {
			t.Fatal(errs[i])
		}
		if retry == 0 {
			admitted++
		} else if retry < 590 || retry > 600 {
			t.Fatalf("failure retry = %d", retry)
		}
	}
	if admitted != 5 {
		t.Fatalf("admitted guesses = %d, want 5", admitted)
	}
	var failures, publisherQuota int
	if err := s.pool.QueryRow(ctx, `SELECT COALESCE(sum(count), 0) FROM platform.rate_limits WHERE key = 'update-log:failure:same-ip'`).Scan(&failures); err != nil || failures != 5 {
		t.Fatalf("persisted failures = %d/%v", failures, err)
	}
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM platform.rate_limits WHERE key = 'update-log:publish'`).Scan(&publisherQuota); err != nil || publisherQuota != 0 {
		t.Fatalf("invalid keys consumed publisher quota = %d/%v", publisherQuota, err)
	}
	if retry, err := s.CheckUpdateLogAutomationRate(ctx, "same-ip", true); err != nil || retry == 0 {
		t.Fatalf("blocked IP bypass = %d/%v", retry, err)
	}
	if retry, err := s.CheckUpdateLogAutomationRate(ctx, "other-ip", true); err != nil || retry != 0 {
		t.Fatalf("other IP blocked = %d/%v", retry, err)
	}
	// Expire only the oldest failure. Four still-active failures must not block
	// the next request, which is recorded as the fifth active event.
	if _, err := s.pool.Exec(ctx, `UPDATE platform.rate_limits SET window_start = clock_timestamp() - interval '11 minutes'
		WHERE key = 'update-log:failure:same-ip' AND window_start = (
			SELECT min(window_start) FROM platform.rate_limits WHERE key = 'update-log:failure:same-ip')`); err != nil {
		t.Fatal(err)
	}
	if retry, err := s.CheckUpdateLogAutomationRate(ctx, "same-ip", false); err != nil || retry != 0 {
		t.Fatalf("expired failure still blocked = %d/%v", retry, err)
	}
	if retry, err := s.CheckUpdateLogAutomationRate(ctx, "same-ip", false); err != nil || retry == 0 {
		t.Fatalf("new fifth failure not enforced = %d/%v", retry, err)
	}
}

func TestAutomationRequestLimitsAndMinuteBoundary(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	for i := 0; i < 10; i++ {
		if retry, err := s.CheckUpdateLogAutomationRate(ctx, fmt.Sprintf("ip-%d", i), true); err != nil || retry != 0 {
			t.Fatalf("valid request %d = %d/%v", i, retry, err)
		}
	}
	if retry, err := s.CheckUpdateLogAutomationRate(ctx, "extra-ip", true); err != nil || retry < 1 || retry > 60 {
		t.Fatalf("global quota = %d/%v", retry, err)
	}
	// Previous-minute attempts no longer consume the current-minute quota.
	if _, err := s.pool.Exec(ctx, `UPDATE platform.rate_limits SET window_start = date_trunc('minute', clock_timestamp()) - interval '1 minute'
		WHERE key = 'update-log:publish'`); err != nil {
		t.Fatal(err)
	}
	if retry, err := s.CheckUpdateLogAutomationRate(ctx, "extra-ip", true); err != nil || retry != 0 {
		t.Fatalf("new minute = %d/%v", retry, err)
	}
	if _, err := s.pool.Exec(ctx, `INSERT INTO platform.rate_limits (key, window_start, count)
		VALUES ('update-log:attempt:flood', date_trunc('minute', clock_timestamp()), 30)`); err != nil {
		t.Fatal(err)
	}
	if retry, err := s.CheckUpdateLogAutomationRate(ctx, "flood", false); err != nil || retry < 1 || retry > 60 {
		t.Fatalf("attempt cap = %d/%v", retry, err)
	}
	var count int
	if err := s.pool.QueryRow(ctx, `SELECT COALESCE(sum(count), 0) FROM platform.rate_limits WHERE key = 'update-log:failure:flood'`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("throttled request recorded failure: %d/%v", count, err)
	}
	if _, err := s.CheckUpdateLogAutomationRate(ctx, "", true); !errors.Is(err, ErrBadUpload) {
		t.Fatalf("empty identity = %v", err)
	}
}
