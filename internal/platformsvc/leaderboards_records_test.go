package platformsvc

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"reflect"
	"testing"
	"time"
)

func recordQuery() LeaderboardQuery {
	return LeaderboardQuery{TrackID: 5, Format: "F1 26", Board: "pb", Limit: 50}
}

func seedRecordRace(t *testing.T, s *Store, account, source, session string, stamp time.Time, plausible bool, laps []int, valid bool) string {
	t.Helper()
	ctx := context.Background()
	var race string
	err := s.pool.QueryRow(ctx, `INSERT INTO platform.races(account_id,source_race_id,track_id,game_format,session_type,plausible,uploaded_at) VALUES($1,$2,5,'F1 26',$3,$4,$5) RETURNING id`, account, source, session, plausible, stamp).Scan(&race)
	if err != nil {
		t.Fatal(err)
	}
	for i, lap := range laps {
		_, err = s.pool.Exec(ctx, `INSERT INTO platform.laps(race_id,lap_number,lap_ms,s1_ms,s2_ms,s3_ms,tyre,valid) VALUES($1,$2,$3,30000,30000,$3::int-60000,'Soft',$4)`, race, i+1, lap, valid)
		if err != nil {
			t.Fatal(err)
		}
	}
	return race
}
func seedRecordAccount(t *testing.T, s *Store, name string) string {
	t.Helper()
	var id string
	if err := s.pool.QueryRow(context.Background(), `INSERT INTO platform.accounts(persona,kind,verified_at) VALUES($1,'user',now()) RETURNING id`, name).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}
func readRecords(t *testing.T, s *Store, q LeaderboardQuery, viewer string) *LeaderboardRecords {
	t.Helper()
	r, err := s.LeaderboardRecords(context.Background(), q, viewer)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func TestRecordsFullRankKeysetAndMicroseconds(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	// All scores tie. Three accounts share each microsecond timestamp; UUID then
	// breaks ties. A millisecond cursor would skip or duplicate this population.
	_, err := s.pool.Exec(ctx, `
 WITH accounts AS (
  INSERT INTO platform.accounts(id,persona,kind,verified_at)
  SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Driver'||n,'user',now() FROM generate_series(1,207) n RETURNING id,persona
 ), races AS (
  INSERT INTO platform.races(account_id,source_race_id,track_id,game_format,session_type,plausible,uploaded_at)
  SELECT id,persona,5,'F1 26','Time Trial',true,'2025-01-01T00:00:00Z'::timestamptz + ((substring(persona from 7)::int-1)/3)*interval '1 microsecond' FROM accounts RETURNING id
 ) INSERT INTO platform.laps(race_id,lap_number,lap_ms,s1_ms,s2_ms,s3_ms,valid)
 SELECT id,1,90000,30000,30000,30000,true FROM races`)
	if err != nil {
		t.Fatal(err)
	}
	viewer := "00000000-0000-4000-8000-000000000207"
	q := recordQuery()
	first := readRecords(t, s, q, viewer)
	if first.Total != 207 || first.Viewer == nil || first.Viewer.Rank != 207 || first.LeaderMS == nil || *first.LeaderMS != 90000 || first.ViewerGapToTop10MS == nil || *first.ViewerGapToTop10MS != 0 || first.PreviousCursor != nil || first.AnchorFound {
		t.Fatalf("first metadata: %+v", first)
	}
	seen := map[string]bool{}
	page := first
	rank := 1
	for {
		for _, row := range page.Rows {
			if row.Rank != rank || seen[row.AccountID] {
				t.Fatalf("rank/duplicate: %+v want %d", row, rank)
			}
			if row.AccountID != fmt.Sprintf("00000000-0000-4000-8000-%012d", rank) {
				t.Fatalf("unstable tie order: %+v", row)
			}
			seen[row.AccountID] = true
			rank++
		}
		if !page.AsOf.Equal(first.AsOf) {
			t.Fatal("cutoff changed")
		}
		if page.NextCursor == nil {
			break
		}
		q.Cursor = *page.NextCursor
		page = readRecords(t, s, q, viewer)
	}
	if rank != 208 || len(page.Rows) != 7 || !page.Rows[6].You {
		t.Fatalf("last page %+v", page)
	}
	// Return backwards from the short last page, then back to the first page.
	for page.PreviousCursor != nil {
		q.Cursor = *page.PreviousCursor
		page = readRecords(t, s, q, viewer)
	}
	if !reflect.DeepEqual(page.Rows, first.Rows) {
		t.Fatal("previous traversal failed to recover first page")
	}
	q.Cursor = ""
	q.Around = viewer
	around := readRecords(t, s, q, viewer)
	if !around.AnchorFound || len(around.Rows) != 50 || around.Rows[0].Rank != 158 || around.Rows[49].Rank != 207 {
		t.Fatalf("end clamp: %+v", around)
	}
	q.Around = "00000000-0000-4000-8000-000000000100"
	around = readRecords(t, s, q, viewer)
	if around.Rows[0].Rank != 75 || around.Rows[25].Rank != 100 || around.Viewer.Rank != 207 || around.Rows[25].You {
		t.Fatalf("center/viewer: %+v", around)
	}
	q.Around = "00000000-0000-4000-8000-000000000001"
	around = readRecords(t, s, q, viewer)
	if around.Rows[0].Rank != 1 || around.PreviousCursor != nil {
		t.Fatal("start clamp")
	}
	q.Around = "00000000-0000-4000-8000-999999999999"
	missing := readRecords(t, s, q, viewer)
	if missing.AnchorFound || len(missing.Rows) != 0 || missing.Total != 207 || missing.Viewer == nil || missing.NextCursor != nil || missing.PreviousCursor != nil {
		t.Fatalf("missing anchor: %+v", missing)
	}
	// A post-cutoff upload cannot alter the continuation population.
	late := seedRecordAccount(t, s, "Late")
	seedRecordRace(t, s, late, "late", "Time Trial", first.AsOf.Add(time.Microsecond), true, []int{80000}, true)
	q = recordQuery()
	q.Cursor = *first.NextCursor
	stable := readRecords(t, s, q, viewer)
	if stable.Total != 207 || stable.Rows[0].Rank != 51 {
		t.Fatalf("late upload leaked: %+v", stable)
	}
	q.Cursor = ""
	q.Format = "unknown"
	empty := readRecords(t, s, q, viewer)
	if empty.Total != 0 || empty.LeaderMS != nil || empty.Viewer != nil || empty.ViewerGapToTop10MS != nil || empty.Rows == nil || len(empty.Rows) != 0 {
		t.Fatalf("empty: %+v", empty)
	}
}

func TestRecordsSessionEligibilityAndRepresentativeAgreement(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	stamp := time.Date(2025, 1, 1, 0, 0, 0, 123456000, time.UTC)
	target := seedRecordAccount(t, s, "Mixed")
	for i, session := range []string{"Race", "Practice", "", "TT", " time TRIAL ", "Time Trial"} {
		seedRecordRace(t, s, target, fmt.Sprint(i), session, stamp, true, []int{80000 + i*1000}, true)
	}
	banned := seedRecordAccount(t, s, "Banned")
	seedRecordRace(t, s, banned, "banned", "Time Trial", stamp, true, []int{70000}, true)
	if _, err := s.pool.Exec(ctx, `INSERT INTO platform.account_bans(account_id,reason) VALUES($1,'test')`, banned); err != nil {
		t.Fatal(err)
	}
	seedRecordRace(t, s, target, "invalid", "Time Trial", stamp, true, []int{71000}, false)
	seedRecordRace(t, s, target, "implausible", "Time Trial", stamp, false, []int{72000}, true)
	q := recordQuery()
	pb := readRecords(t, s, q, target)
	if pb.Total != 1 || pb.Rows[0].ScoreMS != 80000 || pb.ViewerGapToTop10MS != nil || pb.Rows[0].StddevMS != nil {
		t.Fatalf("PB: %+v", pb)
	}
	q.Board = "tt"
	tt := readRecords(t, s, q, target)
	if tt.Total != 1 || tt.Rows[0].ScoreMS != 84000 || tt.Rows[0].SectorsMS == nil {
		t.Fatalf("TT includes noncanonical session: %+v", tt)
	}
	// Same score and timestamp, different races and sector splits: all PB APIs
	// must pick the same UUID/lap-ID representative, including intra-race ties.
	race := seedRecordRace(t, s, target, "tie", "Race", stamp, true, []int{80000, 80000}, true)
	if _, err := s.pool.Exec(ctx, `UPDATE platform.laps SET s1_ms=31000,s3_ms=29000 WHERE race_id=$1`, race); err != nil {
		t.Fatal(err)
	}
	q.Board = "pb"
	pb = readRecords(t, s, q, target)
	legacy, err := s.TimeTrialLeaderboard(ctx, 5, "F1 26", target)
	if err != nil {
		t.Fatal(err)
	}
	profile, err := s.DriverProfile(ctx, target)
	if err != nil {
		t.Fatal(err)
	}
	want := profile.Tracks[0].TimeTrial
	if pb.Rows[0].ScoreMS != want.LapMS || (*pb.Rows[0].SectorsMS)[0] != want.S1MS || int(legacy[0].S1Ms) != want.S1MS {
		t.Fatalf("PB representatives disagree: %+v %+v %+v", pb.Rows[0], legacy[0], want)
	}
}

func TestRecordsPaceRoundedMeanInclusiveBand(t *testing.T) {
	s := testStore(t)
	stamp := time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)
	target := seedRecordAccount(t, s, "Pace")
	// Mean = 100000.6 -> displayed 100001. 99001 and 101001 are inclusive;
	// 99000 is outside. Comparing to the unrounded mean would exclude 101001.
	samples := []int{99000, 99001, 101001, 100001, 101000}
	seedRecordRace(t, s, target, "pace", "Race", stamp, true, samples, true)
	seedRecordRace(t, s, target, "invalid", "Race", stamp, true, []int{70000}, false)
	short := seedRecordAccount(t, s, "Four")
	seedRecordRace(t, s, short, "four", "Practice", stamp, true, []int{80000, 80000, 80000, 80000}, true)
	q := recordQuery()
	q.Board = "pace"
	r := readRecords(t, s, q, target)
	if r.Total != 1 || r.Rows[0].ScoreMS != 100001 || r.Rows[0].Laps == nil || *r.Rows[0].Laps != 5 || r.Rows[0].SectorsMS != nil || r.Rows[0].WithinOneSecond == nil || *r.Rows[0].WithinOneSecond != 0.8 {
		t.Fatalf("pace: %+v", r.Rows)
	}
	var variance float64
	for _, lap := range samples {
		variance += math.Pow(float64(lap)-100000.6, 2)
	}
	sd := math.Sqrt(variance / 5)
	row := r.Rows[0]
	if row.StddevMS == nil || math.Abs(*row.StddevMS-sd) > 1e-8 || math.Abs(*row.Consistency-(1-sd/100001)) > 1e-8 {
		t.Fatalf("stats: %+v expected sd %f", row, sd)
	}
	profile, err := s.DriverProfile(context.Background(), target)
	if err != nil {
		t.Fatal(err)
	}
	if math.Abs(profile.Tracks[0].RacePace.StddevMS-sd) > 1e-8 {
		t.Fatal("profile stddev differs")
	}
	q.Board = "tt"
	tt := readRecords(t, s, q, "")
	if tt.Total != 0 {
		t.Fatal("Race/Practice entered TT")
	}
}

func TestRecordCursorRejectsMalformedAndScopeChanges(t *testing.T) {
	q := recordQuery()
	c, _ := q.validate()
	c.Direction = "next"
	c.ScoreMS = 90000
	c.AccountID = "00000000-0000-4000-8000-000000000001"
	encode := func(c recordCursor) string {
		data, _ := json.Marshal(c)
		return base64.RawURLEncoding.EncodeToString(data)
	}
	for _, accountID := range []string{"urn:uuid:" + c.AccountID, "{" + c.AccountID + "}"} {
		alternate := c
		alternate.AccountID = accountID
		query := q
		query.Cursor = encode(alternate)
		normalized, err := query.validate()
		if err != nil || normalized.AccountID != c.AccountID {
			t.Fatalf("UUID %q was not normalized: %+v, %v", accountID, normalized, err)
		}
	}
	q.Cursor = encode(c)
	if _, err := q.validate(); err != nil {
		t.Fatal(err)
	}
	for _, mutate := range []func(*LeaderboardQuery){
		func(q *LeaderboardQuery) { q.Board = "tt" }, func(q *LeaderboardQuery) { q.TrackID = 6 }, func(q *LeaderboardQuery) { q.Format = "F1 25" }, func(q *LeaderboardQuery) { q.Limit = 51 }, func(q *LeaderboardQuery) { q.Around = c.AccountID }, func(q *LeaderboardQuery) { q.Cursor = "bad" },
	} {
		bad := q
		mutate(&bad)
		if _, err := bad.validate(); !errors.Is(err, ErrLeaderboardQuery) {
			t.Fatalf("accepted %+v", bad)
		}
	}
	for _, mutate := range []func(*recordCursor){
		func(c *recordCursor) { c.Version = 2 }, func(c *recordCursor) { c.Direction = "sideways" }, func(c *recordCursor) { c.ScoreMS = -1 }, func(c *recordCursor) { c.AccountID = "invalid" }, func(c *recordCursor) { c.AsOf = time.Time{} }, func(c *recordCursor) { c.UploadedAt = c.AsOf.Add(time.Microsecond) }, func(c *recordCursor) { c.UploadedAt = c.UploadedAt.Add(time.Nanosecond) },
	} {
		bad := c
		mutate(&bad)
		query := q
		query.Cursor = encode(bad)
		if _, err := query.validate(); !errors.Is(err, ErrLeaderboardQuery) {
			t.Fatalf("accepted %+v", bad)
		}
	}
	for _, raw := range []string{`{}`, `null`, `{"v":1,"extra":true}`, string(mustRecordJSON(t, c)) + ` {}`} {
		bad := q
		bad.Cursor = base64.RawURLEncoding.EncodeToString([]byte(raw))
		if _, err := bad.validate(); !errors.Is(err, ErrLeaderboardQuery) {
			t.Fatalf("accepted %s", raw)
		}
	}
}
func mustRecordJSON(t *testing.T, v any) []byte {
	t.Helper()
	data, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func TestRecordsPacePagingAndLiveBans(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	stamp := time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)
	var ids []string
	for i := 0; i < 11; i++ {
		id := seedRecordAccount(t, s, fmt.Sprint("Pace", i))
		ids = append(ids, id)
		seedRecordRace(t, s, id, "race", "Race", stamp, true, []int{90000 + i, 90000 + i, 90000 + i, 90000 + i, 90000 + i}, true)
	}
	q := recordQuery()
	q.Board = "pace"
	q.Limit = 5
	first := readRecords(t, s, q, ids[10])
	if first.ViewerGapToTop10MS == nil || *first.ViewerGapToTop10MS != 1 {
		t.Fatalf("top10 gap: %+v", first)
	}
	q.Cursor = *first.NextCursor
	second := readRecords(t, s, q, ids[10])
	if second.Rows[0].Rank != 6 || second.Rows[4].Rank != 10 {
		t.Fatal("pace next")
	}
	q.Cursor = *second.PreviousCursor
	back := readRecords(t, s, q, ids[10])
	if !reflect.DeepEqual(back.Rows, first.Rows) {
		t.Fatal("pace previous")
	}
	// Bans are live, including on an existing cutoff, and metadata uses the same
	// filtered population as page rows rather than retaining a stale cached viewer.
	if _, err := s.pool.Exec(ctx, `INSERT INTO platform.account_bans(account_id,reason) VALUES($1,'test')`, ids[10]); err != nil {
		t.Fatal(err)
	}
	q.Cursor = *first.NextCursor
	after := readRecords(t, s, q, ids[10])
	if after.Total != 10 || after.Viewer != nil || after.ViewerGapToTop10MS != nil || after.NextCursor != nil {
		t.Fatalf("live ban: %+v", after)
	}
}
