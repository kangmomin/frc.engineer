---
name: race-analysis
description: 특정 세션(레이스)의 데이터를 플랫폼 DB(pithub) 또는 로컬 RaceSummary JSON에서 수집해 종합 분석 HTML 리포트를 생성한다. "레이스 분석해줘", "이 세션 종합 분석", 특정 레이스의 랩타임·전략·섹터·사고 원인 분석 요청 시 사용.
user-invocable: true
---

# Race Analysis — 세션 종합 분석 리포트

특정 레이스 한 건을 데이터로 완전 분해해 내러티브형 HTML 리포트를 만든다.
선례 산출물: `docs/race-analysis-20260725-monza.html`(종합) + `docs/race-drivers-20260725-monza.html`(드라이버별).
**리포트의 신뢰 규율이 이 스킬의 핵심이다** — 모든 분해는 합계와 재조정(reconcile)되어야 하고,
설명 못 하는 것은 숨기지 않고 "미해명 항목"으로 남긴다.

## Step 0: 도구 준비

- 플랫폼 DB 조회가 필요하면 `ToolSearch("select:mcp__pithub-db__query")`로 로드한다.
  - 입력은 `{sql: "..."}` 하나. **프로덕션 DB다 — SELECT만 실행한다** (도구 자체도 read-only지만
    INSERT/UPDATE/DDL 시도 자체를 금지). 탐색 쿼리에는 항상 `LIMIT`.
- 로컬 파일 분석이면 DB 없이 진행 가능.

## Step 1: 대상 세션 해석

args 형태별 해석 (모호하면 후보 목록을 보여주고 사용자에게 확인):

| 입력 | 해석 |
|---|---|
| UUID | `platform.races.id` |
| 숫자 문자열(세션 UID) | `WHERE source_race_id = '<v>'` — 여러 계정이 같은 세션을 올릴 수 있음(멀티플레이). 복수면 계정별로 나열 |
| 트랙명(+날짜) | `WHERE track_name ILIKE '%<v>%' [AND uploaded_at::date = '<d>'] ORDER BY uploaded_at DESC LIMIT 10` |
| "latest" / 미지정 | `ORDER BY uploaded_at DESC LIMIT 5` 후 최신 채택(또는 후보 제시) |
| `.json` 경로 | 로컬 RaceSummary 파일 — DB 생략 가능 |

기본 조회(후보 식별용):
```sql
SELECT r.id, r.source_race_id, r.track_name, r.session_type, r.game_format,
       r.best_lap_ms, r.plausible, r.uploaded_at, a.persona
FROM platform.races r JOIN platform.accounts a ON a.id = r.account_id
ORDER BY r.uploaded_at DESC LIMIT 5;
```

## Step 2: 데이터 수집

### 소스 A — 플랫폼 DB (업로더 본인 데이터만 있음; 그리드 전체 없음)

```sql
-- 랩 (섹터 포함; valid는 서버 판정)
SELECT lap_number, lap_ms, s1_ms, s2_ms, s3_ms, tyre, valid
FROM platform.laps WHERE race_id = '<id>' ORDER BY lap_number;

-- 상세 payload: 키별로 나눠 읽는다 (한 번에 전체 SELECT 금지 — incidents가 크다)
SELECT schema_version, jsonb_object_keys(payload) FROM platform.race_detail WHERE race_id = '<id>';
SELECT payload->'stints'   FROM platform.race_detail WHERE race_id = '<id>';
SELECT payload->'dynamics' FROM platform.race_detail WHERE race_id = '<id>';
SELECT payload->'events'   FROM platform.race_detail WHERE race_id = '<id>';

-- 사고 클립(v4.48.0+ 업로드에만 존재): 먼저 frames 제외 메타만
SELECT jsonb_agg(c - 'frames') FROM platform.race_detail,
       jsonb_array_elements(payload->'incidents') c WHERE race_id = '<id>';
-- 특정 클립의 프레임이 필요할 때만 개별 조회 (0-base 인덱스)
SELECT payload->'incidents'->0->'frames' FROM platform.race_detail WHERE race_id = '<id>';

-- 피트 손실
SELECT stops, pit_lane_time_ms, stationary_ms FROM platform.race_pit_loss WHERE race_id = '<id>';
```

- payload 구조의 SoT: `internal/platformsvc/ingest.go`의 `UploadDetail`/`UploadIncident` json 태그.
- `race_setup`은 BYTEA 캐노니컬 + **마켓 자산이라 공개 금지 원칙** — DB의 셋업은 리포트에 쓰지 않는다.
  셋업 연결 분석은 로컬 요약의 `detail.setup`이 있을 때만.
- 라이벌 비교(선례: Monza의 2인 비교): 같은 `source_race_id`의 타 계정 행, 또는 같은
  `track_id`·인접 `uploaded_at`의 레이스를 찾아 랩·섹터를 나란히 놓는다.

### 소스 B — 로컬 RaceSummary JSON (풀그리드·하이라이트·리플레이 포함)

- 구조 SoT: `internal/races/types.go` (`RaceSummary`). 주요 키: `player`, `drivers[]`(전 그리드
  스틴트/순위), `detail.{laps,dynamics,events,setup}`, `incidents[]`, `highlights`, `debrief`.
- 파일명 규칙: `YYYYMMDD_HHMMSS_<track>_<sessionUID>.json` (server 모드는 `data/races/`).
- `drivers[]`가 있으면 **드라이버별 리포트**(race-drivers-*.html)를 추가 생성할 수 있다.

## Step 3: 분석 차원 (체크리스트)

수집된 데이터가 지원하는 항목만 다룬다 — 없는 데이터는 "없음"으로 명시하고 건너뛴다.

1. **결과 요약** — 완주 랩, 베스트랩, valid/invalid 랩 수, plausible 여부
2. **랩타임 추이** — 스틴트·SC·페널티로 **국면(block)을 먼저 분리**하고 국면 내에서만 회귀/평균.
   (선례 교훈: "스틴트 전체를 한 번에 회귀하면 마모처럼 보인다. 블록을 쪼개면 사라진다")
   아웃라이어는 events/incidents에서 원인 귀속을 시도한다
3. **섹터 분해** — 어느 섹터에서 잃었나. 섹터 합 ≈ 랩 델타 재조정 검증(오차 명시)
4. **타이어 전략** — 스틴트 길이·컴파운드·마모(%), 교체 타이밍의 득실
5. **피트 손실** — pit_lane_time_ms(레인 체류) vs stationary_ms(정지 작업) 분해
6. **다이내믹스** — 랩별 언더/오버스티어·락업·스핀 ↔ 랩타임 상관
7. **이벤트 타임라인** — 페널티/경고/RC 알림을 랩에 매핑
8. **사고 클립** — incidents별: t0·랩·상대(참가자·minDistM)·병합 여부. 프레임을 읽었다면
   충돌 직전/직후의 속도·스로틀·브레이크·조향 변화로 접촉 상황을 서술
   (car 배열 순서: x,y,z,vx,vy,vz,yaw,gLat,gLong,speedKmh,throttle,brake,steer,gear — `internal/dto/incident.go`)
9. **국면 동등 비교** — 라이벌 비교 시 같은 타이어·연료 국면끼리만 비교
10. **셋업 연결** — (로컬 요약 한정) 셋업 값과 관측된 주행 특성의 연결

### 신뢰 규율 (선례 리포트가 확립한 원칙 — 위반 금지)

- 총량을 성분으로 분해했으면 **합계가 총량과 일치함을 리포트에 명시**한다 (오차 있으면 오차도)
- 데이터가 뒷받침하지 않는 서사 금지. 추정에는 `[추정]` 표기
- 마지막 두 섹션은 고정: **"해석 한계"** (방법론상 한계) + **"미해명 항목"** (남은 의문)

## Step 4: 리포트 생성

- 경로/이름: `docs/race-analysis-YYYYMMDD-<track>.html`, 드라이버별은 `docs/race-drivers-YYYYMMDD-<track>.html`
  (날짜는 레이스 날짜. 같은 날 같은 트랙 재분석이면 `-2` 접미)
- **기존 리포트를 Read해 스타일을 재사용한다** — `docs/race-analysis-20260725-monza.html`의
  CSS 변수(`--bg:#0b0e13` 다크 테마)·`.wrap`/`.hero`/`.chip`/sticky nav 구조 유지. 셀프컨테인드
  (외부 리소스 없음), `lang="ko"`, 차트는 인라인 SVG
- **제목은 데이터가 말하는 결론**으로 뽑는다 (선례: "격차를 만든 건 전략이 아니었다") —
  "Monza 분석 리포트" 같은 무색 제목 금지
- 완성 후 `SendUserFile`(display: render)로 전달

## Step 5: 플랫폼 업로드 (선택 — env 있을 때만)

리포트를 플랫폼에 올려 허브 ANALYSIS 스크린(관리자 전용)에서 열람할 수 있게 한다.

- **게이트**: `PITHUB_ADMIN_TOKEN`과 (선택) `PITHUB_PLATFORM_URL` env가 없으면 **업로드를 조용히
  스킵**하고 로컬 산출물로 종료한다 — 업로드 실패가 분석 실패가 되어선 안 된다.
  - `PITHUB_PLATFORM_URL` 기본값: `https://pithub.up.railway.app`
  - `PITHUB_ADMIN_TOKEN` = 관리자 계정의 **web 세션 토큰** (허브 로그인 후 브라우저
    localStorage `pitwall.platformToken`). **전 계정 권한을 가진 secret이다 — 출력/로그 금지.**
    TTL 30일: 401이면 재로그인해 토큰 갱신 안내. 403이면 계정에 `pithub.race-analyze.create`
    권한 없음(admin Role 미보유) — `PLATFORM_ADMIN_ACCOUNT_IDS`에 계정 UUID를 넣고 재기동
    (부팅 시 admin Role 멱등 부여)하거나 `/rbac/accounts/{id}/roles`로 Role 할당 안내.
- **업로드** (`jq -Rs`로 HTML을 JSON 안전 임베드):
  ```bash
  jq -n --rawfile html docs/race-analysis-YYYYMMDD-<track>.html \
    --arg title "<리포트 히어로 제목 그대로>" \
    --arg track "<트랙명>" --arg uid "<세션UID>" \
    '{title:$title, trackName:$track, sessionUid:$uid, html:$html}' \
  | curl -sS -X POST "$PITHUB_PLATFORM_URL/analysis" \
      -H "Authorization: Bearer $PITHUB_ADMIN_TOKEN" -H "Content-Type: application/json" \
      -d @- 
  ```
  - `sessionUid` = `source_race_id`(또는 로컬 파일명)의 **마지막 `_` 뒤 숫자**. 미상이면 빈 문자열
  - `title` = 리포트 히어로 제목과 동일 (내러티브 제목, ≤120자)
  - 드라이버별 리포트(race-drivers-*.html)는 **같은 sessionUid로 별도 POST** (세션당 복수 문서 정상)
  - 성공 응답 `201 {"analysisId": ...}` — id를 사용자에게 보고
  - 상한: html 256KiB. 리포트가 넘으면 업로드 포기하고 보고 (리포트를 줄이지 말 것)

## 주의

- incidents `frames` 전체를 대화에 덤프하지 않는다 — 통계(최소거리 시점, 속도 델타)만 뽑아 쓴다
- DB 탐색은 좁게: 항상 특정 race_id로 조건, 전 테이블 스캔 금지
- 분석 대상 레이스가 DB에 없으면(0랩 레이스는 업로드 자체가 안 됨) 로컬 요약 경로를 안내한다
