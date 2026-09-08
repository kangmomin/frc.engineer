## 📋 Task Report: PitHub 분석 화면 개편과 익명 공유

### 1. Pre-Review (Plan)
- **Orchestrator Feedback**: 레이스 기록 목록에서 상세 화면으로 이동하고, 목록 필터와 상세 데이터 탭을 분리한다. 사고 재생은 실제 브라우저의 RAF·React 갱신으로 검증한다.
- **독립 리뷰어 Feedback**: fresh-context 리뷰어 1개로 검토. 공유 변경은 기존 `pithub.race.update`, 공유 상태 조회는 `pithub.race.read`를 사용한다. 토큰을 노출하는 공유 상태 GET도 View As에 허용하지 않는다. 공개 incident 요청마다 토큰을 재확인한다. DELETE CORS, 서버 필터·페이지 초기화·날짜 경계를 검증한다.
- **Refinement**: 위 권한·공유 경계·CORS 제안을 반영했다. 공유 화면은 Hub의 로그인 bootstrap을 거치지 않는 별도 진입점으로 구현했다.

### 2. Implementation Details
- **Assumptions**: 필터는 서킷 이름, 게임, 세션, 시작일·종료일로 구성했다. 날짜는 사용자 현지 날짜의 시작 이상, 종료일 다음 날 미만이며 기록 시각이 없으면 업로드 시각을 사용한다. 셋업 공개 기본값은 꺼짐이다.
- **Key Changes**:
  - 전체 너비의 레이스 기록 목록과 상세/목록 이동. 적용한 필터 및 불러온 페이지는 상세에서 돌아와도 유지한다.
  - 랩/섹터, 스틴트/타이어, 주행 분석, 페널티/이벤트, 피트, 사고 리플레이 탭. 공유된 셋업이 있으면 셋업 탭을 추가한다.
  - 시간·비율·텔레메트리 수치를 소수점 3자리로 표시한다. 랩 수, 순위, 기어 등 개수·식별 값은 정수로 유지한다.
  - RAF 콜백의 `previous`가 React updater 평가 전에 바뀌던 재생 오류를 수정했다. elapsed milliseconds를 updater 밖에서 확정한다.
  - 확대/축소, 휠 줌, 드래그 이동, 사고 구간/전체 트랙 맞춤, 배속, 이전/다음 프레임, 사고 시점 탐색, 끝에서 재시작. 모바일에서도 SVG 글자가 축소되지 않도록 실제 화면 너비를 좌표계에 반영한다.
  - 레이스마다 UUID capability 링크 1개를 저장한다. 셋업 공개 여부를 변경해도 링크는 유지하고, 공유 중단 후 다시 만들면 새 토큰을 발급한다.
  - 셋업 비공개 시 공개 응답에서 setup 필드 자체를 제외한다. 공개 시에도 23개 파라미터만 반환하고 메모·평점·content hash·원본 payload는 반환하지 않는다.

공유 API:

| 메서드 / 경로 | 접근 / 동작 |
|---|---|
| `GET /me/race-analyses/{id}/share` | 본인 + race.read. 링크가 없으면 null |
| `POST /me/race-analyses/{id}/share` | 본인 + race.update. `{includeSetup: boolean}` 필수 |
| `DELETE /me/race-analyses/{id}/share` | 본인 + race.update. 공유 중단 |
| `GET /shared/race-analyses/{token}` | 로그인 없이 토큰으로 상세 조회 |
| `GET /shared/race-analyses/{token}/incidents/{index}` | 로그인 없이 토큰으로 선택한 사고 조회 |

모든 공유 관리 요청은 View As에서 차단한다. 공유 응답과 오류는 `Cache-Control: no-store`이다. 웹 링크는 `#raceShare=...` 프래그먼트를 사용한다. 목록 API는 `search`, `gameFormat`, `sessionType`, `from`, `before`를 기존 limit/offset과 함께 받는다.

### 3. Final Convention Review
- **Layer Analysis**: Presentation은 탭·탐색·표시 포맷을 담당한다. HTTP 핸들러가 인증·권한·입력 검증을 담당하고, platformsvc는 본인 범위 조회와 공유/셋업 공개 정책을 처리한다. SQL 필터는 pagination 전에 적용하고 기존 목록 정렬을 유지한다.
- **Simplicity Check**: 기존 분석 DTO·replay·셋업 필드 정의를 재사용했다. 신규 런타임 의존성을 추가하지 않았다. WebRTC DTO/전송 경로는 변경하지 않아 DataChannel 페이로드 크기에 영향이 없다.

### 4. Status
- **Verification**:
  - `web`: 전체 Vitest 60파일 / 647테스트 통과, `npm run build` 통과, 수정한 TypeScript 파일 ESLint 오류·경고 없음.
  - `npm run test:analysis:browser`: 목록→상세→복귀, 필터 응답 역전, 탭 키보드 이동, 실제 프레임 진행/정지/재시작, 탐색/배속, 줌, 공유 설정과 익명 App 진입 검증 통과.
  - 기존 RAF 구현을 잠시 복원하면 같은 브라우저 테스트가 `RAF playback did not advance measured time`으로 실패하고, 수정 구현으로는 통과하는 것을 확인했다.
  - 전용 로컬 PostgreSQL에서 `go test ./internal/platformsvc`와 `go test ./cmd/platform` 전체 통과. 공유 권한 행렬, 셋업 숨김→공개→숨김, 폐기 링크 detail/incident 404, 새 토큰, 소유자 격리, 날짜·필터·pagination 검증 포함.
  - 1440px/390px에서 테스트 데이터로 화면 확인. 수평 페이지 넘침 없음. 실제 CDP pointer drag로 지도 이동 확인.
- **Cleanup**: 테스트용 DB, 계획 캐시, 임시 시각 검증 스크립트와 브라우저 세션 정리. 스크린샷은 `build/artifacts/pithub-analysis-ui/`에 보관했다.
- **적용 조건**: 웹과 플랫폼 서버를 함께 반영해야 한다. `013_race_analysis_shares.sql`은 기존 서버 시작 마이그레이션으로 적용된다. 이 작업에서 배포는 수행하지 않았다.
