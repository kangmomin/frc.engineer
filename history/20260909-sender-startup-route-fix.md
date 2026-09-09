## 📋 Task Report: Sender 시작 중 HTTP 경로 충돌 수정

### 1. Pre-Review (Plan)
- **Orchestrator Feedback**: 사용자 로그는 UDP 수신 시작 후 중단됐다. 실제 HTTP 경로 등록을 조합하니 `GET /`와 메서드 없는 trace 경로가 충돌하여 ServeMux가 panic했다.
- **독립 리뷰어 Feedback**: 별도 재현으로 동일 panic 확인. 오버레이 초기화에는 해당 정지 원인이 없고, 서버의 methodless root에는 같은 충돌이 없다. 수정 및 회귀 테스트 최종 리뷰에 차단 사항 없음.
- **Refinement**: Sender trace 경로에 GET만 추가하고, main.go의 실제 전체 등록 패턴을 읽는 회귀 테스트로 기존 개별 핸들러 테스트의 누락을 보완한다.

### 2. Implementation Details
- **Assumptions**: 없음. 코드에서 결정적 시작 실패를 재현했다. 사용자 Windows에서 수정판 실행 결과는 아직 확인하지 않았다.
- **Key Changes**: Sender trace GET 등록 한 줄 수정. 전체 경로 등록, 홈·상태·trace GET 선택, trace POST 405 검증 추가. Driver Pack 및 Sender 버전 v4.57.0 동기화.

### 3. Final Convention Review
- **Layer Analysis**: Presentation의 라우팅 등록만 변경. Service 및 Repository 변경 없음. GET 전용 trace의 비허용 메서드 응답은 라우터 기본 405를 사용한다.
- **Simplicity Check**: 시작 함수 전체 리팩토링 없이 충돌을 일으킨 한 줄만 수정. 테스트는 실제 프로덕션 경로를 검증한다.

### 4. Status
- **Verification**: 수정 전 새 테스트에서 동일 panic 재현, 수정 후 `go test ./cmd/sender ./internal/analysishttp -count=1` 통과. Windows GUI 크로스 빌드 통과. 최종 설치 파일 검증은 릴리스 산출물 보고서에 기록한다.
- **Cleanup**: 트랙 전체 조회 검증용 PostgreSQL 종료 및 데이터 삭제. 사용자 기존 리플레이 수정은 보존한다.
