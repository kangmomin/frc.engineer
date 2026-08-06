# 레이스 분석 리포트는 env 관리자 게이트 + 세션 느슨 연결 + sandbox iframe으로 설계한다

- **날짜**: 2026-08-06
- **이슈**: race-analysis 스킬이 생성하는 세션 분석 HTML을 플랫폼에 업로드/열람하는 기능.
  ① 관리자 판별 방법(스키마 vs env), ② 리포트-레이스 연결 모델(FK vs 느슨 연결),
  ③ 신뢰 불가 HTML의 렌더 격리 방식이 쟁점이었다.
  (계획서: `/workspace/work-log/claude/20260806-race-analysis-upload-plan.md` — Verification Loop 전 기록)

- **결정**:
  1. **관리자 판별은 `PLATFORM_ADMIN_ACCOUNT_IDS` env 허용목록** (`cmd/platform`, 파싱 실패 항목
     warn+skip, fail-closed). `/me` 응답에 `admin: bool` additive 필드. 열람/업로드/삭제 전부
     admin 전용이며 admin 체크는 UUID 파싱·DB 접근보다 앞(존재 오라클 차단, 균일 403).
  2. **`platform.race_analysis`는 races FK 없이 `session_uid` 텍스트로 느슨 연결**
     (008 마이그레이션). 세션당 복수 문서 허용(UNIQUE 없음).
  3. **렌더 격리는 `<iframe sandbox="allow-scripts" srcDoc>` (allow-same-origin 금지)** —
     opaque origin이 localStorage의 플랫폼 토큰을 문서 스크립트로부터 격리한다.
     서버는 HTML을 opaque 저장(새니타이즈 없음), API는 text/html을 절대 서빙하지 않고
     JSON에만 실어 API origin에서의 실행 경로 자체를 없앤다.
  4. 캡: 저장 html ≤256KiB(octet_length CHECK ↔ Go 바이트 상수 미러), 요청 바디 ≤1 MiB,
     검증 실효 방어선은 NUL(\x00) 거부(Postgres TEXT 거부 → 500 방지).

- **결정자**: 합의 (열람 "우선 관리자만"·ANALYSIS 스크린 구현·스킬 업로드는 사용자,
  세부 설계는 에이전트 + 검증 루프[Explore 3종 → Plan 에이전트 → Codex 3관점 2라운드 PROCEED])

- **근거**:
  - env 게이트: `accounts.kind`는 CHECK('user','treasury','fee_sink') + **비-user kind 싱글턴
    UNIQUE 인덱스**(004_economy.sql) + 경제 시스템 계정 조회 키라 'admin' 확장 시 운영자
    실계정이 경제 모델과 충돌. env는 ALLOWED_ORIGINS와 같은 운영 모델("운영자=SQL/env",
    006_feedback.sql 명문)이고 추후 공개 완화가 게이트 제거 한 줄로 끝난다.
  - FK 포기: races 행은 참가자별이다 — 같은 게임 세션 UID에 계정 수만큼 N행(타임스탬프
    프리픽스 상이), 로컬 캡처만으로 분석한 세션은 0행. 어느 행을 가리켜도 의미가 틀리다.
  - sandbox 검증: allow-same-origin 없는 allow-scripts는 opaque origin — 부모
    localStorage/cookie/DOM 접근이 전부 SecurityError. top-nav/popup/form은 기본 차단이라
    추가 토큰 불요. (Plan 에이전트 + Codex 양쪽 검증)

- **기각된 대안** (상세 사유는 계획서 Rejected Decisions 7건):
  - `kind='admin'` 스키마 확장 (싱글턴 인덱스 충돌), `platform.admins` 테이블 (스키마 잔재)
  - `race_id FK` sibling 컨벤션 (N행/0행 문제)
  - `DELETE` REST 메서드 (CORS Allow-Methods GET/POST 고정 → `POST /{id}/delete`, delist 선례)
  - 서버측 HTML 새니타이즈/CSP 주입 (인라인 JS 차트 파괴 + 렌더 격리가 방어선; 공개 완화 시 재검토)
  - 요청 캡 512KiB (JSON 이스케이프 팽창 정합 결함) 및 2 MiB (병리 입력 과보호 — 1 MiB 채택)
  - 세션당 UNIQUE (analysis+drivers 복수 문서가 정상 유스케이스)

- **수용된 잔여 리스크**: iframe 내 외부 무자격 fetch(운영자 생성 문서 전제 — **공개 전환 시
  유일한 재작업 지점**), srcdoc의 부모 CSP 상속(SPA CSP 도입 시 뷰어 재검토 — 코드 주석 표시),
  관리자 web 토큰의 전 권한(전용 스코프 미도입 — 단일 운영자 단순화).

- **수정 내역**: `c5981873`(플랫폼 API + 008), `9fbd36fb`(허브 ANALYSIS 스크린), `7818b319`(스킬)
  - 신규: `internal/platformsvc/migrations/008_race_analysis.sql`, `internal/platformsvc/analysis.go`
    (+테스트), `web/src/hub/screens/Analysis.tsx`
  - 수정: `cmd/platform/main.go`(adminIDs·라우트 4개·핸들러·handleMe), `integration_test.go`
    (TRUNCATE), `web/src/hub/data/{session,platform}.ts`(+테스트), `HubApp.tsx`(admin 분기),
    `.claude/skills/race-analysis/SKILL.md`(Step 5 업로드)
  - 검증: go build/vet/test 그린, web tsc/lint/vitest 그린(무관한 사전 존재 실패 1건 제외)

- **재발 시 대응**: 관리자 판별 방식·FK 연결·새니타이즈·REST 메서드가 후속 리뷰에서
  재제기되면 본 문서와 계획서 Rejected Decisions를 인용하여 즉시 종결한다.
  미래 참가자 공유 구현 시: `session_uid <> ''` 전제 + `source_race_id` 마지막 `_` 뒤 토큰
  **정확 일치 파싱** (LIKE/suffix 금지 — 008 헤더 주석 참조).
