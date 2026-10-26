# Sender 포트 충돌은 stderr 마커로 Driver Pack에 알리고 알림창으로 표시 — UDP는 종료 유지, TCP는 프로세스 유지

- **날짜**: 2026-10-26
- **이슈**: 텔레메트리 UDP 포트(기본 20777)를 다른 프로그램이 쓰고 있으면 Sender가 HTTP 서버를 띄우기 전에 `os.Exit(1)`로 조용히 종료했다. 내장 모드에서 로컬 통신 포트 8099 바인드에 실패하면 HTTP 서버만 죽고 프로세스는 남았다. 두 경우 모두 Driver Pack에는 "Sender Offline"만 보였다. 페어링 모달은 Sender가 연결돼 있어야 뜨므로(`usePairingGate`) 페어링 코드 입력창도 나타나지 않았다. 사용자는 원인을 알 수 없었다. (출처: 대화)
- **결정**:
  1. Sender가 바인드 실패를 **stderr 한 줄 마커**(`FRC_SENDER_STARTUP_ERROR {json}`)로 알린다. 필드는 `code`·`protocol`·`port`·`reason`(`in_use`/`access_denied`/`unknown`)·`detail`·`fatal`이다. Electron 메인 프로세스가 이 줄을 파싱해 네이티브 알림창(`다시 시도`/`닫기`)을 띄운다. 문구는 Electron이 구조화된 필드로 만든다.
  2. **UDP 실패는 기존처럼 종료**한다(`fatal: true`). UDP 없이는 텔레메트리가 없으므로 프로세스를 살려 둘 이유가 없다.
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
