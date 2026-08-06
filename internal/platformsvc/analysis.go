package platformsvc

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

// Analysis limits — DDL(008_race_analysis.sql)의 CHECK를 미러한다.
// html만 바이트 상한(octet_length 미러)이고 나머지는 룬 상한(char_length 미러).
const (
	maxAnalysisTitleLen      = 120       // 룬. 내러티브형 제목이라 maxTitleLen(80)보다 넉넉하게
	maxAnalysisTrackLen      = 64        // 룬
	maxAnalysisSessionUIDLen = 20        // uint64 십진 최대 자릿수
	maxAnalysisHTMLBytes     = 256 << 10 // 바이트
)

var analysisSessionUIDRe = regexp.MustCompile(`^[0-9]{0,20}$`)

// AnalysisMeta is one report row without its document body (GET /analysis).
// html 필드 자체가 없는 타입이라 목록 응답이 실수로 본문을 실을 수 없다.
type AnalysisMeta struct {
	ID         string `json:"id"`
	SessionUID string `json:"sessionUid,omitempty"`
	TrackName  string `json:"trackName,omitempty"`
	Title      string `json:"title"`
	CreatedAt  string `json:"createdAt"`
}

// AnalysisDoc is a full report (GET /analysis/{id}).
type AnalysisDoc struct {
	AnalysisMeta
	HTML string `json:"html"`
}

// CreateAnalysisRequest is the POST /analysis body.
type CreateAnalysisRequest struct {
	SessionUID string `json:"sessionUid"`
	TrackName  string `json:"trackName"`
	Title      string `json:"title"`
	HTML       string `json:"html"`
}

// validate checks and normalizes an analysis upload.
func (r *CreateAnalysisRequest) validate() error {
	r.Title = strings.TrimSpace(r.Title)
	if r.Title == "" || len([]rune(r.Title)) > maxAnalysisTitleLen || hasControlChar(r.Title) {
		return ErrBadUpload
	}
	r.TrackName = strings.TrimSpace(r.TrackName)
	if len([]rune(r.TrackName)) > maxAnalysisTrackLen || hasControlChar(r.TrackName) {
		return ErrBadUpload
	}
	r.SessionUID = strings.TrimSpace(r.SessionUID)
	if !analysisSessionUIDRe.MatchString(r.SessionUID) {
		return ErrBadUpload
	}
	// html은 opaque 문서다 — \n\t가 정상이므로 제어문자 검사는 하지 않는다.
	// 실효 방어선은 NUL 거부다: JSON \u0000은 유효 UTF-8 NUL 바이트로 디코드되는데
	// Postgres TEXT가 이를 거부하므로 여기서 걸러야 500이 아닌 400이 된다.
	// ValidString은 HTTP 경로에선 항상 통과한다(encoding/json이 invalid UTF-8을
	// U+FFFD로 치환) — 스토어를 직접 호출하는 비-HTTP 경로 방어용으로만 의미가 있다.
	if len(r.HTML) == 0 || len(r.HTML) > maxAnalysisHTMLBytes ||
		strings.ContainsRune(r.HTML, 0) || !utf8.ValidString(r.HTML) {
		return ErrBadUpload
	}
	return nil
}

// CreateAnalysis stores one report and returns its id.
func (s *Store) CreateAnalysis(ctx context.Context, uploadedBy string, req CreateAnalysisRequest) (string, error) {
	if err := req.validate(); err != nil {
		return "", err
	}
	var id string
	if err := s.pool.QueryRow(ctx, `
		INSERT INTO platform.race_analysis (uploaded_by, session_uid, track_name, title, html)
		VALUES ($1, $2, $3, $4, $5) RETURNING id`,
		uploadedBy, req.SessionUID, req.TrackName, req.Title, req.HTML,
	).Scan(&id); err != nil {
		return "", fmt.Errorf("platformsvc: insert analysis: %w", err)
	}
	return id, nil
}

// ListAnalyses returns report metadata (no bodies), newest first.
func (s *Store) ListAnalyses(ctx context.Context) ([]AnalysisMeta, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, session_uid, track_name, title, created_at
		FROM platform.race_analysis
		ORDER BY created_at DESC
		LIMIT $1`,
		browseLimit,
	)
	if err != nil {
		return nil, fmt.Errorf("platformsvc: list analyses: %w", err)
	}
	defer rows.Close()
	out := []AnalysisMeta{}
	for rows.Next() {
		var m AnalysisMeta
		var created time.Time
		if err := rows.Scan(&m.ID, &m.SessionUID, &m.TrackName, &m.Title, &created); err != nil {
			return nil, fmt.Errorf("platformsvc: scan analysis: %w", err)
		}
		m.CreatedAt = created.Format(time.RFC3339)
		out = append(out, m)
	}
	return out, rows.Err()
}

// GetAnalysis returns one full report.
func (s *Store) GetAnalysis(ctx context.Context, id string) (*AnalysisDoc, error) {
	var d AnalysisDoc
	var created time.Time
	err := s.pool.QueryRow(ctx, `
		SELECT id, session_uid, track_name, title, created_at, html
		FROM platform.race_analysis
		WHERE id = $1`,
		id,
	).Scan(&d.ID, &d.SessionUID, &d.TrackName, &d.Title, &created, &d.HTML)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("platformsvc: get analysis: %w", err)
	}
	d.CreatedAt = created.Format(time.RFC3339)
	return &d, nil
}

// DeleteAnalysis removes one report.
func (s *Store) DeleteAnalysis(ctx context.Context, id string) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM platform.race_analysis WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("platformsvc: delete analysis: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
