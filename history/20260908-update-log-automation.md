# 📋 Task Report: 업데이트 로그 API·Python 게시 도구·가이드 스킬

## 1. Pre-Review (Plan)

- **Orchestrator Feedback**: 기존 수동 등록 API와 분리된 `POST /automation/update-logs`를 추가하고, 기존 발행 순서·회원별 열람 번호 모델을 유지한다. 제한 카운터는 기존 DB 테이블, 중복 등록 식별자는 기존 로그 테이블에 둔다.
- **독립 리뷰어 Feedback**: fresh-context 서브에이전트가 인증·프록시·DB 제한·중복 처리·Python 키 보호를 검토했다. 중복 Authorization 헤더 거부, strict base64url, IPv4 정규화, 실패 카운터 커밋, 신뢰 프록시의 명시적 설정, Go/Python Unicode 검증 일치를 권고했다.
- **Refinement**: 모두 반영했다. 실패 기록은 분 단위 근사 대신 실제 시각으로 저장해 최근 10분을 정확하게 계산한다. 유효 키의 전역 요청 제한은 잘못된 키로 소모되지 않는다.
- **Task Breakdown**: API·DB 제한(중), Python 호출 도구(중), 가이드 스킬(하), 인증·경합·실제 HTTP 검증(중).

## 2. Implementation Details

### 작업 계약

사용자가 요청한 범위는 API 호출 방식의 자동화 기능, Python 스크립트, AI용 가이드 스킬 생성이다. 운영 서버의 키 설정·재배포·실제 공지 게시를 수행하는 요청은 아니다. 후속 `codex-be-harness:commit-hard-push` 요청에 따라 보고한 구현 범위를 논리 단위별로 커밋하고 현재 main에 직접 푸시한다. 기존 사고 리플레이 관련 작업 트리 변경은 유지한다.

### Assumptions

- 제한 기본값은 IP별 최근 10분 인증 실패 5회, IP별 전체 요청 분당 30회, 유효 키 요청 전체 합산 분당 10회다.
- 하나의 게시 전용 키를 서버 환경의 해시로 설정한다. 여러 키의 개별 발급·관리 화면은 필요하지 않다.
- 스킬 원본은 저장소의 `.codex/skills/publish-update-log/`에 보관하고 현재 사용자의 Codex skills 디렉터리에는 원본을 가리키는 링크로 설치한다.

### Key Changes

- `PLATFORM_UPDATE_LOG_API_KEY_SHA256`에 SHA-256 해시를 설정한다. 값 미설정 시 자동화 API는 404로 비활성화되고 잘못된 형식이면 서버 시작을 중단한다. 기존 Steam/RBAC 등록은 유지한다.
- `Authorization: Bearer <키>`는 32바이트 난수의 정규 base64url 표현만 허용하며 SHA-256을 constant-time 비교한다. URL·본문 인증, 일반 관리 기능의 인증 우회는 지원하지 않는다.
- `PLATFORM_UPDATE_LOG_TRUSTED_PROXY_CIDRS`에 명시된 프록시에서만 X-Forwarded-For를 신뢰한다. 기본은 RemoteAddr이고 IPv4-mapped IPv6는 IPv4로 통일한다.
- `platform.rate_limits`의 IP 식별자는 IP의 SHA-256이다. 실패 판정과 기록은 IP별 트랜잭션 잠금으로 보호한다. 실패 시각을 응답 전에 커밋하고 DB 오류면 게시하지 않는다. 429는 Retry-After를 반환한다. 고정된 분 단위의 요청량 제한과 최근 10분의 실패 제한을 구분한다.
- `015_update_log_automation.sql`은 `update_logs.release_key` nullable unique 컬럼만 추가한다. 같은 식별자·정규화된 본문은 기존 ID로 200, 다른 본문은 409, 새 등록은 201이다. 재시도 시 새 ID를 만들지 않아 회원에게 중복 알림을 보내지 않는다.
- Python 표준 라이브러리 도구는 키 생성, UTF-8 JSON 검증, dry-run, 실제 API 요청을 지원한다. 키 파일을 새 파일로만 생성하며 POSIX 권한은 0600이다. 원본 키는 출력하지 않는다.
- 스크립트는 HTTPS를 사용한다. 명시적 옵션이 있는 숫자 loopback 주소만 로컬 HTTP 테스트를 허용한다. 리다이렉트·환경 프록시·자동 재시도를 사용하지 않는다. 실패 응답 본문과 임의 예외 문자열을 그대로 출력하지 않는다.
- `publish-update-log` 스킬은 변경 범위 분석, 사용자용 일반 텍스트 작성, 게시 식별자 유지, 키를 모델 컨텍스트에 넣지 않는 호출, 기존 게시 승인 재사용, 오류별 중단과 동일 payload 보존을 안내한다.
- CI에 Python 호출 도구 테스트를 추가했다.

API 계약·키 설정·프록시·요청 예시는 [스킬의 API 가이드](../.codex/skills/publish-update-log/references/api.md)를 참조한다.

## 3. Final Convention Review

- **Presentation**: 기존 목록·모달 DTO를 유지한다. 자동화 API는 별도 요청과 발행 결과를 반환하며 UI 권한을 변경하지 않는다.
- **Service**: 인증과 HTTP 처리는 `cmd/platform`, 발행 중복 판정과 DB 제한은 `platformsvc`에 둔다. 기존 테이블 잠금을 유지해 수동·자동화 발행 모두 순서를 보장한다.
- **Repository**: pgx 풀과 기존 마이그레이션·만료 카운터 정리를 재사용한다. 별도 API 키·열람·실패 이력 테이블과 외부 패키지 의존성을 추가하지 않는다.
- **Simplicity Check**: MCP 서버, AI 모델 호출 서버, 예약 발행, 다중 키 관리, 일반 알림 시스템으로 확장하지 않는다. Python 도구와 스킬의 API 가이드는 하나의 원본만 유지한다.
- **WebRTC**: 기존 DataChannel 전송 DTO와 페이로드에 영향이 없다.

## 4. Status

### Verification

- 별도 PostgreSQL 17 DB에서 `go test -race -p 1 ./internal/platformsvc ./cmd/platform` 통과. 기존 수동 등록·열람 테스트도 함께 통과했다.
- DB 테스트: 같은 releaseKey 8개 동시 요청에서 신규 발행 1회, 나머지 재응답, identity 추가 할당 없음. 다른 내용 충돌, 수동 NULL key 등록, 잘못된 식별자, 20개 동시 인증 실패 요청 중 정확히 5개만 허용, 실패 만료, 다른 IP 분리, 분 경계와 전역 제한 검증.
- HTTP 테스트: 키 설정·중복 헤더·비정규 토큰·프록시 헤더 위조, 잘못된 키, 등록·재응답·409, 필드 검증·429 Retry-After, DB 접근 실패 시 차단을 검증했다.
- Python 테스트 7개 통과: 키 생성 독점·권한·출력 비노출, Unicode 경계·중복 JSON, dry-run 무네트워크, URL 제한, 실제 HTTP·환경 프록시 무시, 오류·리다이렉트·재시도 방지, 토큰 형식.
- 별도 실제 `cmd/platform` 서버에 Python 스크립트로 신규 등록→동일 요청 재시도→내용 충돌→잘못된 키 5회→올바른 키에도 해당 IP의 429 응답을 확인했다. 서버 로그에 원본 키가 없음을 검사했다.
- `go build ./cmd/platform`, 대상 패키지 `go vet`, `git diff --check`, `skill-creator`의 `quick_validate.py` 통과.
- 독립 스킬 실행: “초안만 만들고 아직 게시하지 말라”는 요청으로 JSON과 dry-run을 생성하고 일치함을 확인했다. 초안 요청에도 게시 질문을 유도하던 지침을 제거했다. 키 열람·네트워크 호출·원격 게시 없이 수행했다.

### Cleanup와 적용

- 테스트 서버, 임시 키·요청·로그, 별도 테스트 PostgreSQL, 사전 리뷰·독립 스킬 평가 임시 파일을 정리했다.
- 운영 반영은 서버의 신규 마이그레이션 적용, 서버용 키 해시 설정·재시작, 프록시 환경에 맞는 CIDR 지정, 호출 도구의 원본 키 보관이 필요하다.
- 구현·검증·현재 사용자용 스킬 연결까지 완료했다. 운영 키를 생성·설정하거나 실제 공지를 게시하지 않았다.
