package main

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"frc.engineer/internal/platformsvc"
	"frc.engineer/internal/rbac"
)

type analysisShareStub struct {
	calls        int
	err          error
	includeSetup bool
}

func (s *analysisShareStub) GetMyRaceAnalysisShare(context.Context, string, string) (*platformsvc.RaceAnalysisShare, error) {
	s.calls++
	return nil, s.err
}
func (s *analysisShareStub) SetMyRaceAnalysisShare(_ context.Context, _, _ string, setup bool) (*platformsvc.RaceAnalysisShare, error) {
	s.calls++
	s.includeSetup = setup
	return &platformsvc.RaceAnalysisShare{Token: "00000000-0000-4000-8000-000000000001", IncludeSetup: setup}, s.err
}
func (s *analysisShareStub) DeleteMyRaceAnalysisShare(context.Context, string, string) error {
	s.calls++
	return s.err
}
func (s *analysisShareStub) GetSharedRaceAnalysis(context.Context, string) (*platformsvc.SharedRaceAnalysis, error) {
	s.calls++
	return &platformsvc.SharedRaceAnalysis{}, s.err
}
func (s *analysisShareStub) GetSharedRaceAnalysisIncident(context.Context, string, int) (*platformsvc.RaceAnalysisIncidentReplay, error) {
	s.calls++
	return &platformsvc.RaceAnalysisIncidentReplay{}, s.err
}

func TestRaceAnalysisShareManagementAuth(t *testing.T) {
	for name, principal := range map[string]platformsvc.Principal{
		"reader":        {Scope: platformsvc.ScopeWeb, Permissions: []string{rbac.PermRaceRead}},
		"editor":        {Scope: platformsvc.ScopeWeb, Permissions: []string{rbac.PermRaceRead, rbac.PermRaceUpdate}},
		"view-as":       {Scope: platformsvc.ScopeWeb, Permissions: []string{"pithub"}, ViewAs: true},
		"uploader":      {Scope: platformsvc.ScopeUpload, Permissions: []string{"pithub"}},
		"banned":        {Scope: platformsvc.ScopeWeb, Permissions: []string{"pithub"}, Banned: true},
		"no-permission": {Scope: platformsvc.ScopeWeb},
	} {
		for _, method := range []string{http.MethodGet, http.MethodHead, http.MethodPost, http.MethodDelete} {
			t.Run(name+"/"+method, func(t *testing.T) {
				store := &analysisShareStub{}
				principal.AccountID = "owner"
				srv := &server{raceAnalysisShares: store, authenticateForTest: func(context.Context, *http.Request) (platformsvc.Principal, error) { return principal, nil }}
				mux := http.NewServeMux()
				registerRaceAnalysisShareRoutes(mux, srv)
				req := httptest.NewRequest(method, "/me/race-analyses/00000000-0000-4000-8000-000000000001/share", strings.NewReader(`{"includeSetup":true}`))
				req.Header.Set("Authorization", "Bearer test")
				rec := httptest.NewRecorder()
				mux.ServeHTTP(rec, req)
				allowed := name == "editor" || name == "reader" && (method == http.MethodGet || method == http.MethodHead)
				want := http.StatusForbidden
				if allowed {
					want = http.StatusOK
					if method == http.MethodDelete {
						want = http.StatusNoContent
					}
				}
				if rec.Code != want || rec.Header().Get("Cache-Control") != "no-store" {
					t.Fatalf("response %d / %s", rec.Code, rec.Body.String())
				}
				if !allowed && store.calls != 0 {
					t.Fatal("denied principal reached share storage")
				}
				if allowed && method == http.MethodPost && !store.includeSetup {
					t.Fatal("setup consent was not forwarded")
				}
			})
		}
	}
	for _, method := range []string{http.MethodGet, http.MethodPost, http.MethodDelete} {
		srv := &server{}
		rec := httptest.NewRecorder()
		srv.handleMyRaceAnalysisShare(rec, httptest.NewRequest(method, "/me/race-analyses/bad/share", nil))
		if rec.Code != http.StatusUnauthorized || rec.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("anonymous mutation/read: %d", rec.Code)
		}
	}
}

func TestRaceAnalysisShareAnonymousReadsAndErrors(t *testing.T) {
	for _, suffix := range []string{"", "/incidents/0"} {
		for _, storeErr := range []error{nil, platformsvc.ErrNotFound, errors.New("storage failed")} {
			store := &analysisShareStub{err: storeErr}
			srv := &server{raceAnalysisShares: store, authenticateForTest: func(context.Context, *http.Request) (platformsvc.Principal, error) {
				t.Fatal("public link attempted authentication")
				return platformsvc.Principal{}, nil
			}}
			mux := http.NewServeMux()
			registerRaceAnalysisShareRoutes(mux, srv)
			rec := httptest.NewRecorder()
			mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/shared/race-analyses/00000000-0000-4000-8000-000000000001"+suffix, nil))
			want := 200
			if errors.Is(storeErr, platformsvc.ErrNotFound) {
				want = 404
			} else if storeErr != nil {
				want = 500
			}
			if rec.Code != want || rec.Header().Get("Cache-Control") != "no-store" {
				t.Fatalf("public response %d / %s", rec.Code, rec.Body.String())
			}
		}
	}
	store := &analysisShareStub{}
	srv := &server{raceAnalysisShares: store}
	mux := http.NewServeMux()
	registerRaceAnalysisShareRoutes(mux, srv)
	for _, path := range []string{"bad", "bad/incidents/0", "00000000-0000-4000-8000-000000000001/incidents/20"} {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/shared/race-analyses/"+path, nil))
		if rec.Code != 404 || store.calls != 0 {
			t.Fatalf("invalid token/index: %d calls=%d", rec.Code, store.calls)
		}
	}
}

func TestRaceAnalysisShareStrictConsentAndOwnership(t *testing.T) {
	for _, body := range []string{`{}`, `null`, `[]`, `{"includeSetup":null}`, `{"includeSetup":"false"}`, `{"includeSetup":false,"extra":true}`, `{"includeSetup":true} {}`} {
		if _, err := decodeRaceAnalysisShare(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body))); err == nil {
			t.Fatalf("accepted invalid consent: %s", body)
		}
	}
	for _, visible := range []string{"true", "false"} {
		value, err := decodeRaceAnalysisShare(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"includeSetup":`+visible+`}`)))
		if err != nil || value != (visible == "true") {
			t.Fatalf("consent %s: %v %v", visible, value, err)
		}
	}
	store := &analysisShareStub{err: platformsvc.ErrNotFound}
	srv := &server{raceAnalysisShares: store, authenticateForTest: func(context.Context, *http.Request) (platformsvc.Principal, error) {
		return platformsvc.Principal{AccountID: "owner", Scope: platformsvc.ScopeWeb, Permissions: []string{"pithub"}}, nil
	}}
	mux := http.NewServeMux()
	registerRaceAnalysisShareRoutes(mux, srv)
	req := httptest.NewRequest(http.MethodPost, "/me/race-analyses/00000000-0000-4000-8000-000000000001/share", strings.NewReader("bad json"))
	req.Header.Set("Authorization", "Bearer test")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != 404 || store.calls != 1 {
		t.Fatalf("foreign race disclosed body validation: %d", rec.Code)
	}
}

func TestRaceAnalysisShareRevokeCORS(t *testing.T) {
	request := httptest.NewRequest(http.MethodOptions, "/me/race-analyses/id/share", nil)
	request.Header.Set("Origin", "https://hub.test")
	request.Header.Set("Access-Control-Request-Method", http.MethodDelete)
	rec := httptest.NewRecorder()
	withCORS(map[string]struct{}{"https://hub.test": {}}, http.HandlerFunc(func(http.ResponseWriter, *http.Request) { t.Fatal("preflight reached handler") })).ServeHTTP(rec, request)
	if rec.Code != 204 || !strings.Contains(rec.Header().Get("Access-Control-Allow-Methods"), "DELETE") || rec.Header().Get("Access-Control-Allow-Origin") != "https://hub.test" {
		t.Fatalf("revoke preflight: %v", rec.Result().Header)
	}
}

func TestRaceAnalysisFilterParameters(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/me/race-analyses?search=Monza&gameFormat=F1+26&sessionType=Race&from=2026-09-03T15:00:00Z&before=2026-09-04T15:00:00Z", nil)
	if _, _, ok := raceAnalysisPagination(request); !ok {
		t.Fatal("filter query rejected by pagination")
	}
	filter, ok := raceAnalysisFilters(request)
	if !ok || filter.Search != "Monza" || filter.GameFormat != "F1 26" || filter.SessionType != "Race" || filter.Before.Sub(*filter.From) != 24*time.Hour {
		t.Fatalf("filter: %+v", filter)
	}
	for _, query := range []string{"from=bad", "from=", "before=2026-09-04", "from=2026-09-05T00:00:00Z&before=2026-09-04T00:00:00Z", "search=" + strings.Repeat("x", 65)} {
		if _, ok := raceAnalysisFilters(httptest.NewRequest(http.MethodGet, "/me/race-analyses?"+query, nil)); ok {
			t.Fatalf("accepted %s", query)
		}
	}
	if _, _, ok := raceAnalysisPagination(httptest.NewRequest(http.MethodGet, "/me/race-analyses?search=a&search=b", nil)); ok {
		t.Fatal("duplicate filter accepted")
	}
}
