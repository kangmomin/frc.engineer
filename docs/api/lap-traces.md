# Selected lap traces

`GET /api/sessions/{directory}/trace?lap=1[&fromM=250&toM=330]`

Sender와 로컬 server가 같은 `internal/analysishttp.TraceHandler`를 사용한다. 기존 `/analysis`의 전체 랩 요약·50m 평균 trace는 유지한다. 이 endpoint는 선택한 완료 랩의 원래 수집 주기를 보존하며 HTTP로만 전달한다. WebRTC DTO는 확장하지 않는다.

## 요청과 오류

`lap`은 1–255 정수다. `fromM`·`toM`은 함께 생략하거나 유한한 수로 지정하며, `0 ≤ fromM < toM`이고 기록의 extent 안에 있어야 한다. 양쪽 경계는 포함한다. 중복·알 수 없는 query, 잘못된 경로와 로그 루트 밖 symlink는 거부한다.

| HTTP | `error.code` | 의미 |
|---|---|---|
| 400 | `invalid_query` | 경로·lap·구간 오류 |
| 404 | `not_found` | 세션·완료 랩·필수 lap_data 파일 없음 |
| 405 | `method_not_allowed` | GET만 허용, `Allow: GET` |
| 413 | `trace_too_large` | 반환 native 행 합계 60,000개 또는 JSON 16 MiB 초과 |
| 422 | `trace_unavailable` | 완료 시도를 안전하게 식별할 수 없음 |
| 500 | `internal_error` | 실제 파일 읽기 실패 |

오류 형태는 `{ "error": { "code": "…", "message": "…" } }`다. 필요한 경우 `extent`, `maxSamples`, `maxBytes`를 추가한다. 413은 평균화·잘라내기로 숨기지 않으며 클라이언트가 작은 구간을 선택하게 한다. 선택적 telemetry·motion·status 파일이 없어도 200과 빈 배열을 반환한다. 구버전 서버의 일반 텍스트 404만 미지원으로 처리하고, 구조화된 404는 실제 결측으로 구별한다.

## 응답과 단위

정확한 Go 타입은 [trace.go](../../internal/analysis/trace.go), TypeScript 타입은 [analysisTrace.ts](../../apps/setup-manager/src/analysisTrace.ts)에 있다.

| 필드 | 의미 |
|---|---|
| `lapNum`, `attemptId`, `playerIndex`, `valid` | 완료 랩과 안전하게 선택한 시도·플레이어·유효성 |
| `trackId`, `packetFormat`, `gameYear`, `trackLengthM` | 기록에 있는 값, 알 수 없으면 null |
| `extent` | 트랙 길이를 알면 0–길이, 아니면 관측 거리의 범위; 모두 없으면 null |
| `window` | 요청한 구간, 전체 랩이면 null |
| `finish` | 별도 공식 완료점 `{distanceM: number|null, elapsedMs, source: "lastLapTime"}` |
| `timing[]` | 실제 `CurrentLapTimeInMS`인 `elapsedMs` |
| `controls[]` | `speedKph`, `throttle`·`brake` 0–1, `steer` −1–1 입력, `gear` −1=후진/0=중립, `rpm` |
| `motion[]` | 실제 월드 좌표 `xM`, `zM` (m) |
| `status[]` | `fuelKg` (kg), `ersJ` (J); 임의 백분율로 환산하지 않음 |

각 행은 `distanceM`, 실제 패킷 시간의 `sessionTimeMs`, `segment`, `alignment=exact|interpolated|unavailable`을 가진다. 결측·비정상 값은 null이며 실제 0과 다르다. 배열은 항상 배열이다. 전체 요청은 안전하게 시도를 식별했지만 거리를 정렬하지 못한 native 행도 `distanceM:null`로 보존한다. 구간 요청은 구간 안의 정렬된 행만 반환한다.

`quality`는 각 스트림의 `available`, `capturedSamples`, `returnedSamples`, `alignedSamples`, `method`, `medianIntervalMs`, `maxSkewMs`, `maxSkewFrames`와 공통 `maxInterpolationGapMs`를 제공한다. captured는 구간 필터 이전의 안전하게 식별된 샘플 수다. returned·aligned는 응답 기준이며 시점·skew를 구할 수 없으면 null이다. method는 `overallFrame|captureTime|frame|mixed|none`이다.

## 정렬과 비교 규칙

lap_data의 공통 기록 순서로 완료 시도를 선택한다. flashback으로 버려진 조각을 다른 스트림의 독립 세대 번호로 연결하지 않는다. 명시적 플레이어·세션 UID를 확인하고, 신뢰할 수 있는 증가 overall frame, 모호하지 않은 capture timestamp, 제한적인 legacy exact frame 순서로 식별한다. 반복 frame을 map 덮어쓰기로 소거하지 않는다.

[Assumption] 거리만 동일한 연속 timing 구간의 100ms 이하 anchor 사이에서 보간한다. 20Hz lap 시계 사이의 60Hz 페달 입력도 원래 행을 유지한다. 2Hz status 자체의 간격을 100ms 조건과 혼동하지 않는다. 외삽·속도 적분·frame→ms 변환·긴 공백 채우기를 하지 않는다. 결측은 구간을 끊고, 좌표 결측만으로 완료 시도를 다시 시작하지 않는다. segment 번호는 **응답 내 개별 스트림**에서만 의미가 있다.

Δt는 같은 물리적 거리에서 `compare elapsed − baseline elapsed`다. 양수는 compare가 느림을 뜻한다. 겹쳐 모호한 timing 구간이나 결측을 가로질러 연결하지 않는다. 공식 완료 차이는 따로 표시하고 관측 곡선을 끝값에 맞춰 늘리지 않는다. 트랙·양의 길이·packet format이 알려져 일치해야 Δt·지도 중첩·자동 연습 제안을 제공한다. [Assumption] 길이 허용 차이는 1m이며, 두 game year를 알면 같아야 한다.

기어는 단계, 연료·ERS는 관측점으로 표시한다. 지도 경로는 원래 X/Z 쌍을 보존하고 임의로 닫거나 회전하지 않는다. 각 선택 쌍과 URL·refresh·범위를 요청 소유권에 포함해 이전 응답이 현재 선택을 덮지 않게 한다. raw cache는 현재 비교 쌍으로 제한한다.

## 분석의 한계

코너 apex는 구간 라벨의 기준이며 정확한 주행 단계 경계가 아니다. [Assumption] 브레이크 시작 >10%, 해제 ≤5%, 스로틀 재적용 ≥80%와 100ms 지속을 사용한다. 양쪽 시계가 전체 구간을 덮을 때만 `Δt(end) − Δt(start)`를 계산한다. 다음 가속 구간의 손실은 관측된 연관이며 앞 코너가 원인이라는 증명이 아니다. 양의 손실을 뒷받침하는 구간에만 최대 3개의 실험·재측정 기준·이동 버튼을 제공한다. 실제 재주행 효과와 수동 단계 라벨 일치도는 검증하지 않았다.

기존 `lockupCount`는 brake >90%·speed >80km/h의 강한 제동 에피소드다. UI는 휠 잠김 미확인으로 표시하고 이 숫자만으로 브레이크 압력·바이어스를 바꾸라고 권하지 않는다. 실제 휠 잠김 검출은 별도 미완료 항목이다.

입력 파일은 시작 시 stat한 바이트 수만 읽고 취소를 확인한다. 파일의 동시 덮어쓰기까지 고정한 트랜잭션 스냅샷은 아니다. 모든 완료 랩에 조밀한 응답을 쌓는 cache는 추가하지 않았다. coarse 분석의 전역 frame 신뢰성·개수 인덱스는 모든 랩이 공유한다.
