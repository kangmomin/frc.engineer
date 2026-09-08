package platformsvc

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"time"

	"github.com/google/uuid"
)

var ErrLeaderboardQuery = errors.New("platformsvc: invalid leaderboard query")

// LeaderboardRecord contains only public timing and account display data.
type LeaderboardRecord struct {
	Rank            int      `json:"rank"`
	AccountID       string   `json:"accountId"`
	Persona         string   `json:"persona"`
	ScoreMS         int      `json:"scoreMs"`
	You             bool     `json:"you"`
	SectorsMS       *[3]int  `json:"sectorsMs"`
	Laps            *int     `json:"laps"`
	Tyre            *string  `json:"tyre"`
	Consistency     *float64 `json:"consistency"`
	StddevMS        *float64 `json:"stddevMs"`
	WithinOneSecond *float64 `json:"withinOneSecond"`
}

type LeaderboardRecords struct {
	Board              string              `json:"board"`
	Rows               []LeaderboardRecord `json:"rows"`
	Total              int                 `json:"total"`
	LeaderMS           *int                `json:"leaderMs"`
	Viewer             *LeaderboardRecord  `json:"viewer"`
	ViewerGapToTop10MS *int                `json:"viewerGapToTop10Ms"`
	NextCursor         *string             `json:"nextCursor"`
	PreviousCursor     *string             `json:"previousCursor"`
	AnchorFound        bool                `json:"anchorFound"`
	AsOf               time.Time           `json:"asOf"`
}

type LeaderboardQuery struct {
	TrackID int
	Format  string
	Board   string
	Limit   int
	Cursor  string
	Around  string // Resolved account UUID; HTTP resolves "me" before calling the store.
}

type recordCursor struct {
	Version    int       `json:"v"`
	Board      string    `json:"board"`
	TrackID    int       `json:"track"`
	Format     string    `json:"format"`
	Limit      int       `json:"limit"`
	AsOf       time.Time `json:"asOf"`
	Direction  string    `json:"direction"`
	ScoreMS    int       `json:"scoreMs"`
	UploadedAt time.Time `json:"uploadedAt"`
	AccountID  string    `json:"accountId"`
}

func (q LeaderboardQuery) validate() (recordCursor, error) {
	c := recordCursor{Version: 1, Board: q.Board, TrackID: q.TrackID, Format: q.Format, Limit: q.Limit,
		AsOf: time.Now().UTC().Truncate(time.Microsecond), UploadedAt: time.Unix(0, 0).UTC(), AccountID: uuid.Nil.String()}
	if (q.Board != "pb" && q.Board != "tt" && q.Board != "pace") || q.Format == "" || q.TrackID < math.MinInt32 || q.TrackID > math.MaxInt32 || q.Limit < 1 || q.Limit > leaderboardLimit || len(q.Cursor) > 1024 || (q.Cursor != "" && q.Around != "") {
		return c, ErrLeaderboardQuery
	}
	if q.Around != "" {
		if _, err := uuid.Parse(q.Around); err != nil {
			return c, ErrLeaderboardQuery
		}
	}
	if q.Cursor == "" {
		return c, nil
	}
	data, err := base64.RawURLEncoding.Strict().DecodeString(q.Cursor)
	if err != nil {
		return c, ErrLeaderboardQuery
	}
	d := json.NewDecoder(bytes.NewReader(data))
	d.DisallowUnknownFields()
	// Decode into a zero value so missing fields cannot inherit first-page defaults.
	var parsed recordCursor
	if err = d.Decode(&parsed); err != nil {
		return c, ErrLeaderboardQuery
	}
	if err = d.Decode(new(any)); err != io.EOF {
		return c, ErrLeaderboardQuery
	}
	c = parsed
	if c.Version != 1 || c.Board != q.Board || c.TrackID != q.TrackID || c.Format != q.Format || c.Limit != q.Limit || (c.Direction != "next" && c.Direction != "previous") || c.ScoreMS <= 0 || c.ScoreMS > math.MaxInt32 || c.AsOf.IsZero() || c.UploadedAt.IsZero() || c.AsOf.Nanosecond()%1000 != 0 || c.UploadedAt.Nanosecond()%1000 != 0 || c.UploadedAt.After(c.AsOf) {
		return c, ErrLeaderboardQuery
	}
	id, err := uuid.Parse(c.AccountID)
	if err != nil {
		return c, ErrLeaderboardQuery
	}
	c.AccountID = id.String()
	if c.Board == "pace" && !c.UploadedAt.Equal(time.Unix(0, 0)) {
		return c, ErrLeaderboardQuery
	}
	return c, nil
}

// LeaderboardRecords ranks the full eligible population before applying a keyset
// boundary. One SQL statement supplies the page and all global/viewer metadata.
// AsOf excludes later upload timestamps, but is not an immutable snapshot:
// earlier in-flight uploads, bans and deletions remain visible on subsequent pages.
func (s *Store) LeaderboardRecords(ctx context.Context, q LeaderboardQuery, viewerID string) (*LeaderboardRecords, error) {
	c, err := q.validate()
	if err != nil {
		return nil, err
	}
	if q.Around != "" {
		id, _ := uuid.Parse(q.Around)
		q.Around = id.String()
	}
	population := `
 representatives AS (
  SELECT DISTINCT ON (account_id) account_id, persona, lap_ms AS score_ms, uploaded_at,
   ARRAY[s1_ms,s2_ms,s3_ms] AS sectors_ms, NULL::int AS laps, NULL::text AS tyre,
   NULL::float8 AS consistency, NULL::float8 AS sd, NULL::float8 AS within_one_second
  FROM eligible ORDER BY account_id,lap_ms,uploaded_at,race_id,lap_id
 )`
	if q.Board == "pace" {
		population = `
 pace_laps AS (
  SELECT *, (avg(lap_ms) OVER (PARTITION BY account_id))::int AS score_ms FROM eligible
 ), stats AS (
  SELECT account_id,persona,score_ms,count(*)::int AS laps,
   stddev_pop(lap_ms)::float8 AS sd,mode() WITHIN GROUP (ORDER BY tyre) AS tyre,
   count(*) FILTER (WHERE abs(lap_ms-score_ms)<=1000)::float8/count(*) AS within_one_second
  FROM pace_laps GROUP BY account_id,persona,score_ms HAVING count(*) >= 5
 ), representatives AS (
  SELECT s.*, '1970-01-01T00:00:00Z'::timestamptz AS uploaded_at, NULL::int[] AS sectors_ms,
   greatest(0,1-s.sd/nullif(s.score_ms,0))::float8 AS consistency
  FROM stats s
 )`
	}
	// These SQL fragments are fixed program constants, never cursor/query text.
	pageWhere := "true"
	pageOrder := "score_ms,uploaded_at,account_id"
	if q.Around != "" {
		pageWhere = `rank >= (SELECT greatest(1,least(rank-$4::int/2,(SELECT count(*) FROM ranked)-$4::int+1)) FROM ranked WHERE account_id::text=$10)`
	} else if q.Cursor != "" {
		pageWhere = "(score_ms,uploaded_at,account_id) > (boundary.score,boundary.stamp,boundary.id)"
		if c.Direction == "previous" {
			pageWhere = "(score_ms,uploaded_at,account_id) < (boundary.score,boundary.stamp,boundary.id)"
			pageOrder = "score_ms DESC,uploaded_at DESC,account_id DESC"
		}
	}
	query := `
 WITH boundary AS (SELECT $7::int AS score,$8::timestamptz AS stamp,$9::uuid AS id), eligible AS MATERIALIZED (
  SELECT r.account_id,a.persona,l.lap_ms,l.s1_ms,l.s2_ms,l.s3_ms,l.tyre,
   r.uploaded_at,r.id AS race_id,l.id AS lap_id
  FROM platform.laps l JOIN platform.races r ON r.id=l.race_id
  JOIN platform.accounts a ON a.id=r.account_id
  WHERE r.track_id=$1 AND r.game_format=$2 AND r.plausible AND l.valid AND r.uploaded_at<=$3
   AND ($6::text<>'tt' OR lower(btrim(r.session_type))='time trial')
   AND NOT EXISTS (SELECT 1 FROM platform.account_bans b WHERE b.account_id=r.account_id)
 ), ` + population + `, ranked AS MATERIALIZED (
  SELECT *,row_number() OVER (ORDER BY score_ms,uploaded_at,account_id)::int AS rank FROM representatives
 ), records AS MATERIALIZED (
  SELECT *,jsonb_build_object('rank',rank,'accountId',account_id,'persona',persona,'scoreMs',score_ms,
   'you',account_id::text=$5,'sectorsMs',sectors_ms,'laps',laps,'tyre',tyre,
   'consistency',consistency,'stddevMs',sd,'withinOneSecond',within_one_second) AS record FROM ranked
 ), page AS (
  SELECT records.* FROM records CROSS JOIN boundary WHERE ` + pageWhere + ` ORDER BY ` + pageOrder + ` LIMIT $4
 )
 SELECT coalesce((SELECT jsonb_agg(jsonb_build_object('record',record,'uploadedAt',uploaded_at) ORDER BY rank) FROM page),'[]'::jsonb),
  (SELECT count(*) FROM ranked), (SELECT score_ms FROM ranked WHERE rank=1),
  (SELECT record FROM records WHERE account_id::text=$5),
  (SELECT greatest(v.score_ms-t.score_ms,0) FROM ranked v CROSS JOIN ranked t WHERE v.account_id::text=$5 AND t.rank=10),
  EXISTS(SELECT 1 FROM ranked WHERE account_id::text=$10)`
	var pageJSON, viewerJSON []byte
	result := &LeaderboardRecords{Board: q.Board, Rows: []LeaderboardRecord{}, AsOf: c.AsOf}
	err = s.pool.QueryRow(ctx, query, q.TrackID, q.Format, c.AsOf, q.Limit, viewerID, q.Board, c.ScoreMS, c.UploadedAt, c.AccountID, q.Around).Scan(
		&pageJSON, &result.Total, &result.LeaderMS, &viewerJSON, &result.ViewerGapToTop10MS, &result.AnchorFound)
	if err != nil {
		return nil, fmt.Errorf("platformsvc: records leaderboard: %w", err)
	}
	var page []struct {
		Record     LeaderboardRecord `json:"record"`
		UploadedAt time.Time         `json:"uploadedAt"`
	}
	if err = json.Unmarshal(pageJSON, &page); err != nil {
		return nil, fmt.Errorf("platformsvc: decode records: %w", err)
	}
	if len(viewerJSON) > 0 {
		if err = json.Unmarshal(viewerJSON, &result.Viewer); err != nil {
			return nil, fmt.Errorf("platformsvc: decode viewer: %w", err)
		}
	}
	for _, entry := range page {
		result.Rows = append(result.Rows, entry.Record)
	}
	makeCursor := func(i int, direction string) *string {
		boundary := c
		boundary.Direction = direction
		boundary.ScoreMS = page[i].Record.ScoreMS
		boundary.UploadedAt = page[i].UploadedAt
		boundary.AccountID = page[i].Record.AccountID
		data, _ := json.Marshal(boundary)
		encoded := base64.RawURLEncoding.EncodeToString(data)
		return &encoded
	}
	if len(page) > 0 {
		if page[0].Record.Rank > 1 {
			result.PreviousCursor = makeCursor(0, "previous")
		}
		if page[len(page)-1].Record.Rank < result.Total {
			result.NextCursor = makeCursor(len(page)-1, "next")
		}
	}
	return result, nil
}
