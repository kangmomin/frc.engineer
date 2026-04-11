# Feature Scope and Roadmap

이 문서는 현재 `frc.engineer` 제품 범위를 정리하고, 다음 기능 우선순위를 잡기 위한 기준 문서다.

이번 정리에서는 아래 범위를 제외한다.

- signaling / room / remote connect / 권한 중개 기능
- 해설(commentary) 화면
- `combat` 화면 및 전투 전용 기능

## 현재 제품 면

### 1. Web Dashboard

- `CockpitDashboard`
  - 메인 실시간 주행/엔지니어 화면
  - 리더보드, ERS, 연료, 타이어 상태, 전략 패널, 주요 알림, 트랙 상태 표시
- `QualifyingDashboard`
  - 퀄리파잉 전용 화면
  - 베스트랩, 섹터 비교, 페이즈/시도 상태, 트랙 갭 표시
- `Setup` 진입
  - 대시보드 안에서 Setup Manager를 열 수 있는 구조

관련 파일:

- `web/src/components/layout/Layout.tsx`
- `web/src/components/cockpit/CockpitDashboard.tsx`
- `web/src/components/qualifying/QualifyingDashboard.tsx`

### 2. Sender / Local Ops

- UDP 수신 및 텔레메트리 처리
- 트랙 기록 저장
- 레이스 결과 저장
- 오버레이 설정 API
- 현재 레이스 리플레이 API

관련 파일:

- `cmd/sender/main.go`
- `cmd/server/main.go`

### 3. Setup Manager

- 트랙별 세팅 데이터 조회
- 텔레메트리 대조
- 주행 기록 기반 setup feedback
- AI 분석

관련 파일:

- `apps/setup-manager/src/F1SetupManager.tsx`
- `apps/setup-manager/src/App.tsx`

## 코드상 준비됐지만 아직 제품 기능으로 덜 드러난 항목

### 1. Race Archive / Replay 기반

이미 있는 것:

- 레이스 목록 API: `/api/races`
- 레이스 상세/삭제 API: `/api/races/{id}`
- 리플레이 스트림 API: `/api/replay/{id}`
- 프런트 store의 `raceResult`, `playbackActive`, `applyReplayFrame`

현재 부족한 점:

- 저장된 레이스 목록을 보는 메인 UI가 없다.
- 리플레이 재생용 타임라인 UI가 없다.
- 종료 직후 결과를 길게 활용하는 디브리프 화면이 약하다.

### 2. Session Analysis 기반

이미 있는 것:

- 세션 목록 API: `/api/sessions`
- 세션 분석 API: `/api/sessions/{dir}/analysis`

현재 부족한 점:

- 분석 결과를 보는 전용 화면이 없다.
- 랩 비교와 손실 구간 분석이 제품 기능으로 노출되지 않았다.

### 3. Settings / Races 화면 구조

이미 있는 것:

- `SettingsView` 컴포넌트
- `TabId = 'engineer' | 'settings' | 'races'`

현재 부족한 점:

- 설정, 기록, 분석 화면이 실제 사용자 흐름으로 연결되지 않았다.

## 우선순위

### P1

1. Race Archive + Replay Viewer
2. Session Analysis / Lap Compare
3. Post-Race Debrief

### P2

1. Setup History / Presets
2. Track Recording Management
3. Overlay Presets

### P3

1. 분석 결과 Export
2. Setup Recommendation 고도화

## 현재 결론

가장 먼저 만들 가치가 큰 것은 새 실시간 화면이 아니라 이미 저장되고 있는 데이터를 제품 기능으로 노출하는 작업이다.

권장 구현 순서:

1. Race Archive + Replay Viewer
2. Session Analysis / Lap Compare
3. Post-Race Debrief
4. Setup History / Presets
