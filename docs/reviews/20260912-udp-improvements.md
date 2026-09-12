# Task Report: UDP 수신 안정성과 전달 성능 개선

UDP 포트 변경의 정체, 중복 종료 패닉, 전달 대상 설정 중 DNS 조회가 수신을 막는 문제를 수정했다. 수신의 패킷당 할당 횟수는 2회에서 1회로 줄었고, 동일 전달 대상 갱신의 벤치마크 시간은 5회 측정 중앙값 기준 87.8% 감소했다.

## 1. Pre-Review (Plan)

- **Orchestrator Feedback**: 현재 작업트리 `4b7533af`에서 기능 경로·최근 수정 이력·전체 기본 테스트를 확인했다. 실제 재현 가능한 UDP 수명주기(상), 수신 할당(중), Forwarder 설정 갱신(중)을 수정 대상으로 선정했다.
- **독립 리뷰어 Feedback**: fresh-context 서브에이전트가 후보 3건을 채택했다. 취소된 context, 중복 Start, 종료와 Rebind 경합, DNS 재조회, 중복 대상의 일대일 재사용 및 종료 후 연결 재생성 방지를 권고했다.
- **Refinement**: Listener는 `context.AfterFunc`로 취소를 처리한다. Forwarder는 DNS 준비 중에도 기존 전달과 Close를 허용하며, 준비 완료 후 종료 상태를 다시 검사한다. RTC 직렬화 후보는 실제 호출부가 이미 두 view로 제한하므로 기각했다.

## 2. Implementation Details

- **Assumptions**: [Assumption] Close는 객체의 영구 종료를 뜻한다. 현재 Sender/Server 호출부의 사용 방식과 종료 순서를 근거로 결정했다. [정책과 근거](../../history/20260912-udp-shutdown-and-target-reuse.md).
- **Key Changes**:
  - Listener의 Rebind 알림 채널을 제거하고 최신 socket과 시작·종료 상태를 같은 mutex로 관리한다. 시작 후 packet 채널 종료는 단일 reader가 소유한다. 중복 Close와 Start는 안전하게 반환하고, 종료 후 Rebind는 오류를 반환한다.
  - reader가 수신 버퍼를 재사용하고 `ReadFromUDPAddrPort`로 불필요한 송신 주소 할당을 제거한다. 소비자가 받은 바이트의 독립성과 큐 포화 시에도 먼저 전달하는 순서를 보존한다.
  - Forwarder의 설정 준비를 전달 잠금 밖에서 수행한다. DNS 재해석 결과가 같을 때만 기존 socket을 재사용하며, 제거된 연결을 정리한다. 종료 중 준비한 연결은 다시 게시하지 않는다.
- **디자인 조건**: UI 디자인·화면·API DTO 변경은 없으며, Claude CLI에 맡길 디자인 구현은 발생하지 않았다.

## 3. Final Convention Review

- **Layer Analysis**: 변경은 UDP 수신·전달 계층에 한정된다. Presentation의 설정 API와 Service의 telemetry 처리 계약을 유지하며 Repository 수정은 없다. Processor는 packet 채널 종료 시 기존 checkpoint 저장 경로로 정상 종료한다.
- **Simplicity Check / Style Match**: 수신의 Pool과 Rebind 채널을 제거하고 기존 mutex·표준 라이브러리·로깅 방식을 사용했다. 제품 코드는 2개 파일만 변경했다. 새 일반화 계층이나 UI 기능을 추가하지 않았다.
- **독립 최종 리뷰**: 제품 코드의 추가 결함은 발견되지 않았다. 종료 중 설정 갱신 테스트에 새 연결도 준비하도록 보완했다. 최종 종료 검사를 제거한 Go overlay에서는 해당 테스트가 실패하여 회귀 검출을 확인했다.

## 4. Status

**Verification** — [기계 판독 가능한 검증 결과](20260912-udp-improvements-evidence.json).

| 검사 | 결과 |
|---|---|
| 수정 전 재현 | 중복 Close 패닉, context 취소 후 채널 미종료, 반복 Rebind 정체, DNS 중 전달 정지, 동일 대상 socket 재생성 |
| 신규 UDP 테스트 | 16개. 실제 UDP·로컬 DNS로 포트 변경, 시작·종료 경합, 바이트 소유권, DNS 주소 변경·실패, 중복/제거 대상, 큐 포화, 종료 후 재활성화 차단 검증 |
| 전체 Go | `go test -race -count=1 -p 1 -json ./...`: 754개 test/subtest 통과, 실패 0, DB 설정 부재로 96개 skip. 테스트가 있는 25개 package 통과 |
| 최종 UDP 경합 검사 | `go test -race ./internal/udp -count=1 -timeout=30s` 통과 |
| 정적 검사 | `go vet ./...`, `git diff --check` 통과 |
| 실제 Sender | Linux 실행 후 설정 API로 포트 10회 변경, 바이트 단위 전달 일치, 이전 포트 해제, 전달 socket 재사용, 관리 stdin을 통한 정상 종료(exit 0) 확인 |
| Windows Sender | Go 1.26.7, Windows amd64 GUI cross-build 통과 |
| 변경 전 UI 기본 검증 | Web 67개 파일·744개 테스트, Electron 20개 테스트 통과 |

**성능 측정** — Linux/amd64, Xeon Gold 6530, Go 1.26.7, 각 5회. 대상 갱신은 같은 loopback IP·포트 1개를 재적용하고, 수신은 1,460바이트 datagram을 전송·수신한다.

| 측정 | 수정 전 | 수정 후 |
|---|---:|---:|
| 패킷 수신 할당 횟수 | 2 allocs/op | 1 alloc/op |
| 패킷 수신 할당량 | 1,540 B/op | 1,536 B/op |
| 동일 전달 대상 갱신 시간, 중앙값 | 7.418 µs/op | 0.908 µs/op |
| 동일 전달 대상 갱신 할당량 | 568 B/op | 272 B/op |

수신 시간의 중앙값은 5.062→4.821 µs였으나 측정 분포가 겹친다. 수신 성능의 확실한 개선 근거는 할당 횟수 감소다. 대상 갱신 결과는 내부 함수 벤치마크이며 앱 전체 처리량이나 네트워크 지연의 개선율을 뜻하지 않는다.

**검증 범위**: DB 코드는 변경하지 않았고 DB 통합 검사는 환경변수 부재로 실행되지 않았다. Windows는 크로스 빌드만 수행했으며 실제 Windows/F1 게임 실행은 이번 검증에 포함하지 않는다. WebRTC와 DTO는 변경하지 않았다.

**Cleanup**: 테스트용 UDP/DNS 소켓과 Sender 프로세스를 종료했다. 검증 수치와 결정 기록을 저장소에 남기고 임시 실행 파일·테스트 자료를 정리했다. 변경사항은 현재 작업트리에 있으며 커밋·푸시·배포는 수행하지 않았다.
