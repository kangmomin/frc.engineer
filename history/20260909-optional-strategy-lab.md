## 📋 Task Report: AI 없는 권한 제한 전략 실험실

### 1. Pre-Review (Plan)

- **Orchestrator Feedback**: 모든 사용자의 업로드를 공통 근거로 삼되, 알려진 조건·정상 랩만 비교하고 조회 권한을 부여받은 사용자에게 제공한다. 수집 → 저장 → 통계 → API → 화면의 전체 흐름을 구현한다.
- **독립 리뷰어 Feedback**: 스킬 밖 작업이므로 AGENTS.md의 대체 절차인 fresh-context 서브에이전트 리뷰를 사용했다. 외부 CLI를 호출하지 않았다. 연료/타이어 나이의 식별 불가, 드라이버/셋업 차이, 피트 체류 시간과 실제 관측 추가 시간의 차이, ERS의 인과 효과 오해를 중점 검토했다.
- **Refinement**: 경기별 기준 페이스를 분리하는 가중 회귀, 충분한 독립 경기/사용자 기준, 순위 보류 상태를 적용했다. 후속 리뷰의 최종 표본 재계산, ERS paired 합계, 동일 경기 업로더 영향 제한, uint16 팀 ID, 랩 경계 상태 귀속, 2026 Manual Override 제외, 조건 표시 보완을 반영했다. 권한 전환 계획의 별도 fresh-context 리뷰에서는 권한 갱신 시점과 마이그레이션 시드 검증 경로를 보완했다.

| 작업 단위 | 난이도 | 결과 |
| --- | --- | --- |
| 실제 조건·랩별 근거 수집 | 높음 | 자체 mutex의 본인 차량 수집기, 경계/flashback 처리 |
| 통계와 제약 전략 비교 | 높음 | 순수 Go 계산, 자료 부족/식별 불가 시 순위 보류 |
| 업로드·저장·권한 | 중간 | 선택 필드, 별도 테이블, 기존 업로드 호환, 원본 비공개 |
| 권한과 결과 화면 | 중간 | 조회 권한 보유자에게 별도 STRATEGY 화면 |
| 검증 | 높음 | 수식·프로토콜·DB·HTTP·브라우저 회귀와 Windows 빌드 |

### 2. Implementation Details

- **Assumptions**: 사용자의 후속 지시와 계획 승인에 따라 모든 Sender는 기본 수집하고 화면은 권한으로 제한한다. 개인별 토글은 제거했다. `[Assumption]` 최소 3명·6경기·40 정상 랩, 5°C 온도 구간, 신선도/트래픽 기준, 선형 타이어 근사와 새 타이어 기본 재고는 초기 기준이다. UI에서 재고와 규정 조건을 수정할 수 있고 정확도 보장으로 표현하지 않는다.
- **Key Changes**: `internal/strategy`에 AI 의존성이 없는 계산을 추가했다. 본인 차량의 원시 근거는 로컬 `privateCapture`와 비공개 DB에만 보관하고 집계 결과만 제공한다. 타이어·피트 비교는 버튼으로 실행하며 ERS는 실측 예산을 표시한다. 기존 레이스 업로드의 용량을 먼저 보장하고 공간이 없으면 전략 근거를 생략한다.
- **사용 위치**: `ACCESS에서 역할에 pithub.strategy.read 부여 → 사용자에게 역할 배정 → STRATEGY`. 기존 관리자 상위 권한도 허용한다. 트랙·경기 조건·새 타이어 재고·최대 피트 횟수 선택 후 비교한다.
- **상세 계약**: [전략 실험실 API·계산 명세](../docs/api/strategy-lab.md).

### 3. Final Convention Review

- **Layer Analysis**: Presentation은 로그인/계정·권한·선택과 결과 표시를 담당한다. Service는 입력 검증과 독립 계산에 집중하고 네트워크/DB/AI를 사용하지 않는다. Repository는 레이스별 JSONB 근거, 트랙/게임/사용자 범위·중복·정지 계정 필터를 담당한다.
- **Simplicity Check**: 별도 학습 인프라, AI SDK, 공통 DTO 확장, 자동 실행이나 유료 흐름을 추가하지 않았다. 기존 레이스 저장·업로드·RBAC·Hub 패턴을 사용했다. 개인별 설정 API·테이블·토글과 일반 사용자 전략 권한 자동 부여는 제거했다. 분석 변수는 타이어 종류당 한 컴파운드로 제한하고 마지막 스틴트는 남은 랩 수만 검사한다.
- **Privacy / Payload**: 원본 계정/세션/셋업/랩 근거가 외부 응답에 없음을 검사했다. WebRTC 데이터 필드는 늘어나지 않는다. 기존 24대·TrackMap 최대 페이로드 테스트와 Sender/Server의 privateCapture 제거 테스트를 통과했다.
- **독립 최종 리뷰**: 권한 전환의 서버·화면·지연 응답 처리를 재검토했고 차단 사항이 없었다. 리뷰어는 읽기 전용으로 검토했으며 검증 실행은 오케스트레이터가 담당했다.
- **Style Match**: 새 기능 영역 중심으로 수정했다. 작업 전 존재한 사고 리플레이 수정과 관련 기록은 보존했다.

### 4. Status

- **Verification**: 관련 Go 패키지 전체 테스트, PostgreSQL 17 격리 DB의 전체 플랫폼 테스트, 실제 로컬 HTTP 업로드→권한 부여→조건 조회→전략 계산 통합 테스트를 통과했다. 초기 구현에서 모델/수집/병합의 race detector 검사를 통과했고, 최종 변경의 Windows GUI Sender 크로스 빌드도 통과했다. 웹 빌드와 Hub 권한·View As·전략 관련 46개 테스트, 실제 Chrome의 권한 부여·회수·403 결과 제거·수동 비교·빈 자료·트랙/계정/권한 변경 후 지연 응답 회귀 검증을 수행했다. 새 격리 DB에 Migrate만 적용한 직후 일반 사용자 전략 권한이 없음을 확인했다. testStore의 권한 재설정으로 SQL 시드 오류가 가려지지 않는 경로다.
- **Practical limits**: 합성된 알려진 계수 자료로 계산·중복/편향 처리의 정확성을 검증했다. 실제 경기의 예측 정확도를 검증한 것은 아니다. 새 수집 항목이 없는 기존 업로드는 근거를 소급 생성하지 않으므로 충분한 신규 기록이 쌓일 때까지 순위가 없을 수 있다. ERS 구간별 최적 배포 위치, 사고/SC 확률, 날씨 전환은 계산하지 않는다.
- **Release**: 릴리스 버전 변경·커밋·푸시·배포는 수행하지 않았다. 플랫폼의 새 마이그레이션과 Sender 수집기가 함께 반영되어야 신규 자료가 쌓인다.
- **Cleanup**: 검증용 PostgreSQL을 종료하고 임시 DB·Windows 빌드 산출물·리뷰 명세를 삭제했다. 검증용 서버와 브라우저 세션도 종료했다.

재현 명령:

```bash
go test -p 1 ./internal/strategy ./internal/packets ./internal/telemetry ./internal/races ./cmd/sender ./cmd/server ./internal/platformsvc ./cmd/platform ./internal/rbac
go test -race ./internal/telemetry ./internal/races ./internal/strategy
GOOS=windows GOARCH=amd64 go build -ldflags '-H windowsgui' -o /tmp/frc-pitwall-sender-check.exe ./cmd/sender
```

DB 검증은 폐기 가능한 별도 PostgreSQL DB를 `PLATFORM_TEST_DATABASE_URL`로 지정한다. 기존 플랫폼 테스트는 이 DB의 테스트 데이터를 정리하므로 운영 DB를 사용하지 않는다. 마이그레이션 기본 권한 검증은 새 DB에서 아래 HTTP 테스트를 먼저 실행한 뒤 나머지 테스트를 실행한다.

```bash
go test -v ./cmd/platform -run '^TestStrategyUploadToSimulationHTTP$'
go test -p 1 -skip '^TestStrategyUploadToSimulationHTTP$' ./cmd/platform ./internal/platformsvc ./internal/rbac ./cmd/sender ./cmd/server ./internal/telemetry ./internal/strategy ./internal/races ./internal/packets
```

```bash
cd web
npm run build
npm test -- src/hub/data/strategy.test.ts src/hub/screens/Strategy.test.tsx src/hub/components/Sidebar.test.tsx src/hub/data/permissions.test.ts src/hub/screens/ViewAs.test.tsx
VITE_PLATFORM_URL=http://strategy.test node scripts/test-webrtc.mjs /src/hub/screens/strategy.browser.tsx
```

브라우저 회귀는 실제 Hub 컴포넌트와 Chrome을 사용하고 API 응답만 합성 fixture로 대체한다. HTTP+DB 통합 테스트는 실제 서버 핸들러·인증·DB·계산 경로를 연결한다. 조회 권한 없는 3명의 업로드, 명시적 권한 부여, 상위 권한 상속, 같은 세션에서 권한 회수 후 403을 확인한다. 제품 화면에 데모 자료를 주입하지 않는다.
