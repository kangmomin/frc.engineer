# Pit Exit 피트로스 — 실측 측정(Phase 2) + 서버 트랙·유형별 평균(Phase 3)

- **날짜**: 2026-07-20
- **이슈**: `20260720-pitwall-pit-loss-user-fallback.md`(Phase 1, 사용자 설정값 폴백)의 후속. 사용자 vision은
  "트랙 데이터 → 없으면 22초 → **실제 피트가 발생하면 실측값** → 실측값을 **서버에 누적해 트랙·유형별 평균**
  산정, 정지시간으로 스톱 유형(타이어만/윙) 구분"이었다. Phase 2(실측)와 Phase 3(서버 평균)을 한 작업으로
  구현. 게임 데이터 한계·아키텍처 조사 2건 + Fable 2-라운드 리뷰로 수렴.

- **결정**:
  1. **실측 = 게임 직접 측정값(레인 체류/정지), net loss 근사는 제외**. F1 UDP는 피트 시간을
     `PitLaneTimeInLaneInMS`(레인 체류)/`PitStopTimerInMS`(정지) 2계층만 준다(`internal/packets/lapdata.go:39-40`).
     net loss(정상주행 대비 순손실)는 in/out-lap 캡처 + out-lap 1랩 대기 + race-pace 기준 부재로 **근사치일
     뿐**이라, 사용자가 원한 구성요소 분리(이동=체류−정지, 정지, 유형)에는 실측 2값이 더 정직하다.
  2. **스톱 확정은 피트 진출 하강 에지(PitStatus>0→0)**(Fable C2). `NumPitStops` 증가 시점이 게임에서
     릴리스/진입/진출 중 언제인지 미검증이라, 증가를 트리거로 쓰면 과소측정·멀티스톱 오염 위험. 진입 상승
     에지에서 관찰값 초기화(크로스 오염 차단), 피트 중 최댓값 축적, **진출 하강 에지에서 `NumPitStops>진입값`
     일 때만 확정**(drive-through 배제). 어느 증가 타이밍에서도 풀 체류 관찰 후 확정된다.
     (`internal/telemetry/pitwall_manager.go` `pitMeasureState`, 신규 테스트 `TestPitMeasureCapture`로 고정.)
  3. **캡처 상태 변이는 `mutate` 경로에서만**(Fable C1). `BuildStateReadOnly`는 RLock만 잡으므로 캡처 쓰기를
     `if mutate`로 가드하고 읽기 경로는 확정값 읽기만 — 동시 조회 데이터 레이스 제거(`-race` 통과).
  4. **우선순위 체인 = 실측 ?? 트랙 baseline ?? 사용자값**, 출처는 `pitLossSource`('measured'|'track'|'user')
     enum으로 pitExit VM에 전달, `(live)`/`(set)` 라벨로 표기(Phase 1의 boolean flag를 일반화 — Fable E2 권고).
  5. **스톱 유형은 정지시간 임계값(≤3.5s tyres / ≥7s wing / else unknown), 서버 집계 시 CASE로 분류**.
     `race_pit_loss`에 유형을 저장하지 않고 `stationary_ms`만 저장해 조회 시 분류 → 정책 변경 시 마이그레이션 불요,
     임계값 단일 소스(`internal/platformsvc/pitloss.go`, 프론트 중복 없음).
  6. **서버 저장은 실측(measured 경로)만 업로드**(Fable M3). 라이브 폴백(`player.PitLaneTime>0`, 종료 시점
     부분값일 수 있음)은 `PitLaneTimeMS`를 채우지 않고 표시용 `EstimatedTimeLostMS`만 채운다 → 업로더 게이트
     (`PitLaneTimeMs>0`)가 부분값을 흘리지 않아 공용 평균이 오염되지 않는다.
  7. **기존 패턴 재사용**: `race_pit_loss`(007 마이그레이션, races 사이드 테이블), IngestRace 트랜잭션 INSERT,
     `PitLossByTrack` 집계(`avg()::int + GROUP BY`, PaceLeaderboard 미러), `GET /tracks/{id}/pit-loss` 공개
     엔드포인트, sender uploader 필드 미러 — 전부 leaderboards/ingest 컨벤션 복제. platform은 Railway 자동배포.

- **결정자**: 사용자(전체 스코프 승인 + "실측 우선" + 임계값 규칙 명시) + 합의(조사 2건 + Fable 2-라운드 REVISE→PROCEED)

- **근거**: 실측 2값은 게임이 실제 측정한 값이라 net loss 근사보다 방어 가능하고, 사용자 요구(구성요소 분리)에
  직접 매핑된다. 진출 하강 에지 확정은 게임의 불확실한 NumPitStops 타이밍에 대한 의존을 제거한다. 유형을
  저장 대신 조회 시 분류하면 단일 소스가 유지된다. 서버 백본은 기존 platform 패턴 복제라 신규 리스크가 낮다.

- **기각/Deferred**:
  - **net loss 근사(in/out-lap vs 그린랩 델타)**: out-lap 1랩 대기·race-pace 기준 부재로 근사치 → 실측 2값 채택.
  - **[Deferred, Fable M1] 실측(레인 체류) vs baseline(net loss) 물리량 혼합**: 레인 체류 = net + 트랙 주행분
    (~5-8s)이라, 실측 전환 시 pitExit 재합류 추정 입력이 계단식으로 바뀌어 (live) 모드 추정이 편향될 수 있다.
    **사용자가 "실측값으로 대체"를 명시 지시**했으므로 실측 우선을 유지하고 편향을 수용한다. 재제기 시: 표시용과
    추정 입력을 분리(실측은 표시, 추정 입력은 baseline)하는 대안이 있으나 사용자 결정으로 보류.
  - **스톱별(멀티스톱 각각) 유형 저장**: race당 대표값(마지막 확정 스톱) 1행으로 단순화. 유형은 집계 시 분류.
  - **PitwallView의 서버평균 실시간 소비 배선**: P2P 실측이 이미 최우선이고, 플레이어 미피트 시 스톱 유형 예측이
    모호하며 별도 훅(platform HTTP fetch)이 필요 → 이번 범위 제외. 클라이언트 메서드(`platform.ts pitLoss()`)는
    준비. 후속에서 usePitLossAverage 훅으로 "서버평균" 계층을 체인에 삽입 검토.
  - **useDisplayPrefs/DisplaySettings/telemetry 캡처의 프론트 컴포넌트 테스트**: 프론트 훅/컴포넌트 테스트 인프라
    (jsdom/RTL) 부재 → Go 상태머신은 테스트 추가, 프론트는 순수 함수(derivePitExit)만 테스트.

- **수정 내역**:
  - Phase 2: `dto/pitwall.go`(MeasuredPitLane/StopMs), `telemetry/pitwall_manager.go`(pitMeasureState 캡처 +
    세션 리셋 + mutate 가드), `telemetry/pitwall_manager_test.go`(캡처 상태머신 테스트 2건),
    `web/src/types/telemetry.ts`, `web/src/views/pitwall/{PitWallView,PitExitPanel}.tsx`,
    `derive/pitExit{,.test}.ts`(pitLossSource enum).
  - Phase 3: `races/types.go`(RacePitSummary.StationaryTimeMS + measured 우선 debrief), `races/types_test.go`,
    `platformsvc/migrations/007_pit_loss.sql`, `platformsvc/ingest.go`(UploadPit + validate + INSERT),
    `platformsvc/pitloss.go`(집계), `cmd/platform/main.go`(엔드포인트), `cmd/sender/uploader.go`(매핑),
    `web/src/hub/data/platform.ts`(클라이언트 메서드).
  - 검증: go build/vet green, go test -race(telemetry) + platformsvc/races/dto green, web tsc/test 374 + eslint clean.

- **재발 시 대응**: "NumPitStops로 확정하지 왜 에지냐" → 결정 2(게임 타이밍 미검증). "ReadOnly에서 왜 캡처
  안 하냐" → 결정 3(C1 레이스). "실측이 트랙값보다 큰데 추정이 이상하다" → Deferred M1(편향 수용, 사용자 지시).
  "라이브 레인시간도 업로드하자" → 결정 6(부분값 오염). "유형을 테이블에 저장하자" → 결정 5(단일 소스·마이그레이션
  회피). "서버평균이 왜 pitExit에 안 뜨냐" → Deferred(범위 제외, 클라이언트 메서드는 준비됨).
