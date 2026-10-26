# Driver Pack UI를 MinmoPitwallUI(pitwall 디자인 시스템)로 통일하고 불필요한 기능 제거

- **날짜**: 2026-10-26
- **이슈**: Driver Pack 데스크톱 앱(`apps/setup-manager`)은 pitwall과 같은 색 값을 `P` 상수로 복사해 2,953줄짜리 `F1SetupManager.tsx`에 인라인 스타일로 그렸다. 디자인 시스템(`web/src/styles/theme.css` 토큰 + `web/src/ui` 컴포넌트, design-sync 패키지명 `MinmoPitwallUI`)을 쓰지 않아 모양이 따로 놀았다. 개발자용 정보와 거의 쓰지 않는 기능도 섞여 있었다. (출처: 대화)
- **결정**:
  1. **제거 범위**(사용자 선택):
     - **Lap Compare**: 전/후 스냅샷 캡처. Session Analysis의 랩 비교와 겹친다.
     - **개발자용 정보**: 고정 Sender API URL 패널, Room ID, Engineer Dashboard URL, 항상 켜져 있던 Ready 배지, 세션 분석의 읽기 전용 서버 URL 입력란, "/api/config로 저장" 문구.
     - **Overlay 프리셋**.
     - 녹화·LIVE·Setup Feedback은 유지한다.
  2. 함께 정리한 것:
     - 쓰이지 않던 `WorkspaceNavCard`·`WorkspaceModuleCard`와, 읽는 곳이 없던 `frc_sender_url` 쓰기를 제거한다.
     - WORKSPACE 패널(섹션 설명 + 배지)을 없애고, Setup Builder/Session Analysis 전환은 세그먼트 탭으로 옮긴다.
     - Sender Status의 Save Files 타일을 뺀다. Save Mode가 꺼짐을 "Off"로 이미 표시해 중복이다.
  3. **디자인 시스템 적용**(사용자 선택: 토큰 + 공용 컴포넌트):
     - `main.tsx`가 `web/src/styles/theme.css`를 직접 import한다.
     - `PanelTitle`·`MetricTile`·`WeatherIcon`은 `web/src/ui`의 파일을 그대로 쓴다.
     - 데스크톱 앱에만 필요한 입력·버튼·세그먼트 탭·Notice·상태 pill은 같은 토큰으로 `src/ui/kit`에 만든다. `shell/NavTabs`, 헤더 status pill, CutoffWatch advice 패턴을 따른다.
  4. **구조 분리**:
     - `F1SetupManager.tsx`는 셸(헤더·탭·라우팅)만 맡는다.
     - 로직은 `src/hooks/`로 옮긴다: Sender 연결·페어링, Setup Builder, Sender 설정, 오버레이, 녹화.
     - 화면은 `src/sections/`로 옮긴다.
     - 하위 패널(세션 분석·트레이스·엔지니어 라디오·인터컴·업데이트 배너)의 `theme` prop을 없애고 kit를 쓴다.
  5. **Sender API는 바꾸지 않는다.**
     - `PUT /api/config`에서 오버레이 필드를 빼서 보낸다. Sender는 nil이면 기존 값을 유지한다.
     - 오버레이 핫키 저장은 `PUT /api/local-ops`(핫키만)에서 한다. 이 요청은 프리셋을 비우는데, 기능 제거와 일치하므로 그대로 둔다.
- **결정자**: 사용자 (제거 기능 3종, 적용 깊이) / 에이전트 (함께 정리한 중복·죽은 코드, 구조 분리, 공유 방식)
- **근거**:
  - 같은 레포에 있는 디자인 시스템 소스를 직접 import하면 토큰 변경이 두 앱에 동시에 반영된다. Driver Pack은 이미 `web/src/intercom`·`web/src/constants`를 import하고 있어 새로운 결합이 아니다.
  - CI의 Driver Pack 잡은 `web/node_modules` 없이 돈다. 그래서 `web/src/ui` 파일의 `react` import가 앱 사본으로 해석되도록 Vite `resolve.dedupe`와 tsconfig `paths`로 고정한다. `web/node_modules`를 치운 상태에서 typecheck·build 통과를 확인했다.
  - SVG 차트 색은 `stroke` 속성 대신 `style`로 준다. 프레젠테이션 속성에서는 `var()`가 보장되지 않기 때문이다.
- **기각된 대안**:
  - design-sync 번들(`window.MinmoPitwallUI`)을 런타임에 로드: Electron 오프라인·CSP 부담이 있고 소스 import보다 이점이 없다.
  - 토큰만 교체: 사용자가 공용 컴포넌트 재사용까지 선택했다.
  - Sender의 프리셋 API·저장 필드 제거: 다른 소비자 확인 없이 API를 바꾸지 않는다. Driver Pack이 더 쓰지 않을 뿐이다.
- **수정 내역**: `apps/setup-manager/src/{F1SetupManager,App,main,SessionAnalysisSection,AnalysisTrace*,EngineerRadioPanel,DriverIntercomPanel}.tsx`, 신규 `src/ui/`·`src/hooks/`·`src/sections/`·`src/lib/`·`src/styles/app.css`, `setupDriverPack.ts`(랩 비교 타입·정규화 제거), `index.html`(중복 전역 스타일 제거), `vite.config.ts`, `tsconfig.json`
- **재발 시 대응**: 동일 이슈 재제기 시 본 문서 인용으로 종결

## 후속 (2026-10-26)

같은 날 디자인 기준을 PitHub(웹 허브)로 바꾸고 Setup Builder·Session Analysis를 제거했다. 위 3·4번의 pitwall 토큰 공유와 세션 분석 관련 내용은 [20261026-driver-pack-pithub-design.md](20261026-driver-pack-pithub-design.md)로 대체됐다.
