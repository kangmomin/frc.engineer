package platformsvc

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"testing"

	"frc.engineer/internal/strategy"
	"frc.engineer/internal/strategy/strategytest"
)

func strategyUpload(r strategy.Record) UploadRequest {
	req := UploadRequest{SourceRaceID: r.RaceID, TrackID: 10, TrackName: "Monza", SessionType: "Race", GameFormat: "F1 26", Strategy: &r.Evidence}
	for _, l := range r.Evidence.Laps {
		req.Laps = append(req.Laps, vlap(l.Number, uint32(l.TimeMs)))
	}
	return req
}

func TestStrategyUploadValidation(t *testing.T) {
	for _, corrupt := range []func(*UploadRequest){
		func(r *UploadRequest) { r.GameFormat = "F1 25" },
		func(r *UploadRequest) { r.SessionType = "Time Trial" },
		func(r *UploadRequest) { r.Strategy.Laps[2].TimeMs++ },
		func(r *UploadRequest) { r.Strategy.SessionUID = "01" },
	} {
		req := strategyUpload(strategytest.Records()[0])
		corrupt(&req)
		if validateUpload(&req) == nil {
			t.Fatal("inconsistent strategy accepted")
		}
	}
	req := strategyUpload(strategytest.Records()[0])
	req.Strategy = nil
	if err := validateUpload(&req); err != nil {
		t.Fatalf("old uploader rejected: %v", err)
	}
}

func TestStrategyCorpusIngestAndIsolation(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	accounts := map[string]string{}
	for i, steam := range []string{steamA, steamB, steamC} {
		id, err := s.UpsertSteamAccount(ctx, steam, fmt.Sprintf("Driver %d", i), "")
		if err != nil {
			t.Fatal(err)
		}
		accounts[fmt.Sprintf("driver-%d", i)] = id

	}
	var firstID string
	fixture := strategytest.Records()
	for i, r := range fixture {
		req := strategyUpload(r)
		if i == 0 {
			req.Laps[2].Valid = false
		}
		res, err := s.IngestRace(ctx, accounts[r.AccountID], req)
		if err != nil || !res.Plausible {
			t.Fatalf("ingest: %+v %v", res, err)
		}
		if i == 0 {
			firstID = res.RaceID
		}
		duplicate, err := s.IngestRace(ctx, accounts[r.AccountID], req)
		if err != nil || !duplicate.Duplicate {
			t.Fatalf("retry: %+v %v", duplicate, err)
		}
		// A different local filename with the same session is still one record.
		req.SourceRaceID += "-copy"
		if _, err := s.IngestRace(ctx, accounts[r.AccountID], req); err != nil {
			t.Fatal(err)
		}
	}
	records, truncated, err := s.LoadStrategyRecords(ctx, 10, "F1 26")
	if err != nil || truncated || len(records) != 12 {
		t.Fatalf("dedup corpus: %d %v %v", len(records), truncated, err)
	}
	for _, r := range records {
		if r.Evidence.SessionUID == "1000" && !slices.Contains(r.Evidence.Laps[2].Flags, "invalid") {
			t.Fatal("server-invalid lap became clean strategy evidence")
		}
	}
	result := strategy.Analyze(records, strategytest.Request(records))
	if result.Status != "ready" || result.Context.Users != 3 || result.Context.Sessions != 12 {
		t.Fatalf("cross-user analysis: %+v", result)
	}
	for _, key := range []struct {
		track  int
		format string
	}{{7, "F1 26"}, {10, "F1 25"}} {
		rows, _, err := s.LoadStrategyRecords(ctx, key.track, key.format)
		if err != nil || len(rows) != 0 {
			t.Fatal("track/game corpus leaked")
		}
	}
	owner := accounts["driver-0"]
	// Evidence never becomes part of the existing owner analysis response.
	detail, err := s.GetMyRaceAnalysis(ctx, owner, firstID)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(detail)
	if strings.Contains(string(raw), "ersStartJ") || strings.Contains(string(raw), "sessionUid") {
		t.Fatal("private corpus leaked to owner race API")
	}
	if _, err := s.pool.Exec(ctx, `INSERT INTO platform.account_bans(account_id,reason) VALUES($1,'test')`, owner); err != nil {
		t.Fatal(err)
	}
	records, _, err = s.LoadStrategyRecords(ctx, 10, "F1 26")
	if err != nil || len(records) != 8 {
		t.Fatalf("ban did not remove observations: %d %v", len(records), err)
	}
	for _, r := range records {
		if r.AccountID == owner {
			t.Fatal("banned user's evidence included")
		}
	}
}

func TestStrategyCorpusPerUserBound(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	id, err := s.UpsertSteamAccount(ctx, steamA, "Driver", "")
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < strategyRecordsPerUser+2; i++ {
		r := strategytest.Records()[0]
		r.RaceID = fmt.Sprintf("bound-%d", i)
		r.Evidence.SessionUID = fmt.Sprint(10000 + i)
		if _, err := s.IngestRace(ctx, id, strategyUpload(r)); err != nil {
			t.Fatal(err)
		}
	}
	records, _, err := s.LoadStrategyRecords(ctx, 10, "F1 26")
	if err != nil || len(records) != strategyRecordsPerUser {
		t.Fatalf("unbounded user: %d %v", len(records), err)
	}
	records, _, err = s.LoadStrategyRecords(ctx, AllStrategyTracks, "F1 26")
	if err != nil || len(records) != strategyRecordsPerUser {
		t.Fatalf("unbounded all-track user: %d %v", len(records), err)
	}
}

func TestStrategyCorpusAllTracks(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	owner, err := s.UpsertSteamAccount(ctx, steamA, "Driver", "")
	if err != nil {
		t.Fatal(err)
	}
	for _, trackID := range []int{7, 10} {
		for copy := 0; copy < 2; copy++ {
			req := strategyUpload(strategytest.Records()[0])
			req.TrackID = trackID
			req.SourceRaceID = fmt.Sprintf("track-%d-copy-%d", trackID, copy)
			if _, err := s.IngestRace(ctx, owner, req); err != nil {
				t.Fatal(err)
			}
		}
	}
	all, truncated, err := s.LoadStrategyRecords(ctx, AllStrategyTracks, "F1 26")
	if err != nil || truncated || len(all) != 2 {
		t.Fatalf("all tracks dedup: %d %v %v", len(all), truncated, err)
	}
	if len(strategy.Contexts(all)) != 2 {
		t.Fatal("same session UID on different tracks merged")
	}
	for _, trackID := range []int{7, 10} {
		rows, _, err := s.LoadStrategyRecords(ctx, trackID, "F1 26")
		if err != nil || len(rows) != 1 || rows[0].TrackID != trackID {
			t.Fatalf("single track: %+v %v", rows, err)
		}
	}
	rows, _, err := s.LoadStrategyRecords(ctx, AllStrategyTracks, "F1 25")
	if err != nil || len(rows) != 0 {
		t.Fatal("all tracks crossed game format")
	}
	if _, err := s.pool.Exec(ctx, `INSERT INTO platform.account_bans(account_id,reason) VALUES($1,'test')`, owner); err != nil {
		t.Fatal(err)
	}
	rows, _, err = s.LoadStrategyRecords(ctx, AllStrategyTracks, "F1 26")
	if err != nil || len(rows) != 0 {
		t.Fatal("all tracks included banned user")
	}
}

func TestStrategyArchiveCoverageIncludesMissingEvidenceAndScopesUploads(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	empty, err := s.LoadStrategyArchiveCoverage(ctx, AllStrategyTracks, "F1 26")
	if err != nil || empty.UploadedRaces != 0 || empty.LatestUploadAt != nil || empty.Truncated || empty.Limit != StrategyRecordLimit {
		t.Fatalf("empty coverage: %+v %v", empty, err)
	}
	owner, err := s.UpsertSteamAccount(ctx, steamA, "Driver", "")
	if err != nil {
		t.Fatal(err)
	}
	banned, err := s.UpsertSteamAccount(ctx, steamB, "Banned", "")
	if err != nil {
		t.Fatal(err)
	}
	for i, sample := range []struct {
		account         string
		track           int
		format, session string
		evidence, valid bool
	}{
		{owner, 10, "F1 26", "Race", true, true},
		{owner, 10, "F1 26", "Race", false, true},
		{owner, 7, "F1 26", "Race", false, true},
		{owner, 10, "F1 25", "Race", false, true},
		{owner, 10, "F1 26", "Time Trial", false, true},
		{banned, 10, "F1 26", "Race", false, true},
		{owner, 10, "F1 26", "Race", false, false},
	} {
		req := strategyUpload(strategytest.Records()[0])
		req.SourceRaceID = fmt.Sprintf("coverage-%d", i)
		req.TrackID, req.GameFormat, req.SessionType = sample.track, sample.format, sample.session
		if !sample.evidence {
			req.Strategy = nil
		}
		if !sample.valid {
			for j := range req.Laps {
				req.Laps[j].Valid = false
			}
		}
		if _, err := s.IngestRace(ctx, sample.account, req); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.pool.Exec(ctx, `INSERT INTO platform.account_bans(account_id,reason) VALUES($1,'test')`, banned); err != nil {
		t.Fatal(err)
	}
	for _, scope := range []struct {
		track                 int
		format                string
		uploads, withEvidence int
	}{
		{10, "F1 26", 2, 1}, {AllStrategyTracks, "F1 26", 3, 1}, {7, "F1 26", 1, 0}, {10, "F1 25", 1, 0},
	} {
		got, err := s.LoadStrategyArchiveCoverage(ctx, scope.track, scope.format)
		if err != nil || got.UploadedRaces != scope.uploads || got.WithEvidence != scope.withEvidence ||
			got.WithoutEvidence != scope.uploads-scope.withEvidence || got.LatestUploadAt == nil || got.Truncated {
			t.Fatalf("scoped coverage %+v: %+v %v", scope, got, err)
		}
	}
	// The coverage window is capped independently of the deduplicated corpus.
	if _, err := s.pool.Exec(ctx, `INSERT INTO platform.races(account_id,source_race_id,track_id,game_format,session_type,plausible,uploaded_at)
		SELECT $1, 'coverage-limit-' || n, 10, 'F1 26', 'Race', true, now()+interval '1 second'
		FROM generate_series(1,$2) n`, owner, StrategyRecordLimit); err != nil {
		t.Fatal(err)
	}
	got, err := s.LoadStrategyArchiveCoverage(ctx, 10, "F1 26")
	if err != nil || !got.Truncated || got.UploadedRaces != StrategyRecordLimit || got.WithEvidence != 0 || got.WithoutEvidence != StrategyRecordLimit {
		t.Fatalf("coverage exceeded window or counted old evidence: %+v %v", got, err)
	}
}
