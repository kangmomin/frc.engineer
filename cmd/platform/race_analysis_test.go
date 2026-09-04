package main

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"frc.engineer/internal/platformsvc"
	"frc.engineer/internal/rbac"
)

type raceAnalysisReaderStub struct {
	listErr           error
	detailErr         error
	incidentErr       error
	calls             int
	listAccountID     string
	listLimit         int
	listOffset        int
	detailAccountID   string
	detailRaceID      string
	incidentAccountID string
	incidentRaceID    string
	incidentIndex     int
}

func (s *raceAnalysisReaderStub) ListMyRaceAnalyses(_ context.Context, accountID string, limit, offset int) (*platformsvc.RaceAnalysisListResponse, error) {
	s.calls++
	s.listAccountID = accountID
	s.listLimit = limit
	s.listOffset = offset
	if s.listErr != nil {
		return nil, s.listErr
	}
	return &platformsvc.RaceAnalysisListResponse{Items: []platformsvc.RaceAnalysisListItem{}}, nil
}

func (s *raceAnalysisReaderStub) GetMyRaceAnalysis(_ context.Context, accountID, raceID string) (*platformsvc.RaceAnalysisDetail, error) {
	s.calls++
	s.detailAccountID = accountID
	s.detailRaceID = raceID
	if s.detailErr != nil {
		return nil, s.detailErr
	}
	return &platformsvc.RaceAnalysisDetail{}, nil
}

func (s *raceAnalysisReaderStub) GetMyRaceAnalysisIncident(_ context.Context, accountID, raceID string, index int) (*platformsvc.RaceAnalysisIncidentReplay, error) {
	s.calls++
	s.incidentAccountID = accountID
	s.incidentRaceID = raceID
	s.incidentIndex = index
	if s.incidentErr != nil {
		return nil, s.incidentErr
	}
	return &platformsvc.RaceAnalysisIncidentReplay{}, nil
}

func raceAnalysisMux(srv *server) *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /me/race-analyses", srv.handleMyRaceAnalyses)
	mux.HandleFunc("GET /me/race-analyses/{id}", srv.handleMyRaceAnalysis)
	mux.HandleFunc("GET /me/race-analyses/{id}/incidents/{index}", srv.handleMyRaceAnalysisIncident)
	return mux
}

func raceAnalysisPrincipal() platformsvc.Principal {
	return platformsvc.Principal{AccountID: "owner", Scope: platformsvc.ScopeWeb, Permissions: []string{rbac.PermRaceRead}}
}

func raceAnalysisRequest(mux *http.ServeMux, target string) *httptest.ResponseRecorder {
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, target, nil)
	request.Header.Set("Authorization", "Bearer test")
	mux.ServeHTTP(recorder, request)
	return recorder
}

func TestRaceAnalysisHandlersSetNoStoreBeforeAuthentication(t *testing.T) {
	srv := &server{}
	for name, handler := range map[string]http.HandlerFunc{
		"list":     srv.handleMyRaceAnalyses,
		"detail":   srv.handleMyRaceAnalysis,
		"incident": srv.handleMyRaceAnalysisIncident,
	} {
		t.Run(name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			handler(recorder, httptest.NewRequest(http.MethodGet, "/me/race-analyses/not-a-uuid/incidents/not-an-index", nil))
			if recorder.Code != http.StatusUnauthorized {
				t.Fatalf("status = %d, want auth gate 401", recorder.Code)
			}
			if cache := recorder.Header().Get("Cache-Control"); cache != "no-store" {
				t.Fatalf("Cache-Control = %q, want no-store before gate", cache)
			}
		})
	}
}

func TestRaceAnalysisStrictParameters(t *testing.T) {
	for _, testCase := range []struct {
		target     string
		wantLimit  int
		wantOffset int
		wantOK     bool
	}{
		{"/me/race-analyses", 50, 0, true},
		{"/me/race-analyses?limit=1&offset=99", 1, 99, true},
		{"/me/race-analyses?limit=0", 0, 0, false},
		{"/me/race-analyses?limit=101", 0, 0, false},
		{"/me/race-analyses?offset=-1", 0, 0, false},
		{"/me/race-analyses?limit=1&limit=2", 0, 0, false},
		{"/me/race-analyses?sort=uploadedAt", 0, 0, false},
	} {
		t.Run(testCase.target, func(t *testing.T) {
			limit, offset, ok := raceAnalysisPagination(httptest.NewRequest(http.MethodGet, testCase.target, nil))
			if ok != testCase.wantOK || (ok && (limit != testCase.wantLimit || offset != testCase.wantOffset)) {
				t.Fatalf("pagination = %d/%d/%v, want %d/%d/%v", limit, offset, ok, testCase.wantLimit, testCase.wantOffset, testCase.wantOK)
			}
		})
	}

	for raw, wantOK := range map[string]bool{"0": true, "19": true, "20": false, "-1": false, "": false, "one": false} {
		_, ok := raceAnalysisIncidentIndex(raw)
		if ok != wantOK {
			t.Fatalf("incident index %q ok=%v, want %v", raw, ok, wantOK)
		}
	}
}

func TestRaceAnalysisHandlersDenyFullAuthMatrixBeforeReader(t *testing.T) {
	for name, principal := range map[string]platformsvc.Principal{
		"wrong scope":          {AccountID: "owner", Scope: platformsvc.ScopeUpload, Permissions: []string{rbac.PermRaceRead}},
		"banned":               {AccountID: "owner", Scope: platformsvc.ScopeWeb, Banned: true, Permissions: []string{rbac.PermRaceRead}},
		"permission":           {AccountID: "owner", Scope: platformsvc.ScopeWeb},
		"view as analyze only": {AccountID: "subject", Scope: platformsvc.ScopeWeb, ViewAs: true, Permissions: []string{rbac.PermAnalyzeRead}},
	} {
		t.Run(name, func(t *testing.T) {
			reader := &raceAnalysisReaderStub{}
			srv := &server{raceAnalysisReader: reader, authenticateForTest: func(context.Context, *http.Request) (platformsvc.Principal, error) {
				return principal, nil
			}}
			mux := raceAnalysisMux(srv)
			for route, target := range map[string]string{
				"list":     "/me/race-analyses",
				"detail":   "/me/race-analyses/00000000-0000-4000-8000-000000000001",
				"incident": "/me/race-analyses/00000000-0000-4000-8000-000000000001/incidents/0",
			} {
				recorder := raceAnalysisRequest(mux, target)
				if recorder.Code != http.StatusForbidden || recorder.Header().Get("Cache-Control") != "no-store" {
					t.Fatalf("%s %s = %d cache=%q, want 403/no-store", name, route, recorder.Code, recorder.Header().Get("Cache-Control"))
				}
			}
			if reader.calls != 0 {
				t.Fatalf("%s reached analysis reader %d times", name, reader.calls)
			}
		})
	}
}

func TestRaceAnalysisHandlersAllowViewAsGetForSubject(t *testing.T) {
	const raceID = "00000000-0000-4000-8000-000000000001"
	principal := platformsvc.Principal{
		AccountID:      "subject",
		ActorAccountID: "actor",
		Scope:          platformsvc.ScopeWeb,
		ViewAs:         true,
		Permissions:    []string{rbac.PermRaceRead},
	}
	for name, testCase := range map[string]struct {
		target string
		check  func(*testing.T, *raceAnalysisReaderStub)
	}{
		"list": {
			target: "/me/race-analyses?limit=17&offset=3",
			check: func(t *testing.T, reader *raceAnalysisReaderStub) {
				t.Helper()
				if reader.listAccountID != "subject" || reader.listLimit != 17 || reader.listOffset != 3 {
					t.Fatalf("list args = account=%q limit=%d offset=%d, want subject/17/3", reader.listAccountID, reader.listLimit, reader.listOffset)
				}
			},
		},
		"detail": {
			target: "/me/race-analyses/" + raceID,
			check: func(t *testing.T, reader *raceAnalysisReaderStub) {
				t.Helper()
				if reader.detailAccountID != "subject" || reader.detailRaceID != raceID {
					t.Fatalf("detail args = account=%q race=%q, want subject/%q", reader.detailAccountID, reader.detailRaceID, raceID)
				}
			},
		},
		"incident": {
			target: "/me/race-analyses/" + raceID + "/incidents/4",
			check: func(t *testing.T, reader *raceAnalysisReaderStub) {
				t.Helper()
				if reader.incidentAccountID != "subject" || reader.incidentRaceID != raceID || reader.incidentIndex != 4 {
					t.Fatalf("incident args = account=%q race=%q index=%d, want subject/%q/4", reader.incidentAccountID, reader.incidentRaceID, reader.incidentIndex, raceID)
				}
			},
		},
	} {
		t.Run(name, func(t *testing.T) {
			reader := &raceAnalysisReaderStub{}
			srv := &server{raceAnalysisReader: reader, authenticateForTest: func(context.Context, *http.Request) (platformsvc.Principal, error) {
				return principal, nil
			}}
			recorder := raceAnalysisRequest(raceAnalysisMux(srv), testCase.target)
			if recorder.Code != http.StatusOK || recorder.Header().Get("Cache-Control") != "no-store" {
				t.Fatalf("response = %d cache=%q, want 200/no-store", recorder.Code, recorder.Header().Get("Cache-Control"))
			}
			if reader.calls != 1 {
				t.Fatalf("reader calls = %d, want 1", reader.calls)
			}
			testCase.check(t, reader)
		})
	}
}

func TestRaceAnalysisHandlersDenyViewAsHeadBeforeReader(t *testing.T) {
	principal := platformsvc.Principal{AccountID: "subject", Scope: platformsvc.ScopeWeb, ViewAs: true, Permissions: []string{rbac.PermRaceRead}}
	for name, target := range map[string]string{
		"list":     "/me/race-analyses",
		"detail":   "/me/race-analyses/00000000-0000-4000-8000-000000000001",
		"incident": "/me/race-analyses/00000000-0000-4000-8000-000000000001/incidents/0",
	} {
		t.Run(name, func(t *testing.T) {
			reader := &raceAnalysisReaderStub{}
			srv := &server{raceAnalysisReader: reader, authenticateForTest: func(context.Context, *http.Request) (platformsvc.Principal, error) {
				return principal, nil
			}}
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodHead, target, nil)
			request.Header.Set("Authorization", "Bearer test")
			raceAnalysisMux(srv).ServeHTTP(recorder, request)
			if recorder.Code != http.StatusForbidden || recorder.Header().Get("Cache-Control") != "no-store" {
				t.Fatalf("response = %d cache=%q, want 403/no-store", recorder.Code, recorder.Header().Get("Cache-Control"))
			}
			if reader.calls != 0 {
				t.Fatalf("reader calls = %d, want 0", reader.calls)
			}
		})
	}
}

func TestLegacyAnalysisHandlersDenyViewAsBeforeStore(t *testing.T) {
	principal := platformsvc.Principal{AccountID: "subject", Scope: platformsvc.ScopeWeb, ViewAs: true, Permissions: []string{"pithub"}}
	for name, handler := range map[string]http.HandlerFunc{
		"list":   (&server{authenticateForTest: func(context.Context, *http.Request) (platformsvc.Principal, error) { return principal, nil }}).handleListAnalyses,
		"detail": (&server{authenticateForTest: func(context.Context, *http.Request) (platformsvc.Principal, error) { return principal, nil }}).handleGetAnalysis,
	} {
		t.Run(name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodGet, "/analysis/00000000-0000-4000-8000-000000000001", nil)
			handler(recorder, request)
			if recorder.Code != http.StatusForbidden || recorder.Header().Get("Cache-Control") != "no-store" {
				t.Fatalf("response = %d cache=%q, want 403/no-store", recorder.Code, recorder.Header().Get("Cache-Control"))
			}
		})
	}
}

func TestRaceAnalysisHandlersUniformNotFoundAndNoStore(t *testing.T) {
	reader := &raceAnalysisReaderStub{detailErr: platformsvc.ErrNotFound, incidentErr: platformsvc.ErrNotFound}
	srv := &server{raceAnalysisReader: reader, authenticateForTest: func(context.Context, *http.Request) (platformsvc.Principal, error) {
		return raceAnalysisPrincipal(), nil
	}}
	mux := raceAnalysisMux(srv)
	for name, target := range map[string]string{
		"malformed":       "/me/race-analyses/not-a-uuid",
		"missing":         "/me/race-analyses/00000000-0000-4000-8000-000000000001",
		"foreign":         "/me/race-analyses/00000000-0000-4000-8000-000000000002",
		"bad incident id": "/me/race-analyses/not-a-uuid/incidents/0",
		"bad index":       "/me/race-analyses/00000000-0000-4000-8000-000000000001/incidents/20",
		"absent incident": "/me/race-analyses/00000000-0000-4000-8000-000000000001/incidents/0",
	} {
		t.Run(name, func(t *testing.T) {
			recorder := raceAnalysisRequest(mux, target)
			if recorder.Code != http.StatusNotFound || recorder.Body.String() != "not found\n" || recorder.Header().Get("Cache-Control") != "no-store" {
				t.Fatalf("%s = %d/%q cache=%q, want uniform 404/not found/no-store", name, recorder.Code, recorder.Body.String(), recorder.Header().Get("Cache-Control"))
			}
		})
	}
	if reader.calls != 3 { // only valid UUID + valid incident-index routes hit storage
		t.Fatalf("reader calls = %d, want 3", reader.calls)
	}
}

func TestRaceAnalysisHandlersAuthenticatedReaderFailureKeepsNoStore(t *testing.T) {
	reader := &raceAnalysisReaderStub{listErr: errors.New("boom")}
	srv := &server{raceAnalysisReader: reader, authenticateForTest: func(context.Context, *http.Request) (platformsvc.Principal, error) {
		return raceAnalysisPrincipal(), nil
	}}
	recorder := raceAnalysisRequest(raceAnalysisMux(srv), "/me/race-analyses")
	if recorder.Code != http.StatusInternalServerError || recorder.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("reader failure = %d cache=%q, want 500/no-store", recorder.Code, recorder.Header().Get("Cache-Control"))
	}
}
