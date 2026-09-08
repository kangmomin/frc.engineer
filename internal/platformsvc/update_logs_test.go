package platformsvc

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestUpdateLogValidation(t *testing.T) {
	for _, req := range []CreateUpdateLogRequest{
		{Title: " ", Body: "body"}, {Title: "title", Body: "\n"},
		{Title: strings.Repeat("한", 121), Body: "body"},
		{Title: "title", Body: strings.Repeat("한", 10001)},
		{Title: "a\nb", Body: "body"}, {Title: "title", Body: "bad\x00"},
	} {
		if !errors.Is(req.validate(), ErrBadUpload) {
			t.Fatal("invalid publication accepted")
		}
	}
	req := CreateUpdateLogRequest{Title: " " + strings.Repeat("한", 120) + " ", Body: " " + strings.Repeat("한", 10000) + " "}
	if err := req.validate(); err != nil || len([]rune(req.Title)) != 120 || len([]rune(req.Body)) != 10000 {
		t.Fatalf("valid unicode boundary rejected: %v", err)
	}
}

func TestUpdateLogSeenSnapshotAndAccountIsolation(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	a, err := s.UpsertSteamAccount(ctx, testSteamID, "A", "")
	if err != nil {
		t.Fatal(err)
	}
	b, err := s.UpsertSteamAccount(ctx, "76561197960287931", "B", "")
	if err != nil {
		t.Fatal(err)
	}
	list := func(account string, before int64) *UpdateLogPage {
		t.Helper()
		page, err := s.ListUpdateLogs(ctx, account, before)
		if err != nil {
			t.Fatal(err)
		}
		return page
	}
	empty := list(a, 0)
	if empty.HasUnseen || empty.LatestRevision != "0" || len(empty.Items) != 0 {
		t.Fatalf("empty feed = %+v", empty)
	}
	publish := func(title string) *UpdateLog {
		t.Helper()
		entry, err := s.CreateUpdateLog(ctx, CreateUpdateLogRequest{Title: title, Body: "<script>plain text</script>\n새 기능"})
		if err != nil {
			t.Fatal(err)
		}
		return entry
	}
	first := publish("첫 업데이트")
	snapshot := list(a, 0)
	if !snapshot.HasUnseen || snapshot.LatestRevision != first.ID || snapshot.Items[0].ID != first.ID {
		t.Fatalf("first snapshot = %+v", snapshot)
	}
	second := publish("모달을 보는 동안 등록")
	if err := s.MarkUpdateLogsSeen(ctx, a, snapshot.LatestRevision); err != nil {
		t.Fatal(err)
	}
	if !list(a, 0).HasUnseen {
		t.Fatal("acknowledging old snapshot swallowed newer publication")
	}
	if err := s.MarkUpdateLogsSeen(ctx, a, second.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.MarkUpdateLogsSeen(ctx, a, first.ID); err != nil {
		t.Fatal(err)
	}
	if list(a, 0).HasUnseen {
		t.Fatal("older device moved watermark backwards")
	}
	if !list(b, 0).HasUnseen {
		t.Fatal("account A changed B's seen state")
	}
	for _, revision := range []string{"", "0", "-1", "999999", "9223372036854775808", "+1", "01"} {
		if !errors.Is(s.MarkUpdateLogsSeen(ctx, a, revision), ErrBadUpload) {
			t.Fatalf("accepted invalid/future revision %q", revision)
		}
	}
	// The first page is bounded, but every older publication remains reachable.
	for i := 0; i < updateLogPageSize; i++ {
		publish(fmt.Sprintf("Update %d", i))
	}
	page := list(a, 0)
	if len(page.Items) != updateLogPageSize || page.NextBefore == "" {
		t.Fatalf("first page = %+v", page)
	}
	before, _ := strconv.ParseInt(page.NextBefore, 10, 64)
	older := list(a, before)
	if len(older.Items) != 2 || older.Items[0].ID != second.ID || older.Items[1].ID != first.ID || older.NextBefore != "" {
		t.Fatalf("older page = %+v", older)
	}
}

func TestUpdateLogPublicationWaitsForPriorCommit(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if _, err := tx.Exec(ctx, `LOCK TABLE platform.update_logs IN SHARE ROW EXCLUSIVE MODE`); err != nil {
		t.Fatal(err)
	}
	var first int64
	if err := tx.QueryRow(ctx, `INSERT INTO platform.update_logs (title, body) VALUES ('pending', 'body') RETURNING id`).Scan(&first); err != nil {
		t.Fatal(err)
	}
	// A concurrent publication must block before allocating its identity, and
	// readers must still work while the publication lock is held.
	timed, cancel := context.WithTimeout(ctx, 150*time.Millisecond)
	defer cancel()
	if _, err := s.CreateUpdateLog(timed, CreateUpdateLogRequest{Title: "blocked", Body: "body"}); err == nil {
		t.Fatal("publication bypassed prior transaction")
	}
	var allocated int64
	if err := s.pool.QueryRow(ctx, `SELECT last_value FROM platform.update_logs_id_seq`).Scan(&allocated); err != nil {
		t.Fatal(err)
	}
	if allocated != first {
		t.Fatalf("identity allocated before lock: %d != %d", allocated, first)
	}
	var visible int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM platform.update_logs`).Scan(&visible); err != nil || visible != 0 {
		t.Fatalf("uncommitted publication visible: %d/%v", visible, err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	next, err := s.CreateUpdateLog(ctx, CreateUpdateLogRequest{Title: "next", Body: "body"})
	if err != nil {
		t.Fatal(err)
	}
	if next.ID != strconv.FormatInt(first+1, 10) {
		t.Fatalf("next ID = %s", next.ID)
	}
}
