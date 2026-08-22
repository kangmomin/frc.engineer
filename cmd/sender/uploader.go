package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"frc.engineer/internal/races"
)

// Platform upload client. The sender is the "device" half of the pairing flow: a
// web-logged-in account mints a short pairing code, the user pastes it here, and
// we exchange it for a long-lived upload-scope token that authorizes POST /races.
//
// The request/response shapes below mirror the platform's JSON contract
// (internal/platformsvc/ingest.go) intentionally — the sender is a client and must
// not import the platform DB package.

const (
	// 페어링 교환·레이스 업로드 API 베이스 (cmd/platform 배포지)
	defaultPlatformBaseURL = "https://pithub.up.railway.app"
	// 사용자 안내용 웹 허브 — 페어링 코드 발급 UI가 있는 프론트엔드 (정적 호스팅, API 아님)
	defaultHubBaseURL = "https://pitwall.up.railway.app"
	uploadHTTPTimeout      = 15 * time.Second
)

type uploadRequest struct {
	SourceRaceID  string        `json:"sourceRaceId"`
	TrackID       int           `json:"trackId"`
	TrackName     string        `json:"trackName"`
	SessionType   string        `json:"sessionType"`
	GameFormat    string        `json:"gameFormat"`
	Laps          []uploadLap   `json:"laps"`
	Setup         *uploadSetup  `json:"setup,omitempty"`
	SchemaVersion int           `json:"schemaVersion,omitempty"`
	Detail        *uploadDetail `json:"detail,omitempty"`
	Pit           *uploadPit    `json:"pit,omitempty"`
}

// uploadPit mirrors platformsvc.UploadPit (sender must not import the platform DB
// package). Sent only when a real measurement exists (PitLaneTimeMs>0).
type uploadPit struct {
	Stops         int    `json:"stops,omitempty"`
	PitLaneTimeMs uint32 `json:"pitLaneTimeMs"`
	StationaryMs  uint32 `json:"stationaryMs,omitempty"`
}

type uploadLap struct {
	LapNumber int    `json:"lapNumber"`
	LapMs     uint32 `json:"lapMs"`
	S1Ms      uint32 `json:"s1Ms"`
	S2Ms      uint32 `json:"s2Ms"`
	S3Ms      uint32 `json:"s3Ms"`
	Tyre      string `json:"tyre,omitempty"`
	Valid     bool   `json:"valid"`
}

type uploadSetup struct {
	FrontWing              int     `json:"frontWing"`
	RearWing               int     `json:"rearWing"`
	OnThrottle             int     `json:"onThrottle"`
	OffThrottle            int     `json:"offThrottle"`
	FrontCamber            float64 `json:"frontCamber"`
	RearCamber             float64 `json:"rearCamber"`
	FrontToe               float64 `json:"frontToe"`
	RearToe                float64 `json:"rearToe"`
	FrontSuspension        int     `json:"frontSuspension"`
	RearSuspension         int     `json:"rearSuspension"`
	FrontAntiRollBar       int     `json:"frontAntiRollBar"`
	RearAntiRollBar        int     `json:"rearAntiRollBar"`
	FrontSuspensionHeight  int     `json:"frontSuspensionHeight"`
	RearSuspensionHeight   int     `json:"rearSuspensionHeight"`
	BrakePressure          int     `json:"brakePressure"`
	BrakeBias              int     `json:"brakeBias"`
	EngineBraking          int     `json:"engineBraking"`
	RearLeftTyrePressure   float64 `json:"rearLeftTyrePressure"`
	RearRightTyrePressure  float64 `json:"rearRightTyrePressure"`
	FrontLeftTyrePressure  float64 `json:"frontLeftTyrePressure"`
	FrontRightTyrePressure float64 `json:"frontRightTyrePressure"`
	Ballast                int     `json:"ballast"`
	FuelLoad               float64 `json:"fuelLoad"`
}

type uploadDetail struct {
	Stints    []uploadStint    `json:"stints,omitempty"`
	Dynamics  []uploadDynamic  `json:"dynamics,omitempty"`
	Events    []uploadEvent    `json:"events,omitempty"`
	Incidents []uploadIncident `json:"incidents,omitempty"`
	// Capture provenance (mirrors platformsvc.UploadDetail): captureStartLap >1
	// flags a late attach; finalizeTrigger records what closed the summary.
	CaptureStartLap int    `json:"captureStartLap,omitempty"`
	FinalizeTrigger string `json:"finalizeTrigger,omitempty"`
}

// uploadIncident (+participant/frame) mirrors dto.IncidentClip and the platform's
// UploadIncident. The block rides inside Detail (race_detail JSONB) and is
// budget-trimmed by races.TrimIncidentsForUpload before mapping.
type uploadIncident struct {
	SessionTimeMs   int64                       `json:"sessionTimeMs"`
	WindowStartMs   int64                       `json:"windowStartMs"`
	FrameIntervalMs int                         `json:"frameIntervalMs"`
	Lap             int                         `json:"lap,omitempty"`
	Collisions      [][2]int                    `json:"collisions"`
	Participants    []uploadIncidentParticipant `json:"participants"`
	Frames          []uploadIncidentFrame       `json:"frames"`
}

type uploadIncidentParticipant struct {
	Idx      int     `json:"idx"`
	Name     string  `json:"name,omitempty"`
	IsPlayer bool    `json:"isPlayer,omitempty"`
	MinDistM float64 `json:"minDistM"`
}

type uploadIncidentFrame struct {
	TMs  int64       `json:"tMs"`
	Cars [][]float64 `json:"cars"`
}

type uploadStint struct {
	Compound    string `json:"compound"`
	Laps        int    `json:"laps"`
	StartLap    int    `json:"startLap,omitempty"`
	EndLap      int    `json:"endLap,omitempty"`
	TireWearPct int    `json:"tireWearPct,omitempty"`
}

type uploadDynamic struct {
	LapNum        int     `json:"lapNum"`
	UndersteerPct float64 `json:"understeerPct"`
	OversteerPct  float64 `json:"oversteerPct"`
	LockupCount   int     `json:"lockupCount"`
	SpinCount     int     `json:"spinCount"`
}

type uploadEvent struct {
	Lap        int    `json:"lap,omitempty"`
	Timestamp  int64  `json:"timestamp,omitempty"`
	Category   string `json:"category"`
	Message    string `json:"message"`
	Severity   string `json:"severity"`
	DriverName string `json:"driverName,omitempty"`
}

type uploadResult struct {
	RaceID     string `json:"raceId"`
	Plausible  bool   `json:"plausible"`
	BestLapMs  uint32 `json:"bestLapMs"`
	StoredLaps int    `json:"storedLaps"`
	ValidLaps  int    `json:"validLaps"`
	Duplicate  bool   `json:"duplicate"`
}

// normalizePlatformBaseURL trims a trailing slash and falls back to the default.
func normalizePlatformBaseURL(raw string) string {
	trimmed := strings.TrimRight(strings.TrimSpace(raw), "/")
	// v4.43.0이 웹 허브 호스트를 API 베이스로 잘못 저장했음 — 로드 시 원복
	if trimmed == "" || trimmed == defaultHubBaseURL {
		return defaultPlatformBaseURL
	}
	return trimmed
}

// fetchPermissions retrieves the paired account's grant nodes from the
// platform (GET /permissions). Advisory only — the caller fail-opens on any
// error. status is 0 for network-class failures (retryable) and the HTTP
// status otherwise (final: old servers 404, expired tokens 401 — all
// fail-open sites, not errors to surface to the user).
func fetchPermissions(ctx context.Context, baseURL, token string) ([]string, int, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, baseURL+"/permissions", nil)
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := (&http.Client{Timeout: uploadHTTPTimeout}).Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, resp.StatusCode, fmt.Errorf("permissions fetch: status %d", resp.StatusCode)
	}
	var out struct {
		Permissions []string `json:"permissions"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<16)).Decode(&out); err != nil {
		return nil, resp.StatusCode, fmt.Errorf("permissions fetch: malformed response")
	}
	return out.Permissions, resp.StatusCode, nil
}

// exchangePairing swaps a pairing code for an upload-scope device token.
// 401 → invalid/expired code; 403 → banned account.
func exchangePairing(ctx context.Context, baseURL, code string) (string, error) {
	body, _ := json.Marshal(map[string]string{"code": strings.TrimSpace(code)})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, baseURL+"/device/exchange", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := (&http.Client{Timeout: uploadHTTPTimeout}).Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	switch resp.StatusCode {
	case http.StatusOK:
		var out struct {
			Token string `json:"token"`
		}
		if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<16)).Decode(&out); err != nil || out.Token == "" {
			return "", fmt.Errorf("pairing exchange: malformed response")
		}
		return out.Token, nil
	case http.StatusUnauthorized:
		return "", fmt.Errorf("페어링 코드가 유효하지 않거나 만료되었습니다")
	case http.StatusForbidden:
		return "", fmt.Errorf("차단된 계정입니다")
	default:
		return "", fmt.Errorf("페어링 실패 (%d)", resp.StatusCode)
	}
}

// uploadRace POSTs a race to the platform with the device token. Returns the parsed
// result on 200 (Duplicate=true is a normal idempotent success). The status code is
// returned so callers can distinguish 409 (retryable in-flight duplicate) from 400
// (malformed/over-size — give up) and 401/403 (re-pair).
func uploadRace(ctx context.Context, baseURL, token string, req *uploadRequest) (*uploadResult, int, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return nil, 0, err
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, baseURL+"/races", bytes.NewReader(body))
	if err != nil {
		return nil, 0, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+token)
	resp, err := (&http.Client{Timeout: uploadHTTPTimeout}).Do(httpReq)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	switch resp.StatusCode {
	case http.StatusOK:
		var out uploadResult
		if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<16)).Decode(&out); err != nil {
			return nil, resp.StatusCode, fmt.Errorf("업로드 응답 파싱 실패")
		}
		return &out, resp.StatusCode, nil
	case http.StatusConflict:
		return nil, resp.StatusCode, fmt.Errorf("업로드 진행 중 (잠시 후 재시도)")
	case http.StatusUnauthorized:
		return nil, resp.StatusCode, fmt.Errorf("인증 만료 — 다시 페어링하세요")
	case http.StatusForbidden:
		// RBAC 도입 후 403은 토큰 문제가 아니라 권한/밴 — 재페어링 안내는 오도다.
		return nil, resp.StatusCode, fmt.Errorf("플랫폼 권한이 없습니다 — 운영자에게 문의하세요")
	case http.StatusTooManyRequests:
		return nil, resp.StatusCode, fmt.Errorf("요청이 많습니다 — 잠시 후 재시도")
	default:
		return nil, resp.StatusCode, fmt.Errorf("업로드 실패 (%d)", resp.StatusCode)
	}
}

// uploadRequestSafetyBytes is the final whole-request guard under the platform's
// 512 KiB body cap: past it the incidents block is dropped entirely so a fat clip
// set can never take the lap upload down with it.
const uploadRequestSafetyBytes = 480 << 10

// uploadMaxDetailEvents mirrors the platform's maxDetailEvents cap. A merged
// summary (pre-restart file + this run, each holding up to the 150-event ring)
// can exceed it, and the server rejects the WHOLE upload past the cap — so the
// mapper keeps only the newest events. Local files stay complete.
const uploadMaxDetailEvents = 200

// buildUploadRequest maps a stored race summary to the platform upload contract.
// Returns (nil, false) when the summary has no rich per-lap detail — the platform
// requires at least one lap, and only rich (Detail-bearing) summaries carry it.
// logger reports incident trimming (nil falls back to slog.Default).
func buildUploadRequest(summary *races.RaceSummary, logger *slog.Logger) (*uploadRequest, bool) {
	if logger == nil {
		logger = slog.Default()
	}
	if summary == nil || summary.Detail == nil || len(summary.Detail.Laps) == 0 {
		return nil, false
	}
	req := &uploadRequest{
		SourceRaceID:  summary.ID,
		TrackID:       int(summary.Track.TrackID),
		TrackName:     summary.Track.TrackName,
		SessionType:   summary.Session.SessionType,
		GameFormat:    summary.GameFormat,
		SchemaVersion: summary.SchemaVersion,
	}
	req.Laps = make([]uploadLap, 0, len(summary.Detail.Laps))
	for _, l := range summary.Detail.Laps {
		req.Laps = append(req.Laps, uploadLap{
			LapNumber: l.LapNumber, LapMs: l.LapMs, S1Ms: l.S1Ms, S2Ms: l.S2Ms, S3Ms: l.S3Ms,
			Tyre: l.Tyre, Valid: l.Valid,
		})
	}
	if s := summary.Detail.Setup; s != nil {
		req.Setup = &uploadSetup{
			FrontWing: s.FrontWing, RearWing: s.RearWing, OnThrottle: s.OnThrottle, OffThrottle: s.OffThrottle,
			FrontCamber: s.FrontCamber, RearCamber: s.RearCamber, FrontToe: s.FrontToe, RearToe: s.RearToe,
			FrontSuspension: s.FrontSuspension, RearSuspension: s.RearSuspension,
			FrontAntiRollBar: s.FrontAntiRollBar, RearAntiRollBar: s.RearAntiRollBar,
			FrontSuspensionHeight: s.FrontSuspensionHeight, RearSuspensionHeight: s.RearSuspensionHeight,
			BrakePressure: s.BrakePressure, BrakeBias: s.BrakeBias, EngineBraking: s.EngineBraking,
			RearLeftTyrePressure: s.RearLeftTyrePressure, RearRightTyrePressure: s.RearRightTyrePressure,
			FrontLeftTyrePressure: s.FrontLeftTyrePressure, FrontRightTyrePressure: s.FrontRightTyrePressure,
			Ballast: s.Ballast, FuelLoad: s.FuelLoad,
		}
	}
	detail := &uploadDetail{
		CaptureStartLap: summary.Detail.CaptureStartLap,
		FinalizeTrigger: summary.Detail.FinalizeTrigger,
	}
	for _, st := range summary.Player.Stints {
		detail.Stints = append(detail.Stints, uploadStint{
			Compound: st.Compound, Laps: st.Laps, StartLap: st.StartLap, EndLap: st.EndLap, TireWearPct: st.TireWearPct,
		})
	}
	for _, d := range summary.Detail.Dynamics {
		detail.Dynamics = append(detail.Dynamics, uploadDynamic{
			LapNum: d.LapNum, UndersteerPct: d.UndersteerPct, OversteerPct: d.OversteerPct,
			LockupCount: d.LockupCount, SpinCount: d.SpinCount,
		})
	}
	events := summary.Detail.Events
	if len(events) > uploadMaxDetailEvents {
		logger.Warn("detail events trimmed for upload cap", "id", summary.ID,
			"dropped", len(events)-uploadMaxDetailEvents, "kept", uploadMaxDetailEvents)
		events = events[len(events)-uploadMaxDetailEvents:]
	}
	for _, e := range events {
		detail.Events = append(detail.Events, uploadEvent{
			Lap: e.Lap, Timestamp: e.Timestamp, Category: e.Category, Message: e.Message,
			Severity: e.Severity, DriverName: e.DriverName,
		})
	}
	trimmedIncidents, droppedClips := races.TrimIncidentsForUpload(summary.Incidents)
	if droppedClips > 0 {
		logger.Warn("incident clips trimmed for upload budget", "id", summary.ID, "droppedClips", droppedClips, "kept", len(trimmedIncidents))
	}
	for _, c := range trimmedIncidents {
		inc := uploadIncident{
			SessionTimeMs:   c.SessionTimeMS,
			WindowStartMs:   c.WindowStartMS,
			FrameIntervalMs: c.FrameIntervalMS,
			Lap:             c.Lap,
			Collisions:      c.Collisions,
		}
		for _, pt := range c.Participants {
			inc.Participants = append(inc.Participants, uploadIncidentParticipant{
				Idx: pt.Idx, Name: pt.Name, IsPlayer: pt.IsPlayer, MinDistM: pt.MinDistM,
			})
		}
		for _, f := range c.Frames {
			inc.Frames = append(inc.Frames, uploadIncidentFrame{TMs: f.TMS, Cars: f.Cars})
		}
		detail.Incidents = append(detail.Incidents, inc)
	}
	if len(detail.Stints) > 0 || len(detail.Dynamics) > 0 || len(detail.Events) > 0 || len(detail.Incidents) > 0 ||
		detail.CaptureStartLap > 0 || detail.FinalizeTrigger != "" {
		req.Detail = detail
	}
	// 실측 피트로스만 업로드(PitLaneTimeMS>0). 추정치(stops*22000)는 평균을 오염시키므로 제외.
	if d := summary.Debrief; d != nil && d.Pit.PitLaneTimeMS > 0 {
		req.Pit = &uploadPit{
			Stops:         d.Pit.Stops,
			PitLaneTimeMs: d.Pit.PitLaneTimeMS,
			StationaryMs:  d.Pit.StationaryTimeMS,
		}
	}
	// 최종 안전망: 전체 요청이 안전 상한을 넘으면 incidents만 통째로 내려 랩 업로드를 지킨다.
	if req.Detail != nil && len(req.Detail.Incidents) > 0 {
		if raw, err := json.Marshal(req); err != nil || len(raw) > uploadRequestSafetyBytes {
			logger.Warn("incidents dropped from upload (request over safety cap)", "id", summary.ID, "clips", len(req.Detail.Incidents))
			req.Detail.Incidents = nil
			if len(req.Detail.Stints) == 0 && len(req.Detail.Dynamics) == 0 && len(req.Detail.Events) == 0 &&
				req.Detail.CaptureStartLap == 0 && req.Detail.FinalizeTrigger == "" {
				req.Detail = nil
			}
		}
	}
	return req, true
}
