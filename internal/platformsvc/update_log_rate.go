package platformsvc

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// CheckUpdateLogAutomationRate returns seconds until retry, or zero when
// admitted. Failed authentication events use their actual timestamps, giving
// a rolling ten-minute window. Counters survive restarts and are shared across
// replicas; the normal rate_limits sweep removes them after an hour.
func (s *Store) CheckUpdateLogAutomationRate(ctx context.Context, clientID string, validKey bool) (int, error) {
	if clientID == "" {
		return 0, ErrBadUpload
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, fmt.Errorf("platformsvc: automation rate begin: %w", err)
	}
	defer tx.Rollback(context.Background()) //nolint:errcheck
	// Serialize the failure check and record for this IP, including requests
	// received by different server replicas.
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, "update-log:"+clientID); err != nil {
		return 0, fmt.Errorf("platformsvc: automation rate lock: %w", err)
	}
	retry, err := takeUpdateLogRate(ctx, tx, "update-log:attempt:"+clientID, 30)
	if err != nil {
		return 0, err
	}
	if retry == 0 {
		var failures, failureRetry int
		err := tx.QueryRow(ctx, `SELECT COALESCE(sum(count), 0),
			COALESCE(GREATEST(1, ceil(extract(epoch FROM min(window_start) + interval '10 minutes' - clock_timestamp()))::int), 0)
			FROM platform.rate_limits WHERE key = $1
			AND window_start > clock_timestamp() - interval '10 minutes'`, "update-log:failure:"+clientID).Scan(&failures, &failureRetry)
		if err != nil {
			return 0, fmt.Errorf("platformsvc: automation failures: %w", err)
		}
		if failures >= 5 {
			retry = failureRetry
		} else if validKey {
			// Invalid guesses never consume the valid publisher's quota.
			retry, err = takeUpdateLogRate(ctx, tx, "update-log:publish", 10)
			if err != nil {
				return 0, err
			}
		} else {
			_, err := tx.Exec(ctx, `INSERT INTO platform.rate_limits (key, window_start, count)
				VALUES ($1, clock_timestamp(), 1)
				ON CONFLICT (key, window_start) DO UPDATE SET count = LEAST(rate_limits.count + 1, 5)`, "update-log:failure:"+clientID)
			if err != nil {
				return 0, fmt.Errorf("platformsvc: record automation failure: %w", err)
			}
		}
	}
	// Commit even on rejection: rolling back would erase failed attempts.
	if err := tx.Commit(ctx); err != nil {
		return 0, fmt.Errorf("platformsvc: automation rate commit: %w", err)
	}
	return retry, nil
}

func takeUpdateLogRate(ctx context.Context, tx pgx.Tx, key string, limit int) (int, error) {
	var count, retry int
	err := tx.QueryRow(ctx, `INSERT INTO platform.rate_limits (key, window_start, count)
		VALUES ($1, date_trunc('minute', clock_timestamp()), 1)
		ON CONFLICT (key, window_start) DO UPDATE SET count = LEAST(rate_limits.count + 1, $2 + 1)
		RETURNING count, GREATEST(1, ceil(extract(epoch FROM window_start + interval '1 minute' - clock_timestamp()))::int)`, key, limit).Scan(&count, &retry)
	if err != nil {
		return 0, fmt.Errorf("platformsvc: automation rate counter: %w", err)
	}
	if count > limit {
		return retry, nil
	}
	return 0, nil
}
