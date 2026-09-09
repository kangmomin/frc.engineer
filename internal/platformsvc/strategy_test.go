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
}
