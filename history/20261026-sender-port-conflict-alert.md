# Sender 포트 충돌은 stderr 마커로 Driver Pack에 알리고 알림창으로 표시 — UDP·TCP 모두 프로세스 유지(후속), 크래시는 자동 재시작(후속)

- **날짜**: 2026-10-26
- **이슈**: 텔레메트리 UDP 포트(기본 20777)를 다른 프로그램이 쓰고 있으면 Sender가 HTTP 서버를 띄우기 전에 `os.Exit(1)`로 조용히 종료했다. 내장 모드에서 로컬 통신 포트 8099 바인드에 실패하면 HTTP 서버만 죽고 프로세스는 남았다. 두 경우 모두 Driver Pack에는 "Sender Offline"만 보였다. 페어링 모달은 Sender가 연결돼 있어야 뜨므로(`usePairingGate`) 페어링 코드 입력창도 나타나지 않았다. 사용자는 원인을 알 수 없었다. (출처: 대화)
- **결정**:
  1. Sender가 바인드 실패를 **stderr 한 줄 마커**(`FRC_SENDER_STARTUP_ERROR {json}`)로 알린다. 필드는 `code`·`protocol`·`port`·`reason`(`in_use`/`access_denied`/`unknown`)·`detail`·`fatal`이다. Electron 메인 프로세스가 이 줄을 파싱해 네이티브 알림창(`다시 시도`/`닫기`)을 띄운다. 문구는 Electron이 구조화된 필드로 만든다.
  2. ~~**UDP 실패는 기존처럼 종료**한다(`fatal: true`). UDP 없이는 텔레메트리가 없으므로 프로세스를 살려 둘 이유가 없다.~~ → 아래 후속 결정 1로 대체
  3. **TCP 8099 실패는 프로세스를 유지**한다(`fatal: false`). 이미 페어링된 경우 WebRTC 송출은 계속되기 때문이다. 알림만 띄우고, `다시 시도`를 누르면 Sender를 재시작한다.
  4. `다시 시도`는 기존 `restart-sender` IPC와 같은 `restartSender()`를 탄다. 업데이트 게이트·설치 대기 중 재기동 차단을 그대로 따른다.
  5. **단독 실행(비내장) Sender**는 Driver Pack이 없으므로 Windows `MessageBoxW`로 직접 알린다. UDP 실패 시, 그리고 설정 포트 10회 시도가 모두 실패했을 때 띄운다.
- **결정자**: 사용자 (포트 점유 시 알림창) / 에이전트 (전달 방식, UDP·TCP 처리 구분, 단독 실행 대응)
- **근거**:
  - Sender가 죽기 직전에 남길 수 있고 Electron이 이미 읽고 있는 통로가 stderr이다. 그래서 새 IPC·파일 없이 전달된다. Node의 `exit` 이벤트는 stdio가 다 읽히기 전에 올 수 있으므로, 종료 코드 대신 마커가 도착하는 즉시 처리한다.
  - Windows는 포트 충돌을 WSA 코드(10048/10013)로 돌려준다. 이 코드는 `syscall.EADDRINUSE`/`EACCES`와 같지 않아 별도로 매핑한다. `access_denied`는 Hyper-V/WSL/Docker 예약 포트 범위 안내에 쓴다.
- **기각된 대안**:
  - Sender 내장 모드에서도 `MessageBoxW` 사용: Driver Pack 창 밖에 별도 창이 떠 맥락이 끊기고 재시작 버튼을 줄 수 없다.
  - UDP 실패 시에도 HTTP 서버만 띄우고 오류 상태 유지: 페어링은 가능해지지만 UDP 재바인드·포트 변경 UX까지 필요해 범위가 커진다. 후속 과제로 남긴다.
  - 점유 프로세스 이름 표시(netstat 조회): 플랫폼 의존 코드와 권한 문제가 추가된다. 대표 원인(SimHub, Crew Chief, 기존 Sender) 안내로 대체한다.
- **수정 내역**: `cmd/sender/startup_error.go`(마커·분류·단독 문구), `cmd/sender/startup_alert_{windows,other}.go`, `cmd/sender/main.go`(UDP/설정 포트 바인드 실패 지점), `apps/setup-manager/electron/sender-startup-error.cjs`(파서·문구), `apps/setup-manager/electron/main.cjs`(알림창·`restartSender`) + 각 테스트
- **재발 시 대응**: 동일 이슈 재제기 시 본 문서 인용으로 종결

## 후속 결정 (2026-10-26): UDP 실패 시 종료하지 않음 + 크래시 자동 재시작

- **이슈**: 위 결정 2(UDP 실패 시 종료 유지)에서는 다른 프로그램을 끌 때까지 페어링·포트 변경을 할 수 없었다. Sender가 실행 중 크래시하면 Electron이 다시 띄우지 않아 앱을 재실행할 때까지 Offline으로 남았다. (출처: 대화 — 후속 과제 2·3번)
- **결정**:
  1. 위 결정 2를 **대체**한다. UDP 바인드에 실패하면 소켓 없는 리스너(`udp.NewUnboundListener`)로 기동을 계속한다. HTTP API·페어링·WebRTC는 정상 동작한다. 같은 포트로 3초마다 자동 재시도하고(`retryUDPBind`), `PUT /api/config`로 포트를 바꾸면 즉시 재바인드한다. 같은 포트로 저장하면 즉시 재시도만 하고, 실패해도 다른 설정 저장은 막지 않는다. 상태는 `/api/status`의 `udpBindError`(null = 수신 중)로 노출한다. 마커의 `fatal` 필드는 쓰는 곳이 없어져 제거했다.
  2. Driver Pack의 UDP 알림창 버튼은 `UDP 포트 변경`/`닫기`다. `UDP 포트 변경`은 Sender 설정 화면으로 이동해 UDP 포트 입력란에 포커스한다. `udpBindError`가 있는 동안 상단 배너를 띄운다. TCP 8099 알림창은 `다시 시도`(재시작)를 유지한다.
  3. **크래시 자동 재시작**: 종료 코드 ≠ 0인 예기치 않은 종료는 1s → 3s → 10s 간격으로 재시작한다. 연속 3회를 넘기면 멈추고 `Sender 반복 종료` 알림창(로그 경로 포함, `다시 시도`)을 띄운다. 60초 이상 정상 동작한 뒤의 크래시는 연속 횟수를 초기화한다.
  4. 다음 경우에는 재시작하지 않는다: 종료 코드 0(트레이 Quit = 사용자 의도), `stopSender` 진행 중, 앱 종료 중, 설치 대기 중, 강제 업데이트 게이트 중. 대기 중인 재시작은 `stopSender`·`startSender`·`before-quit`에서 취소하고, 수동 재시작은 횟수를 초기화한다.
- **결정자**: 사용자 (후속 2·3번 진행) / 에이전트 (재시도 간격, 백오프 값, 종료 코드 0 제외, 배너·포커스 UX)
- **근거**:
  - UDP를 못 잡아도 페어링·설정 API는 UDP와 무관하다. 종료하면 사용자가 포트를 바꿀 수단(설정 UI)까지 잃는다. 자동 재시도 덕분에 "다른 프로그램 종료" 경로는 사용자 조작 없이 복구된다.
  - 종료 코드 0은 Sender가 정상 종료 경로(트레이 Quit, stdin shutdown)로만 낸다. 이를 되살리면 사용자의 의도를 거스른다. Go panic(2)·`os.Exit(1)`·강제 종료는 0이 아니다.
  - 기동 직후 반복 실패(백신 차단, 저장소 권한)는 재시작해도 낫지 않는다. 그래서 횟수를 제한하고 원인 확인 경로(로그 위치)를 알린다.
- **기각된 대안**:
  - 무제한 재시작: 기동 직후 실패하는 원인이면 무한 루프가 되고, 원인을 숨긴다.
  - UDP 실패 시 Electron이 `sender-config.json`을 직접 고쳐 재시작: Sender가 살아 있으면 기존 `PUT /api/config` 재바인드 경로로 충분하다.
- **수정 내역**: `internal/udp/listener.go`(`NewUnboundListener`, 바인드 대기), `cmd/sender/main.go`·`startup_error.go`(`udpBindError`, `retryUDPBind`, `fatal` 제거, 단독 실행 알림 비차단), `apps/setup-manager/electron/main.cjs`(크래시 재시작, `showSenderAlert`), `sender-startup-error.cjs`(`describeSenderCrash`, `primaryAction`), `preload.cjs`·`src/App.tsx`·`src/F1SetupManager.tsx`(UDP 배너, 포트 입력 포커스) + 각 테스트
