package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"frc.engineer/internal/platformsvc"
	"frc.engineer/internal/strategy"
	"frc.engineer/internal/strategy/strategytest"
)

type strategyStub struct {
	loads         int
	tracks        []int
	coverageLoads int
}

func (s *strategyStub) LoadStrategyArchiveCoverage(_ context.Context, _ int, _ string) (platformsvc.StrategyArchiveCoverage, error) {
	s.coverageLoads++
	return platformsvc.StrategyArchiveCoverage{UploadedRaces: 15, WithEvidence: 12, WithoutEvidence: 3, Limit: platformsvc.StrategyRecordLimit}, nil
}

func (s *strategyStub) LoadStrategyRecords(_ context.Context, trackID int, _ string) ([]strategy.Record, bool, error) {
	s.loads++
	s.tracks = append(s.tracks, trackID)
	records := strategytest.Records()
	if trackID == platformsvc.AllStrategyTracks {
		other := strategytest.Records()
		for i := range other {
			other[i].TrackID = 7
		}
		records = append(records, other...)
	}
	return records, false, nil
}

func strategyHTTP(s *server) func(string, string, string) *httptest.ResponseRecorder {
	mux := http.NewServeMux()
	registerStrategyRoutes(mux, s)
	return func(method, target, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, target, strings.NewReader(body))
		r.Header.Set("Authorization", "Bearer test")
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		return w
	}
}

const strategyQuery = "?trackId=10&gameFormat=F1+26"

func TestStrategyGateRunsBeforeCorpus(t *testing.T) {
	for name, principal := range map[string]platformsvc.Principal{
		"anonymous": {}, "wrong scope": {Scope: platformsvc.ScopeUpload}, "missing grant": {Scope: platformsvc.ScopeWeb},
		"banned":  {Scope: platformsvc.ScopeWeb, Banned: true, Permissions: []string{"pithub"}},
		"view as": {Scope: platformsvc.ScopeWeb, ViewAs: true, Permissions: []string{"pithub"}},
	} {
		t.Run(name, func(t *testing.T) {
			store := &strategyStub{}
			s := &server{strategyStore: store, authenticateForTest: func(context.Context, *http.Request) (platformsvc.Principal, error) {
				if name == "anonymous" {
					return principal, errors.New("no auth")
				}
				return principal, nil
			}}
			call := strategyHTTP(s)
			for _, route := range []struct{ method, target string }{{"GET", "/strategies/contexts" + strategyQuery}, {"POST", "/strategies/simulate" + strategyQuery}} {
				w := call(route.method, route.target, `{}`)
				if (w.Code != 401 && w.Code != 403) || w.Header().Get("Cache-Control") != "no-store" {
					t.Fatalf("gate: %d %s", w.Code, w.Body.String())
				}
			}
			if store.loads != 0 || store.coverageLoads != 0 {
				t.Fatal("denied caller reached store")
			}
		})
	}
}

func TestStrategyPermissionAndHTTPContract(t *testing.T) {
	store := &strategyStub{}
	s := &server{strategyStore: store, authenticateForTest: func(context.Context, *http.Request) (platformsvc.Principal, error) {
		return platformsvc.Principal{AccountID: "owner", Scope: platformsvc.ScopeWeb, Permissions: []string{"pithub.strategy"}}, nil
	}}
	call := strategyHTTP(s)
	w := call("GET", "/strategies/contexts"+strategyQuery, "")
	var data struct {
		Contexts     []strategy.Context                  `json:"contexts"`
		Diagnostics  strategy.Diagnostics                `json:"diagnostics"`
		Coverage     platformsvc.StrategyArchiveCoverage `json:"archiveCoverage"`
		MinCleanLaps int                                 `json:"minCleanLaps"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &data); err != nil || w.Code != 200 || len(data.Contexts) != 1 {
		t.Fatalf("contexts: %s %v", w.Body.String(), err)
	}
	if data.Diagnostics.CollectedLaps != 360 || data.Diagnostics.CleanLaps != data.Contexts[0].CleanLaps ||
		data.Coverage.WithoutEvidence != 3 || data.Coverage.UploadedRaces != 15 || data.MinCleanLaps != strategy.MinCleanLaps {
		t.Fatalf("missing collection diagnostics: %s", w.Body.String())
	}
	for _, private := range []string{"driver-", "race-00", "sessionUid", "fuelKg", "setupRevision", "ersStartJ"} {
		if strings.Contains(w.Body.String(), private) {
			t.Fatalf("private %s leaked in collection status", private)
		}
	}
	for _, invalid := range []string{"", strategyQuery + "&trackId=7", "?trackId=x&gameFormat=F1+26", "?trackId=-1&gameFormat=F1+26", "?trackId=&gameFormat=F1+26", "?gameFormat=F1+26&gameFormat=F1+25", strategyQuery + "&accountId=other"} {
		if w := call("GET", "/strategies/contexts"+invalid, ""); w.Code != 400 {
			t.Fatalf("query accepted: %s", invalid)
		}
	}
	w = call("GET", "/strategies/contexts?gameFormat=F1+26", "")
	if err := json.Unmarshal(w.Body.Bytes(), &data); err != nil || w.Code != 200 || len(data.Contexts) != 2 || store.tracks[len(store.tracks)-1] != platformsvc.AllStrategyTracks {
		t.Fatalf("all tracks: %d %s %v", w.Code, w.Body.String(), err)
	}
	if data.Contexts[0].TrackID == data.Contexts[1].TrackID || data.Contexts[0].ID == data.Contexts[1].ID {
		t.Fatal("different tracks merged in all-track response")
	}
	loads := store.loads
	if w := call("POST", "/strategies/simulate?gameFormat=F1+26", `{}`); w.Code != 400 || store.loads != loads {
		t.Fatal("simulation accepted an all-track query")
	}
	req := strategytest.Request(strategytest.Records())
	raw, _ := json.Marshal(req)
	w = call("POST", "/strategies/simulate"+strategyQuery, string(raw))
	var result strategy.Result
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil || w.Code != 200 || result.Status != "ready" {
		t.Fatalf("simulate: %s %v", w.Body.String(), err)
	}
	for _, private := range []string{"driver-", "race-", "sessionUid", "fuelKg", "setupRevision", "ersStartJ"} {
		if strings.Contains(w.Body.String(), private) {
			t.Fatalf("private %s leaked", private)
		}
	}
	for _, body := range []string{`{}`, string(raw) + `{}`, strings.Repeat(" ", 4096) + string(raw)} {
		if w := call("POST", "/strategies/simulate"+strategyQuery, body); w.Code != 400 {
			t.Fatalf("invalid body accepted: %d", w.Code)
		}
	}
	if w := call("POST", "/me/strategy-preferences", `{"enabled":true}`); w.Code != 404 {
		t.Fatal("removed opt-in endpoint is still reachable")
	}
}
