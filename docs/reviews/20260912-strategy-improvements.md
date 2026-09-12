## 📋 Task Report: 전략 수집 누락 수정·현황 화면·회귀 테스트

### 1. Pre-Review (Plan)

- **Orchestrator Feedback**: 기존 조건 목록은 전략 근거가 첨부된 기록만 읽으며, 계측 없는 일반 업로드와 제외 사유를 구분할 수 없었다. 운영 화면의 직접 원인은 확인되지 않아 실제 UDP 캡처부터 업로드·DB·조건 조회까지 검증했다.
- **독립 리뷰어 Feedback (fresh-context)**: 순서가 뒤바뀐 LapData가 전체 경기의 플래시백으로 처리되는 결함과, 한 측정의 검증 실패가 정상 근거 전체를 버리는 결함을 지적했다. 집계 진단을 권고했다. 외부 CLI 리뷰어는 사용하지 않았다.
- **Refinement**: 오래된 LapData만 프레임 순서로 제외하고 실제 되감기는 계속 차단한다. 개별 잘못된 측정은 보존 대상에서 빼되 정상 측정값·제외 사유·서버 검증 기준을 변경하지 않는다. 분석 최소 기준 3명·6경기·40랩을 유지한다.
- **Task Breakdown**: 실제 캡처 재현(상), 수집·업로드 수정(중), 진단 집계/API(중), DB·HTTP·회귀 검증(상), 진단 화면 연결 및 기존 디자인 검증(중).

### 2. Implementation Details

- **Assumptions**: [Assumption] “전략 분석”의 대상은 웹 STRATEGY 실험실로 보고 관련 수집·업로드·API를 확인했다. [Assumption] 업로드 현황은 무제한 전체 통계 대신 기존 조회 규모에 맞춰 최근 300개 행으로 제한했다.
- **Key Changes**:
  - `internal/telemetry/strategy_evidence.go`: LapData의 `OverallFrameIdentifier`를 비교해 오래된 UDP 패킷을 무시한다. 다른 패킷 종류의 프레임은 이 순서 판정에 영향을 주지 않는다.
  - `internal/strategy/capture.go` 및 `cmd/sender/strategy_upload.go`: 잘못된 개별 랩/피트 측정으로 전체 전략 근거가 없어지지 않도록 유효한 측정을 보존한다. 모호한 랩 순서·세션 오류는 계속 거부하고, 전역 제외 사유는 유지한다.
  - `internal/strategy/diagnostics.go`: 조건 조회와 동일한 중복 제거·정상 랩 판정에 따라 수집/사용 가능/제외 랩, 기여하지 못한 기록, 사유별 집계를 만든다. 사유가 중복된 랩을 총 제외 랩 수에서는 한 번만 센다.
  - `internal/platformsvc/strategy.go`: 전략 계측이 없는 일반 레이스 업로드도 현황에 포함한다. 트랙·게임·정상 레이스·정지 계정 필터와 300행 제한을 적용한다. 세션별 중복 제거된 전략 근거 수와 업로드 행 수의 의미를 구분한다.
  - `cmd/platform/strategy.go`: 기존 권한·no-store 경계 안에서 `diagnostics`, `archiveCoverage`, `minCleanLaps`를 반환한다. API 명세는 [strategy-lab.md](../api/strategy-lab.md)에 반영했다.
  - `web/src/hub/screens/Strategy.tsx`: 업로드 없음·전략 계측 없음·정상 랩 없음 상태를 구분하고 수집 현황·제외 사유·선택 조건의 분석 최소 기준을 표시한다. 새로고침은 검색·필터·유효한 선택을 유지하며 이전 비교 요청을 취소한다. 구버전 API가 진단을 생략하거나 null을 반환하면 없는 수치를 0으로 표시하지 않는다.
  - `Strategy.module.css`: 기존 카드·타이포그래피·색상 변수·버튼·표 스타일을 재사용했다. 좁은 화면에서는 새 수집 수치와 진행도를 한 줄씩 배치해 수량과 단위가 중간에서 갈라지지 않게 했다.

### 3. Final Convention Review

- **Layer Analysis**: Presentation API는 집계만 반환하고 화면은 서버가 제공한 집계와 최소 기준을 표시한다. Service는 기존 clean/context 판정과 엄격한 서버 검증을 재사용한다. Repository는 별도 마이그레이션 없이 제한된 조회로 업로드 현황을 계산한다. 개인 계정·세션 ID, 연료 원본, 셋업은 새 응답에 포함하지 않는다.
- **Simplicity Check**: 유효한 근거는 기존 검증 경로로 바로 반환하고, 검증 실패 때만 개별 측정을 확인한다. 예측 모델·최소 표본 기준·업로드 시간 정합성 검사는 그대로 유지한다.
- **Payload**: 새 진단은 HTTP 조회 응답이다. 전략 원본은 기존 private capture/HTTP 업로드 경로를 사용한다. WebRTC 페이로드에 새 필드를 넣지 않았다. 실제 두 경기 업로드 요청은 9,655B / 6,142B로 기존 HTTP 한도 안에 있었다.

### 4. Status

- **Verification**:

  | 검증 | 결과 |
  | --- | --- |
  | 지연 패킷 회귀: 수정 전 코드에 새 테스트 적용 | 예상 실패: 기존 완료 근거가 사라짐 |
  | 잘못된 개별 측정 회귀: 수정 전 코드에 새 테스트 적용 | 예상 실패: 이전 정상 랩까지 사라짐 |
  | `go test -p 1 ./... -count=1` + 격리 Platform DB | 874개 테스트/하위 테스트 통과, 환경 전용 2개 스킵 |
  | 관련 5개 Go 패키지 `-race` + 격리 Platform DB | 진단/API 변경 단계 501개 통과, 업그레이드 DB 전용 1개 스킵 |
  | 최종 수집 보존 수정 후 전략·수집 회귀 `-race` | 74개 통과, 실패·스킵 없음 |
  | 관련 패키지 `go vet` | 통과 |
  | Windows amd64 Sender GUI 크로스 빌드 | 통과 |
  | 실제 raw → Processor → RaceSummary → 업로드 요청 | 두 경기 모두 통과; 로컬 fixture 설치 시 반복 가능한 테스트 추가 |
  | 실제 업로드 요청 → `POST /races` → DB → `GET /strategies/contexts` | 경기 2건·조건 2개·완료 14랩·사용 가능 5랩·제외 9랩 |
  | 전체 웹 테스트 | 최종 코드 752개 통과, 실패·스킵 없음 |
  | Strategy 실제 Chrome 회귀 | 수집 상태·사유 중복·서버 최소 기준·구버전 응답·새로고침·늦은 응답·권한 전환 통과 |
  | 웹 TypeScript 검사 및 프로덕션 빌드 | 통과 |
  | 375px·1280px 화면 확인 | 카드·수치·진행도 확인, 본문 가로 넘침 없음; 좁은 화면의 제외 사유 표는 카드 내부 스크롤 |

  전체 테스트의 스킵은 BanDB 통합용 `TEST_DATABASE_URL`과 스키마 업그레이드 전용 `PLATFORM_UPGRADE_TEST_DATABASE_URL` 미설정에 따른 것이다. 일반 Platform DB 통합 테스트는 실제 임시 PostgreSQL에서 실행했다. DB를 초기화하는 테스트 패키지들은 `-p 1`로 순차 실행했다.

  영구 회귀 테스트는 이전/동일 랩의 지연 패킷, 실제 되감기, 세션 교체, 다른 패킷 종류의 프레임, 잘못된 랩·ERS·타이어 나이·피트 타이머, 전역 제외 유지, 업로드 시간 정합성, 중복 사유 집계, 계측 없는 업로드, 트랙/게임/정지 계정/레이스 필터, 조회 제한, 권한·개인정보 경계를 포함한다. 원본 경기 캡처는 완주 세트가 아니므로 완주 마지막 랩까지 검증한 것으로 해석하지 않는다.

  화면 회귀는 업로드 없음·계측 없음·모든 랩 제외·소량의 정상 근거, 0랩 제외 사유, 생략/null 진단, 알 수 없는 사유, 서버 최소 기준 변경, 진행도 상한, 새로고침 후 선택·검색 유지, 트랙 변경과 권한 회수 뒤의 늦은 응답을 확인한다. 브라우저는 실제 HubApp 생명주기에 합성 API 응답을 사용했으며, 운영 화면의 실제 수치를 검증한 것은 아니다.

- **UI Implementation**: Claude CLI의 조직 접근 제한(HTTP 403) 이후 사용자가 이번 화면의 Codex 직접 구현을 승인했다. 기존 화면과 동일한 디자인을 유지하라는 추가 지시를 적용해 화면 연결까지 완료했다.
- **Production Limit**: 운영 frc DB 연결을 확보하지 못했으므로 현재 사용자의 업로드 유무나 실제 빈 화면의 직접 원인은 미확인이다. 위 결과는 저장소의 실제 캡처와 격리 DB로 입증한 로컬 결과다.
- **Cleanup**: 임시 PostgreSQL·Chrome·Vite 종료 및 DB 파일·캡처 감사 파일·CLI 로그·overlay·Windows 테스트 산출물·화면 확인용 임시 모듈과 이미지·테스트 로그 삭제 완료. 영구 회귀 테스트와 검증 보고서, 원래 경기 캡처는 유지했다. 이전 UDP 작업의 변경도 보존했다. 커밋·푸시·배포는 수행하지 않았다.

검증 집계: [evidence JSON](20260912-strategy-improvements-evidence.json)
