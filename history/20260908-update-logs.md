# 📋 Task Report: 업데이트 로그 등록·조회와 회원별 자동 모달

## 1. Pre-Review (Plan)

- **Orchestrator Feedback**: 기존 회원은 `platform.accounts`이고, PostgreSQL/pgx Store → HTTP gate → PlatformMarket → React Hub 구조를 유지한다. 현재 요구는 전체 업데이트 목록을 확인했는지 판정하는 것이므로 회원별 커서 하나면 충분하다.
- **독립 리뷰어 Feedback**: 스킬 밖 작업에 대한 fresh-context 서브에이전트 1개로 사전 리뷰했다. 과거 페이지 응답의 최신 번호를 읽음 기준으로 사용하지 않을 것, 계정별 응답의 캐시를 금지할 것, RBAC 카탈로그·테스트 정리 대상을 동기화할 것, 전체 목록 확인의 의미를 명시할 것을 권고했다.
- **Refinement**: 최초 페이지에서 실제 표시한 번호를 유지한다. `no-store`, 권한 seed 동기화, 새 테이블 테스트 정리, Unicode 입력 검증을 반영했다.

| 작업 | 난이도 |
|---|---|
| 마이그레이션·발행 순서·열람 커서 | 중 |
| 등록·조회·열람 API와 인증/권한 | 중 |
| 목록 화면·자동 모달·운영자 등록 폼 | 중 |
| DB 경합·HTTP 권한·브라우저 계정 전환 검증 | 중 |

## 2. Implementation Details

### 구조 비교와 결정

| 구조 | 장점 | 단점 / 적합한 조건 |
|---|---|---|
| 회원의 `update_log_watched_at` | 컬럼 하나로 간단하며 실제 열람 시각을 남길 수 있다 | 읽음 요청 시 `now()`를 저장하면 목록 조회 이후 발행된 글까지 확인 처리할 수 있다. 정확히 본 목록의 발행 시각을 저장해야 하며, 동일 시각·정밀도·발행 순서도 정의해야 한다. 이 경우 값은 실제 열람 시각과는 다른 의미다. |
| **회원의 `update_log_seen_id` — 채택** | 컬럼 하나, 시간대·시각 정밀도에 의존하지 않고 어떤 목록까지 확인했는지 명확하다. 회원 기준이므로 기기 간 공유된다 | 발행 번호 순서를 보장해야 하며, 실제 열람 시각·글별 열람 여부는 알 수 없다. 기존 글 수정 알림을 지원하려면 별도 발행 revision 설계가 필요하다. |
| 회원×로그 열람 테이블 | 글별 미열람, 읽은 시각, 통계·감사·필독 확인을 지원한다 | 회원 수×글 수에 따라 데이터가 늘고 조회·보존·인덱스 관리가 추가된다. 전체 목록 확인만 필요한 현재 요구에는 불필요하다. |
| 브라우저 저장소 | 서버 변경이 적고 구현이 쉽다 | 기기 간 동기화가 없고 저장소 삭제·브라우저 변경에 취약하다. 회원별 상태의 원본으로 부적합하다. |

로그 본문을 보관하는 `platform.update_logs` 테이블은 추가한다. **회원별 열람 이력 테이블은 만들지 않는다.** 회원에는 `BIGINT NOT NULL DEFAULT 0`인 `update_log_seen_id`만 추가한다. 이 값은 마지막 확인 목록의 발행 번호이며 FK가 아니다. 0은 아직 확인하지 않았거나 빈 목록을 뜻한다.

PostgreSQL의 기본 Read Committed에서는 명령마다 스냅샷이 달라질 수 있고 시퀀스 변경은 트랜잭션 커밋과 별개로 노출된다. 이에 따라 목록·최신 번호·회원 상태를 SQL 한 문장으로 조회하고, 발행은 identity 할당 전에 테이블 잠금을 얻어 커밋까지 유지하도록 설계했다. [PostgreSQL 트랜잭션 격리 문서](https://www.postgresql.org/docs/current/transaction-iso.html), [잠금 문서](https://www.postgresql.org/docs/current/explicit-locking.html).

### Assumptions

- 대상은 Steam 로그인한 허브 회원이다. 비로그인 접속은 자동 모달을 표시하지 않고 UPDATES에 로그인 안내를 표시한다.
- 등록은 `pithub.update-log.create` 보유 운영자만 가능하며 기존 admin의 `pithub` 권한으로 상속된다. 일반 회원은 조회와 본인 열람 처리만 가능하다.
- 새 글 등록이 목록 갱신이다. 게시글은 등록 후 변경하지 않으며, 수정·삭제·예약 발행 기능은 이번 범위에 포함하지 않는다. 정정 공지는 새 로그로 등록한다.
- 확인은 최신 목록이 활성 탭의 화면에 실제 표시된 것을 뜻한다. 글별 완독이나 스크롤을 추적하지 않는다. 최신 20개를 열면 해당 번호 이전 목록 전체를 확인한 것으로 처리하며, 이전 로그는 더 보기로 계속 조회할 수 있다.
- 새 로그 등록 뒤 이미 열려 있는 사이트에 실시간으로 모달을 강제 표시하지 않는다. 다음 허브 진입·접속에서 확인하며 수동 새로고침도 지원한다.

### Key Changes

- `014_update_logs.sql`: 회원 커서, 본문 테이블, 운영자 등록 권한 노드 추가. 기존 마이그레이션을 수정하지 않는다.
- 본문은 일반 텍스트, 제목 120자·본문 10,000자 이내로 검증한다. HTML로 실행하지 않는다.
- `GET /update-logs[?before=<id>]`: 로그인 웹 세션의 최신순 20개 목록, `latestRevision`, `hasUnseen`, `nextBefore`. 개인 상태를 포함하므로 `no-store`.
- `POST /update-logs`: 운영자가 제목·내용을 등록한다. 발행 잠금은 읽기 조회를 막지 않는다.
- `POST /me/update-logs/seen`: 인증된 본인의 표시된 `revision`만 기록한다. 존재하는 양수 ID를 검증하고 `GREATEST`로 이전 탭/기기의 요청에 의한 역행을 막는다. 미래 번호는 거부한다.
- bigint는 JSON 문자열로 전달해 JavaScript 정밀도 손실을 막는다.
- UPDATES 메뉴에 목록·더 보기·새로고침·운영자 등록 폼을 제공한다.
- 미열람 목록은 접속 시 native dialog로 표시한다. 닫기·Escape·초점 복원을 제공하며, 숨겨진 브라우저 탭은 열람 처리하지 않는다.
- 단순 백그라운드 조회는 읽음 처리하지 않는다. 저장 실패는 모달/화면에서 재시도할 수 있다.
- 계정·세션 변경 시 컴포넌트를 새로 만들고 지연 응답을 무시한다. View As는 수동 조회만 허용하고 열람·등록을 서버와 UI 모두에서 차단한다.

## 3. Final Convention Review

- **Presentation**: 기존 Hub 테마·사이드바·세션 경계를 유지했다. 목록과 모달은 같은 데이터를 표시하며 등록 권한은 UI 편의 조건과 서버 인증 경계 모두에 적용한다.
- **Service**: 입력 검증과 발행/열람 불변식은 기존 `platformsvc.Store` 스타일에 맞춰 구현했다. HTTP 핸들러는 인증·요청 파싱·응답을 담당한다.
- **Repository**: 기존 pgx 풀과 마이그레이션 러너를 사용한다. PK 역순 조회와 커서 페이지 방식이며 회원×로그 조인은 필요하지 않다.
- **Simplicity Check**: 별도 열람 테이블, 범용 알림 엔진, 이벤트 큐, 실시간 폴링, 새 패키지 의존성을 추가하지 않았다.
- **WebRTC**: 이 기능은 플랫폼 HTTP로만 전달되며 DataChannel DTO나 최대 페이로드를 변경하지 않는다.
- **Style Match**: 순차 SQL 마이그레이션, RBAC 카탈로그, 기존 클라이언트 인증, React 스타일을 유지했다.

## 4. Status

### Verification

- 별도 로컬 PostgreSQL 17 테스트 DB에서 `go test -p 1 ./internal/platformsvc ./internal/rbac ./cmd/platform` 통과. 새 HTTP 테스트 추가 후 `go test ./cmd/platform`도 통과.
- DB 검증: 빈 목록, 새 발행, 조회 후 발행 경합, 커서 역행 방지, 회원 분리, 미래·잘못된 번호 거부, 과거 페이지 접근, 발행 잠금 전에 identity가 할당되지 않음, 미커밋 글 비노출.
- HTTP 검증: 실제 웹 세션으로 등록→조회→열람 저장→재조회. 비로그인·upload·정지 계정·일반 회원 등록·View As 쓰기 차단. JSON·커서 검증과 no-store 확인.
- 프런트엔드 `npm test -- --reporter=dot`: **60개 파일, 647개 테스트 통과**.
- Chrome 브라우저 테스트 `node scripts/test-webrtc.mjs /src/hub/screens/updateLogs.browser.tsx` 통과: StrictMode, 자동 모달, 확인 후 재접속 숨김, 수동 목록, 새 발행 재표시, 과거 페이지 revision 보존, 계정 전환 지연 응답, View As, 오류 재시도, 운영자 등록, 텍스트 안전성, 모달 초점·닫기.
- `npm run build`, 변경 TypeScript 파일 ESLint, `git diff --check` 통과.

### 적용과 Cleanup

- 서버 코드 반영 시 기존 시작 마이그레이션 절차가 `014_update_logs.sql`을 적용한다. 프런트엔드는 새 플랫폼 API와 함께 반영해야 한다.
- 구현·검증 후 사용자가 `codex-be-harness:commit-hard-push`를 요청했다. 보고한 동작 범위를 유지하고 기능·테스트와 작업 기록을 각각 커밋하여 현재 `main` 브랜치에 직접 푸시하는 범위다.
- 테스트용 PostgreSQL 인스턴스와 브라우저 테스트 프로세스를 종료하고 임시 데이터·사전 리뷰 Spec을 정리했다.
- 기존 `IncidentReplay.tsx`, `analysis.browser.tsx`, 사고 리플레이 작업 문서는 수정하지 않았다.
