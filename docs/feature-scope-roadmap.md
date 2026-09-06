# Feature Scope and Roadmap

현재 `frc.engineer`의 사용자 화면과 다음 작업을 정리한다. 기준일: 2026-09-06.

## 현재 제공하는 기능

### Web Dashboard

`AppShell`에서 Pit Wall, Qualifying, Broadcast 화면을 전환한다.

- **Pit Wall**: 실시간 리더보드, 드라이버 상세·랩 이력, ERS·연료·타이어·전략, 트랙 위치와 주요 알림.
- **Qualifying**: 공식 최고 랩·섹터, 주행 시도 상태, 트랙 갭, 확인된 F1 참가 규모에 따른 20/22/24대 컷오프. 형식이나 참가 규모가 불명확하면 컷오프를 표시하지 않는다.
- **Broadcast**: 중계용 순위와 레이스 상태, 시작 그리드 대비 순위 변화 및 알림.
- **Race Archive / Replay**: 저장된 레이스 목록과 요약, 재생·일시정지·타임라인 탐색·속도 조절. 로컬 HTTP와 원격 P2P에서 아카이브를 읽는다. 재생 시점의 랩·그리드·섹터 이력은 라이브와 분리해 계산한다.
- **연결과 음성**: 방 선택·원격 연결·재접속 및 인터컴. 셸에서 설정과 Driver Pack으로 진입한다.

주요 파일:

- `web/src/shell/AppShell.tsx`
- `web/src/views/pitwall/PitWallView.tsx`
- `web/src/views/qualifying/QualifyingView.tsx`
- `web/src/views/broadcast/BroadcastView.tsx`
- `web/src/components/races/RaceArchiveDrawer.tsx`
- `web/src/intercom/core/runtime.ts`

### Sender / Local Ops

- F1 25 및 2026 Season Pack UDP 수신·처리, WebRTC 방송과 원격 요청 처리.
- 선택한 저장 모드에 따른 패킷·요약·리플레이 저장, 트랙 기록, 재시작 시 기록 병합과 업로드 재시도.
- 오버레이 및 로컬 설정 API, 레이스 목록·상세·삭제·리플레이 스트림 API.
- 개인 최고 랩 저장과 `getBestLap` 응답을 유지한다. Sender의 원시 best-lap trace는 파일 저장을 켠 Advanced 모드에서만 저장한다. 트랙 0(Australia)을 지원하고, 새 세션에서 트랙별 기록을 다시 읽는다. 이 API의 전용 Web 비교 화면은 현재 활성화되어 있지 않다.

주요 파일: `cmd/sender/main.go`, `cmd/server/main.go`, `internal/telemetry/processor.go`, `internal/races/storage.go`.

### Minmo Driver Pack (Setup Manager + Sender)

- 트랙별 차량 세팅 조회, 텔레메트리 대조, setup feedback 및 AI 분석 진입.
- Sender 실행·종료·재시작, 업데이트 설치 전 종료 대기.
- **Session Analysis**: 저장 세션 목록, 유효 랩·섹터·타이어 분석, 랩 비교와 손실 구간 표시.
- 드라이버 인터컴과 로컬 설정.

주요 파일:

- `apps/setup-manager/src/F1SetupManager.tsx`
- `apps/setup-manager/src/SessionAnalysisSection.tsx`
- `apps/setup-manager/src/DriverIntercomPanel.tsx`
- `apps/setup-manager/electron/main.cjs`

## 후속 작업 기준

아카이브 목록·리플레이 타임라인·세션 분석은 이미 존재한다. 이 화면들을 신규 개발 과제로 다시 등록하지 않는다.

1. 이번 감사의 수정 사항을 실제 게임의 장시간 세션, flashback, 네트워크 변경 환경에서 확인한다. 자동 회귀 검사와 현장 확인 결과를 구분한다.
2. 표준 F1 외의 커스텀 그리드·F2·특수 예선은 별도 규칙이 확인될 때 확장한다. UDP 배열 용량만으로 참가 규모를 추정하지 않는다.
3. 개인 최고 랩 비교 API의 신규 UI는 별도 요구사항으로 결정한다.
4. 툴체인·Electron·전송 의존성 패치, PostgreSQL 통합 검사, Chrome WebRTC 검사 및 Windows 네이티브 검사를 CI에서 유지한다.

이번 감사 원문은 `docs/reviews/20260906-project-audit.md`, 수정과 검증 상태는 `docs/reviews/20260906-remediation-status.md`에 기록한다.
