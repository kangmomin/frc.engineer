package platformsvc

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestAnalysisInputValidation(t *testing.T) {
	valid := func() CreateAnalysisRequest {
		return CreateAnalysisRequest{
			SessionUID: "9116587583701622513",
			TrackName:  "Bahrain",
			Title:      "43분을 달리고 0.093초",
			HTML:       "<!DOCTYPE html>\n<html lang=\"ko\">\t<body>리포트</body></html>",
		}
	}
	ok := valid()
	if err := ok.validate(); err != nil {
		t.Fatalf("valid analysis rejected: %v", err)
	}

	// 한 필드씩만 망가뜨려 400 판정을 확인한다.
	bad := []struct {
		name   string
		mutate func(*CreateAnalysisRequest)
	}{
		{"empty title", func(r *CreateAnalysisRequest) { r.Title = "" }},
		{"whitespace title", func(r *CreateAnalysisRequest) { r.Title = "   " }},
		{"over-cap title", func(r *CreateAnalysisRequest) { r.Title = strings.Repeat("가", maxAnalysisTitleLen+1) }},
		{"control char title", func(r *CreateAnalysisRequest) { r.Title = "a\nb" }},
		{"over-cap track", func(r *CreateAnalysisRequest) { r.TrackName = strings.Repeat("가", maxAnalysisTrackLen+1) }},
		{"control char track", func(r *CreateAnalysisRequest) { r.TrackName = "a\x01b" }},
		{"non-digit session uid", func(r *CreateAnalysisRequest) { r.SessionUID = "abc123" }},
		{"over-length session uid", func(r *CreateAnalysisRequest) { r.SessionUID = strings.Repeat("9", maxAnalysisSessionUIDLen+1) }},
		{"empty html", func(r *CreateAnalysisRequest) { r.HTML = "" }},
		{"over-cap html", func(r *CreateAnalysisRequest) { r.HTML = strings.Repeat("x", maxAnalysisHTMLBytes+1) }},
		{"NUL in html", func(r *CreateAnalysisRequest) { r.HTML = "a\x00b" }},
		{"invalid UTF-8 html", func(r *CreateAnalysisRequest) { r.HTML = "a\xffb" }},
	}
	for _, tc := range bad {
		req := valid()
		tc.mutate(&req)
		if err := req.validate(); !errors.Is(err, ErrBadUpload) {
			t.Fatalf("%s: err = %v, want ErrBadUpload", tc.name, err)
		}
	}

	// 경계값: 정확히 상한인 값은 통과한다. html 캡은 바이트 기준(멀티바이트 무관).
	exact := valid()
	exact.Title = strings.Repeat("가", maxAnalysisTitleLen)
	exact.TrackName = strings.Repeat("T", maxAnalysisTrackLen)
	exact.HTML = strings.Repeat("x", maxAnalysisHTMLBytes)
	if err := exact.validate(); err != nil {
		t.Fatalf("exact-cap request rejected: %v", err)
	}

	// sessionUid/trackName은 선택 필드 — 빈 값 통과.
	optional := valid()
	optional.SessionUID = ""
	optional.TrackName = ""
	if err := optional.validate(); err != nil {
		t.Fatalf("empty optional fields rejected: %v", err)
	}

	// title은 TrimSpace 정규화된다.
	trimmed := valid()
	trimmed.Title = "  제목  "
	if err := trimmed.validate(); err != nil {
		t.Fatalf("trim-normalized title rejected: %v", err)
	}
	if trimmed.Title != "제목" {
		t.Fatalf("trimmed title = %q, want %q", trimmed.Title, "제목")
	}
}

func TestAnalysisCreateListGetDelete(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	admin, _ := buyerAccount(t, store, steamA)

	html1 := "<!DOCTYPE html><html lang=\"ko\"><body><h1>격차를 만든 건 전략이 아니었다</h1>한글 본문 — μs 단위</body></html>"
	id1, err := store.CreateAnalysis(ctx, admin, CreateAnalysisRequest{
		SessionUID: "9116587583701622513", TrackName: "Bahrain", Title: "종합 분석", HTML: html1,
	})
	if err != nil {
		t.Fatalf("create analysis 1: %v", err)
	}
	// 같은 세션에 두 번째 문서(드라이버별) — UNIQUE가 없어야 정상.
	id2, err := store.CreateAnalysis(ctx, admin, CreateAnalysisRequest{
		SessionUID: "9116587583701622513", TrackName: "Bahrain", Title: "드라이버별 분석", HTML: "<html><body>2</body></html>",
	})
	if err != nil {
		t.Fatalf("create analysis 2 (same session): %v", err)
	}

	metas, err := store.ListAnalyses(ctx)
	if err != nil {
		t.Fatalf("list analyses: %v", err)
	}
	if len(metas) != 2 {
		t.Fatalf("metas = %d, want 2", len(metas))
	}
	// 최신순.
	if metas[0].ID != id2 || metas[1].ID != id1 {
		t.Fatalf("order = [%s, %s], want newest-first [%s, %s]", metas[0].ID, metas[1].ID, id2, id1)
	}
	for _, m := range metas {
		if _, err := time.Parse(time.RFC3339, m.CreatedAt); err != nil {
			t.Fatalf("createdAt %q not RFC3339: %v", m.CreatedAt, err)
		}
	}

	doc, err := store.GetAnalysis(ctx, id1)
	if err != nil {
		t.Fatalf("get analysis: %v", err)
	}
	if doc.HTML != html1 {
		t.Fatalf("html round-trip mismatch: got %d bytes, want %d", len(doc.HTML), len(html1))
	}
	if doc.Title != "종합 분석" || doc.SessionUID != "9116587583701622513" {
		t.Fatalf("doc meta = %+v", doc.AnalysisMeta)
	}

	if err := store.DeleteAnalysis(ctx, id1); err != nil {
		t.Fatalf("delete analysis: %v", err)
	}
	if _, err := store.GetAnalysis(ctx, id1); !errors.Is(err, ErrNotFound) {
		t.Fatalf("get deleted err = %v, want ErrNotFound", err)
	}
	if err := store.DeleteAnalysis(ctx, id1); !errors.Is(err, ErrNotFound) {
		t.Fatalf("double delete err = %v, want ErrNotFound", err)
	}
}
