package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
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
	defaultPlatformBaseURL = "https://pitwall.up.railway.app"
	// v4.42.0까지 기본값이 잘못된 호스트였고 config.json에 영속화됨 — 로드 시 신 기본값으로 치환
	legacyPlatformBaseURL = "https://pithub.up.railway.app"
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
	Stints   []uploadStint   `json:"stints,omitempty"`
	Dynamics []uploadDynamic `json:"dynamics,omitempty"`
	Events   []uploadEvent   `json:"events,omitempty"`
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
	if trimmed == "" || trimmed == legacyPlatformBaseURL {
		return defaultPlatformBaseURL
	}
	return trimmed
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
	case http.StatusUnauthorized, http.StatusForbidden:
		return nil, resp.StatusCode, fmt.Errorf("인증 만료 — 다시 페어링하세요")
	case http.StatusTooManyRequests:
		return nil, resp.StatusCode, fmt.Errorf("요청이 많습니다 — 잠시 후 재시도")
	default:
		return nil, resp.StatusCode, fmt.Errorf("업로드 실패 (%d)", resp.StatusCode)
	}
}

// buildUploadRequest maps a stored race summary to the platform upload contract.
// Returns (nil, false) when the summary has no rich per-lap detail — the platform
// requires at least one lap, and only rich (Detail-bearing) summaries carry it.
func buildUploadRequest(summary *races.RaceSummary) (*uploadRequest, bool) {
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
	detail := &uploadDetail{}
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
	for _, e := range summary.Detail.Events {
		detail.Events = append(detail.Events, uploadEvent{
			Lap: e.Lap, Timestamp: e.Timestamp, Category: e.Category, Message: e.Message,
			Severity: e.Severity, DriverName: e.DriverName,
		})
	}
	if len(detail.Stints) > 0 || len(detail.Dynamics) > 0 || len(detail.Events) > 0 {
		req.Detail = detail
	}
	return req, true
}
