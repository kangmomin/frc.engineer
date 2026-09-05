# Driver Pack은 전용 stdin 파이프로 Sender의 저장 완료 후 종료한다

- **날짜**: 2026-09-05
- **이슈**: Pitwall/Sender 리뷰에서 Driver Pack의 `taskkill /f`가 Processor의 shutdown 저장을 건너뛰는 경로를 확인했다. 앱 종료·재시작·업데이트 모두 같은 종료 계약이 필요하다.
- **결정**: Driver Pack이 실행한 Sender에만 `FRC_MANAGED_STDIN=1`을 설정한다. 부모가 stdin으로 `shutdown`을 보내거나 파이프가 닫히면 Sender의 context를 취소하고, Processor.Done까지 기다린다. 부모는 실제 자식 종료를 확인한 뒤 재시작·설치·앱 종료를 진행한다. 응답 없는 자식에는 10초 후 강제 종료를 시도하고 추가 5초 안에도 종료되지 않으면 해당 작업을 실패 처리한다.
- **결정자**: 에이전트 (사용자의 리뷰 이슈 전체 수정 요청에 따라 결정, 독립 리뷰 반영)
- **가정**: [Assumption] 정상적인 로컬 체크포인트 저장은 10초 유예 내 완료되는 것으로 본다. 이를 넘기는 실제 캡처가 확인되면 제한을 재검토한다.
- **근거**: 전용 파이프는 HTTP 서버·tray 초기화 전에도 사용할 수 있고 부모의 비정상 종료도 감지한다. 저장 대기를 Sender 내부에서 2초로 끊지 않고 부모가 최종 제한을 맡으면 정상 저장과 프로세스 교체 순서를 함께 보장할 수 있다. 강제 종료에 이르면 저장 완료는 보장하지 않는다.
- **기각된 대안**: 새 HTTP 종료 API는 초기화·인증·포트 가용성에 의존한다. 무조건 강제 종료는 캡처를 유실한다. 무제한 부모 대기는 멈춘 Sender가 앱 종료·업데이트를 영구히 막는다.
- **수정 내역**: `cmd/sender/shutdown.go`, `cmd/sender/main.go`, `apps/setup-manager/electron/sender-lifecycle.cjs`, `apps/setup-manager/electron/main.cjs`. 동시 종료는 같은 Promise를 공유하고, 선택 업데이트는 대기 전에 설치 상태를 설정해 먼저 들어온 재시작도 차단한다. Processor 저장 테스트, 실제 자식 프로세스 테스트, Electron 이벤트 처리 테스트로 검증한다.
- **재발 시 대응**: 종료 전 대기와 stdin 제어 채널의 필요성은 본 문서를 인용한다. 실제 저장 시간이 제한을 넘는 사례는 별도 증거와 함께 제한 조정을 검토한다.
