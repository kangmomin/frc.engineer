# Driver Pack UI를 PitHub(웹 허브) 디자인으로 바꾸고 셋업·세션 분석 기능 제거

- **날짜**: 2026-10-26
- **이슈**: 같은 날 Driver Pack을 pitwall 디자인 시스템(다크, `web/src/styles/theme.css` + `web/src/ui`)으로 통일했다([20261026-driver-pack-pitwall-design-system.md](20261026-driver-pack-pitwall-design-system.md)). 사용자는 플랫폼 웹 허브(PitHub, `web/src/hub`)와 같은 모양을 원했고, 세션 분석과 셋업 설정 기능의 제거를 요청했다. (출처: 대화)
- **결정**:
  1. **제거 범위**(사용자 선택: "추가 제거 없음"):
     - **Setup Builder**: 트랙·팀·날씨별 셋업 조회와 추천 저장. `shared/setup-manager/catalog.ts`는 이 앱만 쓰므로 함께 지운다.
     - **Setup Feedback**과 이를 만들던 **Recording**: 녹화는 셋업 피드백을 만드는 용도뿐이다.
     - **Session Analysis**: 세션 목록, 랩·트레이스 비교, 연습 제안.
     - Sender·Overlay·Intercom·Engineer 화면과 Live 텔레메트리 패널은 유지한다.
  2. **디자인**(사용자 선택: PitHub 라이트 그대로):
     - 셸은 hub `Sidebar` + `TopBar` 구조를 따른다. 224px 흰 사이드바(로고, 번호 붙은 MONO 내비, PITHUB·DISCORD 링크, 하단 Sender 상태), 60px 상단 바(컨텍스트 라벨 + 상태 박스), 회색 배경 위 흰 카드.
     - 팔레트는 `web/src/hub/theme.ts`의 `buildTheme('#e0a83d', 'light')`를 import해 `:root` CSS 변수로 펼친다. 폰트는 hub와 같은 IBM Plex Sans KR + JetBrains Mono.
     - `web/src/styles/theme.css`와 `web/src/ui`(PanelTitle·MetricTile·WeatherIcon) import를 끊는다. 컴포넌트는 `src/ui/kit`에 hub 패턴(Profile 카드·버튼, TopBar 크레딧 박스, 검색 입력)으로 다시 만든다.
     - 창 폭이 960px 이하면 hub처럼 사이드바를 64px로 접는다. 사이드바에 맞춰 기본 창을 1120×860(최소 760×620)으로 키우고, 창 배경·Windows 타이틀바 오버레이를 라이트 색으로 바꾼다.
- **결정자**: 사용자 (제거 범위, 테마) / 에이전트 (Recording 동반 제거, 팔레트 공유 방식, 창 크기, 테스트 정리)
- **근거**:
  - 팔레트를 복사하지 않고 hub `buildTheme`을 import하면 hub 색 변경이 두 앱에 함께 반영된다. `theme.ts`는 외부 import가 없어 `web/node_modules` 없는 CI에서도 typecheck·build가 돈다.
  - hub 화면은 인라인 스타일 + `t` 객체라 컴포넌트를 그대로 가져올 수 없다. 같은 값을 CSS 변수로 받는 kit를 두는 편이 Driver Pack 화면 전체에 일관되게 적용된다.
  - 셋업·분석은 PitHub(MY SETUPS·ANALYSIS)이 맡고, Driver Pack은 Sender·오버레이·무전·엔지니어 같은 로컬 런타임 기능에 집중한다.
- **기각된 대안**:
  - PitHub 다크 팔레트: 사용자가 라이트를 선택했다.
  - Recording만 남기기: 결과를 보여 줄 곳(Setup Feedback)이 없어 의미가 없다.
  - Sender의 `/api/races/latest`·셋업 관련 API 제거: 다른 소비자 확인 없이 API를 바꾸지 않는다. Driver Pack이 더 쓰지 않을 뿐이다.
- **수정 내역**: 신규 `apps/setup-manager/src/{DriverPack.tsx, shell/, ui/theme.ts}`, `src/ui/kit.*` 재작성, `src/sections/*`·`EngineerRadioPanel`·`DriverIntercomPanel`·`App.tsx` 스타일 이전, `F1SetupManager.tsx`·Setup Builder·Session Analysis·Recording 관련 파일과 `shared/setup-manager/catalog.ts` 삭제, `tests/analysis.test.tsx` → `tests/senderDebug.test.ts`(Sender fetch 회귀만 유지), `analysis.vitest.config.mjs` → `vitest.config.mjs`, `electron/main.cjs` 창 크기·색, `docs/feature-scope-roadmap.md`
- **재발 시 대응**: 동일 이슈 재제기 시 본 문서 인용으로 종결
