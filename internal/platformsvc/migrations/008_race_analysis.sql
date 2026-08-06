-- 008_race_analysis.sql — 운영자가 올리는 레이스별 분석 리포트 (단일 파일 HTML).
--
-- Trust model (005_race_detail의 연장): html은 opaque하게 저장하고 어떤 서버 파생
-- 값에도 쓰지 않는다. 열람/업로드는 당분간 관리자 전용이며 게이트는 스키마가 아니라
-- cmd/platform의 env(PLATFORM_ADMIN_ACCOUNT_IDS)다 — 추후 공개/참가자 공유로 완화할
-- 때 스키마 변경 없이 핸들러 권한만 바뀐다. 렌더 측은 sandbox iframe(opaque origin)
-- 격리를 전제로 하므로 서버는 새니타이즈하지 않는다.
--
-- races FK를 두지 않는 이유: races 행은 참가자별이다(같은 게임 세션 UID에 계정 수만큼
-- N행, source_race_id의 타임스탬프 프리픽스는 참가자마다 다름). 로컬 캡처만으로 분석한
-- 세션은 0행일 수도 있다. 어느 한 행을 가리켜도 의미가 틀리므로 session_uid 텍스트로
-- 느슨하게 연결한다. 추후 참가자 공유 매칭은 반드시 session_uid <> '' 전제 +
-- source_race_id의 마지막 '_' 뒤 토큰과의 "정확 일치 파싱"으로 할 것 — 단순 suffix/LIKE
-- 비교 금지('_'는 LIKE 와일드카드, 빈 session_uid는 전체 오매칭 → 권한 누출).
--
-- html만 octet_length인 이유: analysis.go의 검사가 바이트 상한(maxAnalysisHTMLBytes)
-- 이라 그대로 미러한다. title/track은 여느 텍스트 필드처럼 룬↔char_length 미러.
CREATE TABLE platform.race_analysis (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    uploaded_by UUID NOT NULL REFERENCES platform.accounts(id),
    session_uid TEXT NOT NULL DEFAULT '',
    track_name  TEXT NOT NULL DEFAULT '',
    title       TEXT NOT NULL,
    html        TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT race_analysis_title_len_chk CHECK (char_length(title) BETWEEN 1 AND 120),
    CONSTRAINT race_analysis_track_len_chk CHECK (char_length(track_name) <= 64),
    CONSTRAINT race_analysis_session_chk   CHECK (session_uid ~ '^[0-9]{0,20}$'),
    CONSTRAINT race_analysis_html_len_chk  CHECK (octet_length(html) BETWEEN 1 AND 262144)
);

-- 목록은 최신순 고정 (ListAnalyses).
CREATE INDEX race_analysis_created_idx ON platform.race_analysis (created_at DESC);
