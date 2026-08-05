# 업데이트 강제 적용은 Electron 클라이언트 게이트로만 하고, 실패 시 fail-open 한다

- **날짜**: 2026-07-27
- **이슈**: "pitwall 혹은 sender 프로그램 업데이트가 있으면 필수적으로 해야하게" 요청.
  기존 동작은 실행 3초 뒤 1회 검사 + 무시 가능한 하단 배너(`App.tsx`)뿐이라 강제력이 없었다.
  선택지는 (a) 부트 게이트(실행 시 sender 를 붙잡고 업데이트 완료까지 대기),
  (b) 감지 후 차단(오버레이), (c) 서버측 최소 버전 게이트.

- **결정**:
  1. **(b) "감지 → 차단 → 설치"** 채택. `app.whenReady()` 는 손대지 않고 `startSender()` 가
     계속 최우선으로 실행된다. `update-available` 이 뜬 뒤에야 해제 불가 오버레이로 앱을 잠근다.
  2. **fail-open**: 다운로드 재시도 2회 / 다운로드 정체 120초 / 설치 워치독 15초 중
     무엇에 걸리든 게이트를 풀고 sender 를 재기동한 뒤 수동 다운로드 안내만 남긴다.
     동일 버전 누적 실패 3회(설정 파일 기록)면 그 버전은 아예 강제하지 않고 기존 선택형 흐름으로 되돌린다.
  3. **(c) 서버측 게이트는 범위 밖**으로 분리.

- **결정자**: 합의 (설계는 에이전트, 1·2의 정책 선택은 사용자)

- **근거**:
  - `BaseUpdater.js` 의 `addQuitHandler()` 가 이미 `app.onQuit` 에서 강제 설치를 수행하므로
    실제 구멍은 "앱을 끄지 않는 실행 중 세션" 하나뿐이었다. 부트 시점을 건드릴 이유가 없다.
  - 부트 게이트는 회귀 위험이 컸다: `F1SetupManager.tsx` 의 sender 설정 로드가
    `useEffect(..., [senderUrl])` 안의 **마운트 1회 fetch, 재시도 없음**이라 sender 기동이 늦으면
    그 세션 내내 Settings·오버레이 핫키·프리셋이 빈 상태로 고정된다.
  - `quitAndInstall` 은 설치 파일 누락 등으로 **종료 없이 반환**될 수 있다(`BaseUpdater.install`
    이 `false` 반환). 부트 게이트 + 강제 오버레이 조합이면 sender 도 없이 영구 잠김이 된다.
  - fail-closed 는 깨진 업데이터를 한 번 배포하면 전체 사용자가 수동 재설치 전까지 앱을 못 쓴다.
    강제력보다 복구 가능성을 우선했다.

- **기각된 대안**:
  - **부트 게이트(a)**: 위 근거의 회귀·벽돌 위험. 얻는 것 대비 비용이 크다.
  - **60분 주기 재검사**: 두 번째 상태 머신을 만들면서 "레이스 중 해제 불가 오버레이" 최악
    상태를 유발. 시작 시 검사 + `autoInstallOnAppQuit` 로 이미 커버된다.
  - **서버측 최소 버전 게이트(c)**: sender 가 현재 platform/signaling 에 **버전을 전혀 전송하지
    않는다**. 전송 추가 + 서버 판정 + "버전 미전송 클라이언트 전체 차단" 하위호환 결정까지
    필요한 독립 작업. 다만 **기존 v4.47.0 이하 사용자·고아 sender·exe 직접 실행을 강제할 수 있는
    유일한 수단**이므로 후속 과제로 남긴다.
  - **sender self-update (`internal/updater.AutoUpdate`)**: deploy 릴리스에
    `frc-pitwall-sender.exe` 에셋이 없어 항상 실패하고, 에셋을 추가하면 Driver Pack 동봉본과
    어긋나는 이중 채널이 생긴다.
  - **fail-closed**: 위 근거 참조.

- **구현 후 적대적 리뷰에서 잡힌 fail-open 구멍 2건** (둘 다 원본 대조로 확정 후 수정):
  1. **다운로드 단계에 타임아웃이 전혀 없었다.** 계획서에서 C5(`electron.net` 의 `ClientRequest` 가
     `'socket'` 을 emit 하지 않아 `httpExecutor.addTimeOutHandler` 가 죽은 코드)를 *부트 게이트를
     기각하는 근거*로만 쓰고, 정작 새 설계의 다운로드 단계에는 적용하지 않았다. 반열림 연결에서
     에러 없이 멈추면 `error` 이벤트가 안 오므로 재시도도 워치독도 발동하지 않아 **오버레이가
     영구히 남는다** — 사용자가 고른 fail-open 위반. → 진행률 기준 정체 워치독
     (`DOWNLOAD_STALL_MS = 120s`, `download-progress` 마다 재무장) 추가.
  2. **3회 실패 탈출구가 구조적으로 도달 불가였다.** `NsisUpdater.doInstall` 은 spawn 직후
     무조건 `true` 를 반환하고(`spawnLog` 는 `p.pid !== undefined` 로 resolve) 앱은 곧바로 종료된다.
     즉 **NSIS 설치 실패는 감지 자체가 불가능**하고, 실패를 세는 `recordUpdateFailure` 는
     실제 실패 경로에서 절대 호출되지 않는다 → 실행→게이트→종료 무한 루프.
     → 실패를 "감지해서" 세는 대신 **`quitAndInstall` 직전에 선기록**하고
     (`writeSettings` 는 동기라 즉시 이어지는 `app.quit()` 이후에도 남는다),
     새 버전으로 실행되면 `app.whenReady()` 에서 `clearUpdateFailuresIfInstalled()` 로 지운다.
     설치 성공 = 그 버전으로 부팅됨, 이 등가를 카운터의 판정 기준으로 삼았다.

- **수정 내역**: v4.48.0
  - `apps/setup-manager/electron/main.cjs` — `mandatoryUpdate` 게이트 상태,
    `broadcastUpdateStatus`(전 창 브로드캐스트 + 마지막 값 캐시), `get-update-status` IPC,
    실패 카운터 선기록/설치 확인 시 소거, 다운로드 재시도·정체 워치독·설치 워치독,
    `startSender`·`restart-sender` 우회 차단, `before-quit` 동기 `taskkill`,
    `downloadPromise` 미처리 rejection 흡수
  - `apps/setup-manager/electron/preload.cjs` — `getUpdateStatus` 노출
  - `apps/setup-manager/src/App.tsx` — `mandatory` 전체화면 오버레이(zIndex 30000),
    마운트 시 상태 pull, 실패 안내 패널, `UpdateBanner` 를 `ErrorBoundary` **밖**으로 이동
    (본체가 크래시해도 게이트는 살아 있어야 한다)
  - `apps/setup-manager/package.json` / `cmd/sender/main.go` — 4.48.0 동기화

- **재발 시 대응**: 부트 게이트·주기 재검사·서버측 게이트·fail-closed 가 후속 리뷰에서
  재제기되면 본 문서를 인용하여 즉시 종결한다.
