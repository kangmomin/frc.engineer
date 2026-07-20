# design-sync NOTES — minmo-pitwall-ui (MinmoPitwallUI)

이 레포는 **디자인 시스템 패키지가 아니라 Vite SPA**(`web/`)다. design-sync용으로
`web/src/ui/`의 프레젠테이셔널 컴포넌트 5종(PanelTitle / StatRibbon / MetricTile /
WeatherIcon / TrackStrip)만 synth 번들로 동기화한다.

## 빌드 셋업 (재현 핵심)

- **번들 엔트리**: `web/src/ui/_ds-entry.mjs` (cfg.entry / `--entry`). 이 파일이
  `_ds-tokens.css`를 전역 import하고 `./index`(컴포넌트 배럴)를 re-export한다.
  → PKG_DIR이 `web/`로 잡혀 srcRoot=`web/src`, version=1.0.0이 된다.
  엔트리를 `.mjs`로 둔 이유: SPA의 `tsc -b`(include:["src"], allowJs 없음)와
  `eslint`(files: ts/tsx)가 `.mjs`/`.css`를 무시 → SPA 빌드/린트에 영향 0.
  vite는 이 파일을 앱이 import하지 않으므로 번들에 포함하지 않는다.
- **빌드 명령** (repo 루트에서):
  ```sh
  node .ds-sync/package-build.mjs --config .design-sync/config.json \
    --node-modules web/node_modules --entry ./web/src/ui/_ds-entry.mjs --out ./ds-bundle
  ```
  재동기화는 driver 한 방:
  ```sh
  node .ds-sync/resync.mjs --config .design-sync/config.json \
    --node-modules web/node_modules --entry ./web/src/ui/_ds-entry.mjs --out ./ds-bundle \
    [--remote .design-sync/.cache/remote-sync.json]
  ```
- **props는 `cfg.dtsPropsFor`로 손수 작성**: 라이브러리 `.d.ts` 빌드가 없어
  ts-morph가 소스 `interface ...Props`를 못 읽는다. componentSrcMap이 5종을
  명시 등록하고, dtsPropsFor가 props body를 공급한다.
- **CSS modules**: esbuild 기본값(`.module.css` → local-css)이 그대로 처리.
  `_ds_bundle.css`가 자동 생성된다 (cfg.cssEntry 불필요).
- **폰트(Google Fonts) @import**: `_ds-tokens.css` 첫 줄의 `@import url(css2…)`를
  esbuild가 `_ds_bundle.css` **최상단으로 hoist**한다(검증됨) → 폰트 정상 로드.
  validate는 `[FONT_REMOTE]`(정보성)로 인식, `[FONT_MISSING]` 안 뜸.

## 렌더 체크 (playwright/chromium)

- `.ds-sync`에 `playwright`만 설치(브라우저 다운로드 스킵):
  `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm i --prefix .ds-sync playwright`.
- 이 머신엔 chromium **빌드 1223**이 캐시돼 있고 playwright 1.61은 1228을 기대 →
  버전 갭. `DS_CHROMIUM_PATH`로 캐시 바이너리를 직접 지정해 우회(정상 동작):
  ```sh
  export DS_CHROMIUM_PATH="$USERPROFILE/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe"
  ```
  다른 머신/시점에선 캐시 빌드 번호가 다를 수 있으니 `ls ~/AppData/Local/ms-playwright`로 재확인.
- Linux 머신(2026-07-20 재동기화에서 검증): 캐시가 `~/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome`.
  동일하게 `export DS_CHROMIUM_PATH="$HOME/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome"`로 우회하면 정상 동작.

## Known render warns (정상 — 재동기화 시 새 경고로 오해 금지)

- `[FONT_REMOTE] "Space Grotesk", "Inter"` — 의도된 원격 CDN 폰트. 정상.

## 프리뷰 노트

- 다크 테마 DS라 각 프리뷰를 다크 surface(`#131314`)로 감싼다 (프리뷰 HTML body는 흰색).
- WeatherIcon은 100%×100% + currentColor → 프리뷰에서 sized 컬러 박스로 감싸야 보임.
- TrackStrip은 가로로 긴 풀폭 컴포넌트 → `cfg.overrides.TrackStrip = {cardMode: 'column'}`.
  프리뷰 surface에 minWidth 560 지정 (좁은 셀에서 코너 라벨 겹침 방지).

## Re-sync risks (다음 실행이 주의할 것)

- **스테이징 스크립트 버전이 바뀌면(scriptsSha 변경) 기존 컴포넌트 전원이 canary
  `render_churn`으로 뜬다** — 파이프라인 churn이므로 그레이드는 유지되고, spot-check
  시트만 눈으로 확인하고 진행하면 된다 (2026-07-08 v2.1.202 갱신 때 4/4 churn, 시트 전부 정상).

- **`web/src/ui/_ds-tokens.css`는 `web/src/styles/theme.css`의 `:root` + 브랜드 폰트를
  손으로 추린 사본**이다. theme.css 토큰이 바뀌면 `_ds-tokens.css`도 수동 동기화해야
  한다 (자동 추적 안 됨). 앱 reset/body 스타일은 의도적으로 제외.
- **`cfg.dtsPropsFor` body는 소스 props interface의 수기 사본**이다. 컴포넌트 props가
  바뀌면 dtsPropsFor를 갱신해야 contract가 맞는다.
- 폰트는 Google Fonts CDN(`@import url(css2…)`) 런타임 의존 — 오프라인/CDN 차단 환경에선
  fallback 폰트로 렌더된다.
- 추가 추출 후보(BattleTarget/PenaltyCell/SectorDeltaCell/DamageSummaryCell)는 DriverInfo
  의존이라 아직 미동기화. 추출 시 componentSrcMap + dtsPropsFor + 프리뷰를 같은 방식으로 추가.
