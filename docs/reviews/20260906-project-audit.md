# 📋 Task Report: Pitwall·Sender 중심 프로젝트 추가 감사

작성: 2026-09-06. 코드 기준: `84790bf5b7a8ae12c1706ed9a8d98ef9e79b70ef` / v4.53.0. 점검·재현 기간: 2026-09-05~06.

**새로 재현한 결함 15건, 표준 2026 퀄리파잉 호환성 문제 1건을 확인했다. 이전 리뷰의 미해결 7건도 같은 코드에 남아 있다.** 먼저 Sender의 무한 루프(N01), 인터컴 나가기 후 송신 재개(N02), RPC 응답 유실(K04)을 처리할 필요가 있다. 이번 작업은 발견·검증·보고이며 제품 코드를 수정하거나 릴리스하지 않았다.

[재현 코드 및 검증 근거 압축 파일](/workspace/frc.engineer/docs/reviews/20260906-project-audit-evidence.tar.gz)에 임시 Go overlay 테스트, 실제 React/Chrome 재현 코드, 결과 JSON, 의존성 감사 결과를 보관했다. 실패하는 불변식 검사와 결함 발생을 확인하여 통과하는 관찰 검사를 구분해야 한다.

## 1. Pre-Review (Plan)

- **Orchestrator Feedback**: 릴리스 이후 변경되지 않은 기준 코드를 고정하고, 이미 알려진 결함·승인된 동작·새로운 후보를 먼저 구분했다. Sender의 입력 처리, 저장·복구·업로드, WebRTC 응답, 로컬 HTTP, Driver Pack, 플랫폼 인증·DB 경로를 확인했다.
- **독립 리뷰어 Feedback**: 프로젝트 지침에 따라 별도 컨텍스트 리뷰어 1명이 Pitwall·퀄리파잉·리플레이·인터컴을 검토했다. 실제 React 훅, Zustand 저장소, Chrome WebRTC 오디오로 7개 결함과 1개 호환성 문제를 확인했고, 오케스트레이터가 생산자 DTO와 호출 경로를 대조했다. 로컬 분석의 랩·섹터·타이어·목록 정렬 및 리플레이 타이머 문제도 상호 검토했다. 외부 리뷰 CLI는 사용하지 않았다.
- **Refinement**: 의도된 pit loss 정의, 업로드 seal 정책, replay snapshot 디스크 비용 등은 제외했다. 새 트랙 기록 경계 문제는 독립 리뷰어가 추가 호출 경로 테스트를 작성했지만 후속 리뷰가 사용량 제한으로 중단되어, 오케스트레이터가 직접 읽고 실행·확정했다. 해당 후속 리뷰의 최종 승인을 받았다고 주장하지 않는다.
- **Task Breakdown**: 범위·이력 정리(하), 경계·동시성·데이터 의미 리뷰(상), 독립 재현 및 반증(상), 증거·수정 순서 통합(중).

## 2. Implementation Details

**Assumptions**: 제품 요구사항을 새로 정해 구현한 사항은 없다. 재현은 통제된 입력과 명시된 관측 순서를 사용했다. 실제 게임·외부 SFU·Windows 환경에서 확인하지 않은 부분은 아래에 별도로 표시했다. 장시간 응답 크기의 선형 외삽은 `[Assumption]`으로 표시했다.

**Key Changes**: 제품 소스 변경 없음. 이 보고서와 재현 자료만 추가했다. P1은 우선 처리할 가용성·사용자 제어 문제, P2는 특정 조건에서 나타나는 기능·데이터 결함, P3는 낮은 영향의 사용성 문제로 분류했다.

### 새로 재현한 결함

#### N01 · P1 · 비정상 Motion 패킷 하나가 Sender를 멈춤

- **위치**: [dynamics_signal.go:34](/workspace/frc.engineer/internal/telemetry/dynamics_signal.go:34), [pitwall_manager.go:338](/workspace/frc.engineer/internal/telemetry/pitwall_manager.go:338).
- **원인·영향**: yaw에서 각도를 빼고 `±2π`를 반복 가감한다. `+Inf` 또는 유한한 `math.MaxFloat32`에서는 가감 결과가 바뀌지 않아 루프가 끝나지 않는다. 실제 `UpdateMotion`은 `pm.mu`를 잡은 상태로 이 함수를 호출하므로 패킷 처리와 상태 조회가 함께 막힌다. 종료 시 상태 접근도 영향을 받을 수 있다.
- **재현**: 정상 Session/Lap/Telemetry 상태를 준비하고 실제 1,349바이트 F1 25 Motion 패킷을 Parser→Processor에 전달했다. 두 yaw 입력 모두 150ms 안에 반환하지 않았다. 앞선 임의 패킷 검사에서 수집한 스택도 같은 반복문→`ProcessFrame`→`UpdateMotion`→`processPacket`을 가리켰다. 소수 표현상 반복이 진행되지 않는 것이므로 단순한 느린 연산이 아니다.
- **수정 방향**: 비유한 값·물리 범위를 벗어난 각도를 입력 경계에서 거부하고, 각도 보정 자체도 유한 횟수에 종료되도록 한다. Inf뿐 아니라 큰 유한 값도 회귀 검사한다. UDP는 전체 IPv4 인터페이스로 수신하지만, 실제 외부 공격을 관측했다는 의미는 아니다.

#### N02 · P1 · 인터컴 ‘나가기’ 이후 ACK 전 마이크 송신이 재개됨

- **위치**: [runtime.ts:171](/workspace/frc.engineer/web/src/intercom/core/runtime.ts:171), 같은 파일 `applyGates`(514) 및 `failClosed`(547).
- **원인·영향**: `leave()`가 트랙을 일시적으로 끄지만 membership·joined·connected 상태를 유지한 채 최대 4초간 RPC 응답을 기다린다. 그 사이 높은 revision의 정상 `intercom_state`가 도착하면 `applyGates()`가 트랙을 다시 켠다. 실제 media peer 종료는 ACK 대기 이후다.
- **재현**: 실제 Chrome peer 간 오디오를 연결한 뒤 Leave를 호출했다. 즉시 `track.enabled=false`, 이어 상태 snapshot을 주자 ACK 전에 `true`로 바뀌었다. 수신 측 `totalAudioEnergy`가 뒤이은 250ms 동안 **0.146873741** 증가하여 실제 오디오 전송까지 확인했다.
- **수정 방향**: 사용자 조작 즉시 로컬 leaving/closed 세대를 확정하고 media 작업을 무효화·중지한다. 서버 탈퇴는 그 이후 정리 작업으로 처리한다. 지연 ACK, 중간 snapshot, 진행 중인 `getUserMedia`를 함께 검사한다.
- **한계**: signaling은 통제한 하네스이며 오디오는 실제 로컬 Chrome WebRTC다. 운영 Cloudflare SFU를 통한 재현은 하지 않았다.

#### N03 · P2 · 플래시백·트랙 전환이 부분 기록으로 정상 트랙맵을 덮어씀

- **위치**: [track_recorder.go:114](/workspace/frc.engineer/internal/telemetry/track_recorder.go:114), 같은 파일 `saveLap`(146).
- **원인·영향**: 랩 번호의 증가·감소를 모두 완주로 취급한다. 시작점·단조성 검사는 저장할 이전 buffer만 검사하여, 완주 판정에 사용한 새 경계 프레임의 역행·트랙 변경을 놓친다. 기록 중인 track/session도 별도로 무효화하지 않는다.
- **재현**: 5,002m·501점의 정상 지도를 저장한 뒤 lap 2에서 2~502m·101점을 수집했다. 같은 UID의 lap 1로 플래시백하거나 다른 UID·Bahrain lap 1로 전환하면 Australia 파일이 **17,623→3,541바이트**, 메모리 지도도 **501→101점**으로 바뀌었다. Recorder 직접 호출과 실제 `PitwallManager.UpdateSession/UpdateLapData/UpdateMotion` 호출 양쪽에서 확인했다.
- **수정 방향**: UID·트랙 변경·랩 감소 시 buffer를 버린다. 단순 번호 변경 대신 정상 결승선 통과와 충분한 트랙 거리 수집을 확인한 경우에만 기존 파일을 교체한다.

#### N04 · P2 · 최신 결과 폴링이 리플레이 전체를 계속 전송함

- **위치**: [main.go:1481](/workspace/frc.engineer/cmd/sender/main.go:1481), [F1SetupManager.tsx:721](/workspace/frc.engineer/apps/setup-manager/src/F1SetupManager.tsx:721).
- **원인·영향**: `/api/races/latest`의 메모리·디스크 분기가 모두 private capture만 제거하고 `Replay`를 포함한다. Driver Pack은 앞선 요청 종료 후 3초마다 이를 다시 요청하며, 응답 전체를 text→JSON으로 처리해 state에 보관한다. 작은 결과 표시를 위해 같은 큰 기록을 반복 처리한다.
- **재현**: 현재 핸들러 본문을 그대로 가져온 httptest에 실제 `BuildReplayState`의 24대 DTO·240프레임(2분)을 넣었다. 응답은 **3,680,428바이트**, Replay를 제외한 동일 결과는 **4,759바이트**였다. 해당 측정의 인코딩 시간은 약 22.7ms였다.
- **수정 방향**: 이 API는 결과 요약 DTO만 반환하고 큰 리플레이는 전용 API에서 조회한다. 변경 없는 결과에 대한 재조회 비용도 줄일 수 있다.
- **한계**: `[Assumption]` 같은 프레임 구성을 60분으로 선형 외삽하면 약 105.3MiB/요청이다. 실제 한 시간 파일의 메모리 부족·5초 timeout을 측정한 결과는 아니다.

#### N05 · P2 · 저장 세션 분석에서 무효 랩이 베스트 랩으로 선택됨

- **위치**: [analyzer.go:262](/workspace/frc.engineer/internal/analysis/analyzer.go:262), 같은 파일 276의 `valid: true`; [comparison.go:451](/workspace/frc.engineer/internal/analysis/comparison.go:451).
- **원인·영향**: 이미 읽어 둔 `CurrentLapInvalid`를 완료 랩에 연결하지 않고 모든 완료 랩을 유효하다고 기록한다. 베스트 랩·비교 기준·유효 표시가 함께 틀린다.
- **재현**: 실제 PacketLogger로 무효 80초 랩, 유효 90초 랩을 기록한 뒤 `Analyze`와 `fastestLap`을 실행했다. 무효 lap 1이 `Valid=true`이며 베스트 80초로 선택됐다.
- **수정 방향**: 랩별 무효 상태를 누적하고 완료 경계에서 이전 랩에 적용한다. 현재 랩의 새 invalid flag로 이전 랩을 판단하지 않는다.

#### N06 · P2 · 저장 세션 분석에서 완료 섹터가 0 / 0 / 전체 랩타임이 됨

- **위치**: [analyzer.go:231](/workspace/frc.engineer/internal/analysis/analyzer.go:231), 같은 파일 262~268의 완료 랩 추출.
- **원인·영향**: 마지막 랩타임이 갱신된 새 랩 프레임의 리셋된 S1/S2를 읽는다. 또한 섹터 시간의 minute 부분을 읽지 않는다. Driver Pack의 섹터 비교가 왜곡된다.
- **재현**: PacketLogger로 S1=70초(minute 1+10,000ms), S2=40초, 전체=150초를 기록했다. 다음 랩 진입 후 결과는 기대한 **70,000 / 40,000 / 40,000** 대신 **0 / 0 / 150,000ms**였다.
- **수정 방향**: 이전 랩의 섹터 관측값이나 SessionHistory를 사용하고 minute·millisecond를 합성한다. 두 문제를 함께 검사한다.

#### N07 · P2 · 저장 세션 분석에서 나중에 교체한 타이어가 이전 랩에 적용됨

- **위치**: [analyzer.go:346](/workspace/frc.engineer/internal/analysis/analyzer.go:346).
- **원인·영향**: `mergeTireInfo`가 기록 시간 대신 타이어 나이를 절대 랩 번호와 비교한다. 피트스톱에서 나이가 0으로 되돌아가면 미래 snapshot까지 진행하여 과거 랩의 compound와 stint를 바꾼다.
- **재현**: Soft로 lap 1~2를 완료한 뒤 lap 3에 Medium을 기록했다. 실제 분석 결과는 **Soft / Medium / Medium**이었다.
- **수정 방향**: 완료 랩의 시간 구간과 타이어 snapshot의 sessionTime을 연결한다. 나이는 compound 관측 시점의 속성으로 다룬다. K02의 재시작 시 마모 값 병합 문제와는 별개다.

#### N08 · P2 · 리플레이에서 퀄리파잉 잔여 시간·세션 길이가 사라짐

- **위치**: [processor.go:1067](/workspace/frc.engineer/internal/telemetry/processor.go:1067), 같은 파일 `copySessionInfo`(1115).
- **원인·영향**: 복사 함수 두 곳 모두 `SessionTimeLeft`, `SessionDuration`를 누락한다. 재생 시 헤더는 `--:--`, cutoff 안내는 90초 미만 상태로 계산된다.
- **재현**: 실제 복사 함수에 Q1 잔여 600초·길이 1,080초를 넣으면 프레임과 메타데이터 모두 **0 / 0**이 된다. 실제 QualifyingHeader/CutoffWatch 소비 경로도 대조했다.
- **수정 방향**: 재생에 필요한 세션 필드를 보존하고, 이후 DTO 확장 때 같은 누락을 막는 의미 단위 검사를 둔다.

#### N09 · P2 · 과거 리플레이 화면에 현재 라이브 레이스의 섹터·랩 이력이 섞임

- **위치**: [PitWallView.tsx:63](/workspace/frc.engineer/web/src/views/pitwall/PitWallView.tsx:63), [leaderboardRows.ts:430](/workspace/frc.engineer/web/src/views/pitwall/derive/leaderboardRows.ts:430), [lapHistoryStore.ts:244](/workspace/frc.engineer/web/src/store/lapHistoryStore.ts:244).
- **원인·영향**: 재생 프레임은 telemetry를 교체하지만 화면의 파생 이력은 여전히 car index로 조회한 live store다. live tracker가 replay를 무시하는 보호는 필요하나, 재생 화면에 대응하는 별도 이력이 없다. 퀄리파잉·드라이버 상세도 같은 저장소를 소비한다.
- **재현**: Australia live lap 10의 섹터 30/31/32초를 저장한 후 다른 드라이버의 Britain replay lap 4를 재생했다. 행의 마지막 랩은 리플레이 값 **1:50.000**, 섹터는 라이브 값 **30.000 / 31.000 / 32.000**이었다.
- **수정 방향**: 선택 프레임까지의 replay 전용 history/meta를 사용하거나, 해당 기록이 없으면 파생 정보를 비운다. Seek/rewind도 같은 경계로 처리한다. live store를 replay로 덮어쓰는 방식은 피한다.

#### N10 · P2 · 퀄리파잉의 무효 마지막 랩이 POLE로 표시됨

- **위치**: [leaderboardOrder.ts:3](/workspace/frc.engineer/web/src/components/qualifying/leaderboardOrder.ts:3), [classificationRows.ts:144](/workspace/frc.engineer/web/src/views/qualifying/derive/classificationRows.ts:144).
- **원인·영향**: 유효 best가 0일 때 양수 `lastLapTime`을 무조건 best로 사용한다. 무효 랩을 끝내면 `lapInvalid`는 새 랩 기준으로 false가 될 수 있으므로 마지막 랩의 유효성을 뜻하지 않는다.
- **재현**: 실제 Go 생산자에 무효 완료 77초 랩을 넣으면 `position=20, best=0, last=77000, lapInvalid=false`가 나온다. 이를 실제 브라우저 정렬·행 계산에 넣으면 유효 82초 드라이버를 앞서 **01 / 1:17.000 / POLE**로 표시한다.
- **수정 방향**: 기록 없음과 유효 랩 없음의 차이를 전달하고, 유효성이 확인된 랩만 임시 best로 쓴다. 과거 last-lap fallback 도입 목적은 기록 지연 보완이며 무효 랩 사용을 승인한 결정은 아니다.

#### N11 · P2 · 탈락권 드라이버의 필요한 개선량이 과소 계산됨

- **위치**: [cutoffWatch.ts:94](/workspace/frc.engineer/web/src/views/qualifying/derive/cutoffWatch.ts:94).
- **원인·영향**: 모든 드라이버를 첫 탈락자 `sorted[safeCount]`와 비교한다. 탈락권 선수의 목표는 마지막 진출자여야 한다.
- **재현**: 20대 Q1의 P15=91.400초, P16=91.500초에서 P16 안내가 **Need 0.000s**였다. 실제로는 P15를 앞설 만큼 0.100초보다 더 줄여야 한다. 기존 테스트에도 잘못된 0초 기대값이 있어 테스트 통과만으로 발견되지 않았다.
- **수정 방향**: 안전권·탈락권에 따라 비교 기준을 바꾸고 목표 위치·이름·격차를 일치시킨다. 동률 안내도 먼저 기록한 선수 우선 규칙을 고려한다.

#### N12 · P2 · 퀄리파잉 공식 best sector를 무시하고 무효 랩 섹터를 purple로 저장함

- **위치**: [useSectorAccumulator.ts:75](/workspace/frc.engineer/web/src/views/qualifying/useSectorAccumulator.ts:75), [classificationRows.ts:149](/workspace/frc.engineer/web/src/views/qualifying/derive/classificationRows.ts:149).
- **원인·영향**: 표시용 best는 화면 내부 live 누적 최솟값뿐이다. Sender가 이미 제공하는 `bestSector1Ms/2Ms/3Ms`를 초기화·교정에 쓰지 않는다. 잘못된 임시 값이 이후 비교 기준으로 남는다.
- **재현**: 공식 best가 각 30초인 드라이버로 실제 React 훅을 처음 마운트하면 누적 값은 0/0/0이다. 공식 best는 여전히 30초인데 `lapInvalid=true`·S1=20초인 프레임을 보내면 **20.000 / purple**로 바뀐다.
- **수정 방향**: 유효성이 반영된 SessionHistory best를 표시·purple 기준의 우선 소스로 삼는다. live fallback을 유지한다면 임시 값과 유효성 확인을 분리한다.

#### N13 · P2 · 퀄리파잉 시도 상태가 Q1→Q2 또는 선수 변경을 넘어 유지됨

- **위치**: [useQualifyingState.ts:190](/workspace/frc.engineer/web/src/hooks/useQualifyingState.ts:190), 같은 파일 88의 rewind 조건; [QualifyingView.tsx:62](/workspace/frc.engineer/web/src/views/qualifying/QualifyingView.tsx:62).
- **원인·영향**: 훅에 세션·segment·player identity key가 없고, 1랩을 초과한 되감기나 비퀄리파잉·선수 없음에서만 초기화한다.
- **재현**: 실제 React 훅에서 Q1 flying lap 2→Q2 garage lap 1 순서를 주면 **FLYING / attempt 1 / push 1**이 그대로 남는다.
- **수정 방향**: authoritative session/segment/player key를 넘겨 이전 프레임과 reducer 상태를 함께 초기화한다. 2→1만 관측되고 빈 프레임이 끼지 않는 조건에서 발생하며, 큰 랩 감소 등으로 이미 초기화되는 경우까지 포함한 주장은 아니다.

#### N14 · P2 · 같은 형식의 새 세션을 브라우저가 구분하지 못함

- **위치**: [raceMetaStore.ts:37](/workspace/frc.engineer/web/src/store/raceMetaStore.ts:37), 같은 파일 75; [pitwall.go:4](/workspace/frc.engineer/internal/dto/pitwall.go:4).
- **원인·영향**: 브라우저의 identity는 track/type/total laps와 최대 랩 감소뿐이다. wire DTO에 UID가 없어 lap 1 재시작, 같은 랩에서 다른 세션 재접속 등을 구분할 수 없다. 기존 그리드·history·선택 상태가 남는다.
- **재현**: 실제 tracker에서 lap 1 그리드 `{0:1,1:2}` 이후 같은 형식의 새 세션 그리드 `{0:2,1:1}`을 주어도 epoch는 **5→5**, 그리드도 이전 값으로 남았다.
- **수정 방향**: 세션 UID 또는 동등한 generation을 전달해 세션 파생 store들의 초기화 기준으로 통일한다. 같은 세션의 일시 재접속은 유지한다. K01과 독립적으로, Sender가 새 데이터를 정확히 보내도 발생한다. DTO 확장 시 24대·TrackMap 포함 크기를 재검증한다.

#### N15 · P3 · 저장 세션 목록이 기록 시각 대신 UID 순서로 정렬됨

- **위치**: [sessions.go:109](/workspace/frc.engineer/internal/analysis/sessions.go:109).
- **원인·영향**: 디렉터리 이름이 `<UID>_<timestamp>`인데 전체 문자열 내림차순으로 정렬한다. UID가 앞에 있어 오래된 세션이 위로 올라온다.
- **재현**: `9_20260101_000000`, `1_20260905_000000`을 실제 `ListSessions`에 넣으면 1월 기록이 먼저 나온다.
- **수정 방향**: 파싱된 timestamp로 정렬하고 동률일 때 directory를 사용한다. 목록 순서의 문제이며 UI가 이 결과로 최신 항목을 자동 선택한다고 주장하지 않는다.

### 호환성 확인 항목

#### C01 · P2 · 20→15→10 고정 퀄리파잉 컷오프가 표준 2026 형식과 맞지 않음

[qualiSegment.ts:21](/workspace/frc.engineer/web/src/views/qualifying/derive/qualiSegment.ts:21), [leaderboardOrder.ts:30](/workspace/frc.engineer/web/src/components/qualifying/leaderboardOrder.ts:30)은 Q1 15대 진출을 고정한다. 22대 fixture의 P16은 `IN THE DROP ZONE`이고, Q2 활성 그룹도 15대 기준이다. 확인한 FIA 2026 규정 issue 06의 B2.4.2는 표준 22대에서 Q2 16대·Q3 10대를 규정한다. B2.4.3은 20대일 때 5대, 24대일 때 7대씩 탈락하도록 조정한다. [FIA 원문](https://api.fia.com/system/files/documents/fia_2026_f1_regulations_-_section_b_sporting_-_iss_06_-_2026-04-28.pdf)

실제 참가 가능 대수·game format·세션 형식을 반영해야 한다. **UDP 배열 용량인 24를 실제 참가 대수로 단정하면 안 된다.** 완전한 F1 26 게임의 Q1→Q2 캡처는 저장소에 없어, 표준 규칙과 코드의 불일치까지 확인했다. 커스텀 로비·F2를 포함한 구현 정책은 실제 캡처로 확인해야 한다. N11은 올바른 컷오프 수를 넣어도 발생하는 별도 계산 결함이다.

### 이전 리뷰에서 확인되어 현재도 남아 있는 항목

아래 7건은 이번 신규 발견 수에 포함하지 않았다. 이전 재현 결과와 현재 기준 코드의 잔존 여부를 대조했다. 이전 임시 재현 디렉터리는 이미 정리되어 이번 증거 묶음에는 포함하지 않는다.

| ID | 우선순위 | 남은 문제와 발생 조건 | 현재 위치 | 수정 방향 |
|---|---|---|---|---|
| K01 | P2 | Session UID가 바뀌어도 이전 motion·telemetry·carDamage·carSetups를 유지해 새 세션에 오래된 값이 섞임 | [pitwall_manager.go:251](/workspace/frc.engineer/internal/telemetry/pitwall_manager.go:251) | 같은 세션에 속해야 하는 cache를 일관되게 무효화 |
| K02 | P2 | 재시작 병합에서 타이어 ‘관측함’ 플래그는 합쳐지지만 실제 값이 빠져 0을 측정값으로 업로드 | [merge.go:53](/workspace/frc.engineer/internal/races/merge.go:53), [uploader.go:580](/workspace/frc.engineer/cmd/sender/uploader.go:580) | 관측 근거와 값의 병합 단위를 일치 |
| K03 | P2 | 영구 거절된 앞쪽 20건이 매 sweep 시도 한도를 소진하여 뒤의 정상 기록이 계속 대기 | [upload_state.go:345](/workspace/frc.engineer/cmd/sender/upload_state.go:345) | 영구 거절 상태·재시도 대상·순회 진행 위치를 구분 |
| K04 | P1 | v4.53의 TryLock 변경 후 잠깐의 send mutex 경쟁만으로 unicast/RPC 응답이 조용히 유실 | [peer_manager.go:486](/workspace/frc.engineer/internal/rtc/peer_manager.go:486), 같은 파일 600·615·1268 | live broadcast의 drop 정책과 RPC 응답 보장 정책을 분리하고 응답에 bounded wait 적용 |
| K05 | P2 | 재시작 후 같은 미봉인 기록을 재채택하면 이전 Replay 프레임을 합치지 않고 새 프레임으로 덮어씀 | [upload_state.go:196](/workspace/frc.engineer/cmd/sender/upload_state.go:196), [merge.go:21](/workspace/frc.engineer/internal/races/merge.go:21) | 시간축·중복·상한을 명시해 이전 프레임을 보존 |
| K06 | P2 | ICE restart 성공 후 connectionState가 계속 connected이면 재연결 UI가 풀리지 않고 12초 뒤 불필요한 전체 재접속 | [useWebRTCDataChannel.ts:1399](/workspace/frc.engineer/web/src/hooks/useWebRTCDataChannel.ts:1399) | 연결 세대에 맞는 성공 신호를 처리하고 restart watchdog 해제 |
| K07 | P2 | replay 요청 취소가 브라우저 Promise만 취소하여 Sender가 취소된 프레임을 계속 전송 | [useWebRTCDataChannel.ts:781](/workspace/frc.engineer/web/src/hooks/useWebRTCDataChannel.ts:781), [main.go:617](/workspace/frc.engineer/cmd/sender/main.go:617) | 요청 ID별 서버 cancel 계약과 취소 세대 처리 |

이전 재현의 범위: K04는 실제 Pion의 열린 reliable 채널·빈 버퍼에서 20ms mutex 경쟁으로 응답 유실을 확인했고 v4.52 비교 구현은 통과했다. K05는 실제 FileStorage의 같은 ID에서 `[1000,1500]→[2000]` 덮어쓰기를 확인했다. K06은 실제 Chrome↔Chrome과 실제 훅에서 RPC/pong 정상 중 12.004초 재가입을 관측했지만 운영 Sender/Pion 전체 협상 조합은 미검증이다. K07은 취소 후 30 chunks·487,920바이트의 전송 지속과 다음 요청과의 겹침을 확인했으며, 취소 데이터가 UI에 잘못 적용되는 문제까지 재현한 것은 아니다.

### 의존성·검증·유지보수 개선

**I01 · 보안 패치 대상 정리와 재빌드**

2026-09-05의 `govulncheck -json ./cmd/sender ./cmd/server ./cmd/signaling ./cmd/platform` 결과는 48개 advisory로, 가장 깊은 도달 수준별로 module 30·package 3·symbol 15개였다. JSON 모드 명령의 exit 0을 취약점 없음으로 해석하지 않았다. **정적 호출 경로는 실제 공격 가능성이나 설정 조건 충족의 증명이 아니다.**

실제 `build/artifacts/frc-pitwall-sender.exe`의 빌드 메타데이터에서도 Go 1.26.2, Pion STUN 3.1.1, DTLS 3.1.2와 기준 HEAD를 확인했다. STUN의 malformed XOR-MAPPED-ADDRESS panic은 3.1.5에서, DTLS의 특정 ECDHE_PSK ServerKeyExchange panic은 3.1.4에서 수정되었다. 해당 버퍼·cipher 조건으로 제품을 공격하는 실험은 하지 않았다. [STUN 공식 advisory](https://pkg.go.dev/vuln/GO-2026-6163), [DTLS 공식 advisory](https://pkg.go.dev/vuln/GO-2026-6165)

도구 결과상 Go 표준 라이브러리의 1.26.6 수정 사항과 `x/net` 0.56.0, `x/text` 0.39.0 수정 사항도 검토 대상이다. 이 버전들은 해당 advisory의 수정 버전이며 모든 미래 취약점이 없다는 보장은 아니다. 의존성·툴체인 변경 후 실제 Windows Sender를 재빌드하고 WebRTC·업데이트 경로를 검증해야 배포물에 적용된다.

2026-09-05 `npm audit --json` 결과:

| 대상 | Critical | High | Moderate | Low | 합계 |
|---|---:|---:|---:|---:|---:|
| Driver Pack | 3 | 25 | 2 | 2 | 32 |
| Web | 0 | 10 | 2 | 1 | 13 |

이는 중첩·간접·빌드 의존성을 포함한 **영향 패키지 수**다. 32개 운영 공격 경로라는 의미가 아니다. Driver Pack의 Critical 3개는 `concurrently`, `shell-quote`, `tar`의 개발·빌드 체인이다. Electron 33.4.11은 lockfile에서 dev dependency지만 제품에 실리는 런타임이므로 별도 우선순위로 다뤄야 한다. 패치 가능한 항목과 메이저 업그레이드 검증이 필요한 항목을 나누어 처리한다.

**I02 · 실제로 실행되는 CI 검증 범위 확대**

[ci.yml:33](/workspace/frc.engineer/.github/workflows/ci.yml:33)은 Go 1.22를 지정하지만 `go.mod`는 1.25.0이며 실제 릴리스는 1.26.2로 빌드됐다. 자동 툴체인 다운로드에 기대지 않도록 버전 기준을 맞추고 패치 갱신을 관리할 필요가 있다. 현재 CI에는 PostgreSQL 서비스·테스트 환경변수, `test:browser`, native Windows 실행, 의존성 감사 gate가 없다.

이번에 임시 DB로 185개 테스트·하위 테스트가 **skip 없이** 통과하여 로컬 검증 공백은 줄였다. CI에서도 전용 테스트 DB와 업그레이드용 별도 DB를 제공해야 한다. 테스트는 TRUNCATE/schema 재생성을 수행하므로 운영·공유 개발 DB를 넣으면 안 된다. Browser 검사에는 N02의 Leave 중 snapshot, K06의 ICE restart, replay seek/cancel을 포함하고 Windows에는 종료·재시작·설치 전환을 포함한다. 패킷 파서뿐 아니라 N01처럼 파싱 이후 계산에도 종료 시간·비유한 입력 검사가 필요하다.

**I03 · 사용되지 않는 DeltaCalculator 저장 경로의 의도 정리**

[delta.go:79](/workspace/frc.engineer/internal/telemetry/delta.go:79), 같은 파일 133은 track 0을 미설정으로 취급하지만 0은 Australia다. 또한 저장소 전체에서 `SetTrackID` 호출이 없어 서버가 붙인 best-lap 저장 callback은 기본 track 0 상태에서 실행되지 않는다. `getBestLap` 응답 경로는 남아 있지만 현재 Web 화면의 활성 소비자는 확인되지 않았다. 현행 화면 결함 수를 늘리지 않고, 이 레거시 기능을 유지할지·제거할지 정리할 항목으로 남긴다. 유지한다면 track 연결, 세션 초기화 순서, 유효 랩·분 단위 섹터를 함께 검증한다.

**I04 · 현재 기능과 맞지 않는 제품 범위 문서 갱신**

[feature-scope-roadmap.md:15](/workspace/frc.engineer/docs/feature-scope-roadmap.md:15)은 삭제된 CockpitDashboard/QualifyingDashboard를 현재 화면으로 안내하며, archive 목록·재생 timeline·세션 분석 화면이 없다고 설명한다. 현재 RaceArchiveDrawer, replay HUD, Driver Pack SessionAnalysisSection과 맞지 않는다. 신규 개발 우선순위를 잘못 잡지 않도록 완료된 기능과 남은 품질 문제를 구분해 갱신할 필요가 있다.

### 권장 수정 순서

1. N01·N02·K04: 처리 중단, 사용자 Leave 이후 송신, RPC 유실을 먼저 해결한다.
2. N03·K01·K02·K05·N14: 저장 손실과 세션 경계의 데이터 정합성을 해결한다. 같은 session identity를 각 레이어가 어떻게 처리하는지 확인한다.
3. N05~N13·C01·N15: 유효 랩·섹터·타이어·cutoff·replay 표시의 의미를 바로잡는다.
4. N04·K03·K06·K07: 반복 대용량 응답, 업로드 진행 정체, 재접속·취소 흐름을 개선한다.
5. I01·I02는 위 수정과 함께 진행하고, I03·I04는 기능 의도·문서 정리로 처리한다. 각 수정은 재현 시나리오를 회귀 검사로 전환한 뒤 필요한 플랫폼 검증을 거친다.

## 3. Final Convention Review

- **Layer Analysis — Presentation**: live/replay, current/completed lap, 세션 identity가 표시 계층에서 섞이는 문제를 확인했다. authoritative best와 view-local accumulator의 책임도 분명히 해야 한다.
- **Layer Analysis — Service**: Sender 입력 계산은 유한 시간 내 종료되어야 하고, intercom Leave·RPC 응답·cancel은 세대와 종료 조건이 명확해야 한다. 불필요한 전체 리팩토링 없이 각 경계의 계약을 수정하는 방향이다.
- **Layer Analysis — Repository**: track map 교체, 재시작 summary 병합, 업로드 seal과 retry 상태를 구분했다. 플랫폼 소유권·트랜잭션·마이그레이션 경로의 기존 DB 검사도 실제 PostgreSQL에서 실행했다.
- **Simplicity Check / Style Match**: 제품 소스나 테스트 체계를 변경하지 않고 임시 overlay와 독립 하네스로 재현했다. 무관한 리팩토링·기능 추가를 제안 범위의 필수 작업으로 만들지 않았다.
- **승인된 동작 제외**: `history/20260710-fable-max-review-triage.md`의 Electron copied strategy cleanup, legacy empty owner-token grace, forwarded private IP/DNS·LAN opt-in 결정; `history/20260720-pitwall-pit-loss-measured-and-server-avg.md`의 전체 pit-lane 체류시간 정의와 로컬 fallback; `history/20260822-sender-capture-reliability-sealed-id.md`의 machine-global seal·boot/pair sweep·2시간 hold·bounded retry; `history/20260905-replay-backpressure-isolation.md`의 Windows 임시 snapshot 비용; `history/20260905-managed-sender-shutdown.md`의 bounded 종료 정책을 새 결함으로 다시 올리지 않았다.
- **반증·보류**: 호출자가 없는 `CopyRawJSON`의 장시간 RLock, 활성 UI가 확인되지 않은 wear=0·legacy delta 필드는 신규 사용자 결함에서 제외했다. 로컬 HTTP CSRF나 Electron IPC를 통한 침해는 실제 exploit 경로를 확인하지 못했으므로 발견했다고 보고하지 않는다.

## 4. Status

### Verification

| 검증 | 결과 | 해석 |
|---|---|---|
| 실제 PacketLogger→Analyze·fastestLap | 무효 랩, 완료 섹터, 타이어, 정렬의 4개 불변식 검사 실패 | N05·N06·N07·N15 재현 |
| 실제 Parser→Processor의 단일 Motion | Inf·큰 유한 yaw 모두 처리 미종료 | N01 재현; 앞선 임의 입력 전체 실행은 이 문제로 중단됐으며 통과가 아님 |
| TrackRecorder 직접 및 PitwallManager 경유 | 두 경계에서 파일·메모리 지도 축소 | N03 재현; 호출 경로 관찰 테스트의 PASS는 손상을 관측했다는 뜻 |
| Replay 복사 helper | 600/1080→0/0 | N08 재현 |
| 현재 latest 결과 핸들러의 httptest | 2분 기록 3,680,428바이트 | N04 재현; 복사한 핸들러 fixture는 기준 HEAD 전용 |
| 실제 React/Zustand/Chrome | qualifying·history·session state와 실제 mic 송신 재개 관측 | N02·N09~N14, C01의 코드 동작 재현; 결과 JSON 보관 |
| 격리 PostgreSQL 17, `go test -race -p 1 ./internal/platformsvc ./cmd/platform -count=1 -json` | 2 package, **185 tests/subtests PASS, 0 skip, 0 fail** | 새 DB 및 upgrade 전용 DB 사용 |
| 파서 한정 임의 바이트 입력 | 25,000건, 길이 0~4096, 형식 2024/2025/2026·ID 0~16, 10,087건 parse 성공, **panic 0** | Processor 이후 계산의 안전성 보장이 아님 |
| `TestBuildState24CarPayloadSize` | 24대+2,000점 map **89,610B**, steady **33,534B**, PASS | 현재 fixture에서 256KiB 메시지·128KiB steady 기준 충족 |
| 의존성 감사 및 배포 Sender build metadata | I01의 패치 대상 확인 | 정적 도달성·패키지 수와 실제 공격 가능성을 구분 |

직전 릴리스에서 통과한 전체 Go/web/Driver Pack 기준 테스트는 제품 코드 변경이 없어 무조건 반복하지 않았다. 이번 검증은 그때 비어 있던 실제 DB와 추가로 찾은 실패 조건에 집중했다.

### Coverage와 아직 별도로 필요한 실환경 확인

- 깊게 본 범위: Sender의 수신→처리→DTO→저장→재시작 병합→업로드, WebRTC reply/replay/ICE, Pitwall·퀄리파잉 계산·세션 상태, intercom runtime/SFU gating, 로컬 분석·latest 결과 폴링.
- 추가 소스·기존 검사 확인 범위: 플랫폼 ingest·소유권·View As·wallet/market 트랜잭션·migration, signaling/SFU provider 경계, Hub의 account generation/private rows/analysis playback, Broadcast 계산, Electron preload·navigation·permission·Sender lifecycle·updater, 의존성·CI. 모든 화면 상호작용이나 외부 서비스 조합을 전수 실행한 것은 아니다.
- **Native Windows**: 실제 인스톨러 업데이트, 트레이·오버레이 hotkey, 방화벽·포트 충돌, 디스크 부족, 강제 종료 직전 저장을 확인할 필요가 있다. 이전 Wine 실행을 native Windows 검증으로 계산하지 않았다.
- **실제 게임 캡처**: F1 25/26의 Q1→Q2→Q3, 세션 UID 교체, flashback·spectator/player 전환과 커스텀 grid를 포함한 재생 fixture가 필요하다. 현재 통제된 재현은 코드 경계 결함을 증명하지만 모든 게임의 송신 순서를 대표하지 않는다.
- **실제 네트워크**: NAT/TURN을 거치는 Chrome↔배포 Pion ICE restart, 운영 SFU의 지연 ACK·중간 snapshot, 장시간 replay와 live 동시 사용은 실환경 확인이 남는다.

이 보고서는 위 범위의 추가 감사를 완료한 결과다. 결함이 더 존재하지 않는다는 보증이나 발견 사항을 이미 수정했다는 보고가 아니다.

### Cleanup

감사용 PostgreSQL만 정상 종료했다. 브라우저·로컬 서버·테스트 프로세스는 정리했다. 재현 자료를 압축 보관한 뒤 감사 임시 디렉터리를 제거했다. 제품 tracked 파일은 변경하지 않았고, 작업 전에 존재하던 미추적 문서 5개도 유지했다.
