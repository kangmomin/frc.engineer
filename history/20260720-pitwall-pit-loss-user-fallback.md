# Pit Exit 피트로스 — 사용자 설정값 폴백 (Phase 1) + 실측·서버평균 로드맵

- **날짜**: 2026-07-20
- **이슈**: `PitExitPanel`은 `pitLossMs` 결측 시 "Pit-loss data unavailable"을 띄운다. `pitLossMs`의
  유일한 출처는 정적 트랙 데이터셋(`race_strategy.pit_stop_time_lost_s`)이라 해당 트랙에 값이 없으면
  패널 전체가 죽는다. 사용자는 (1) 헤더 "Display" 버튼을 "Settings"로 바꾸고 (2) 팝오버에서 기본
  pitstop 시간을 설정해 폴백으로 쓰며, 최종적으로 (3) 실측값으로 대체하고 (4) 서버에 누적해 트랙·유형별
  평균을 산정하길 원했다(대화). 스코프가 4계층이라 한 PR로는 불가 → Phase 분할 판단 필요.

- **결정**:
  1. **4계층을 3 Phase(별도 PR)로 분할, 이번엔 Phase 1(웹 설정값 폴백)만 구현**. 우선순위 체인 최종형:
     `실측(Ph2) ?? 서버 트랙·유형평균(Ph3) ?? 트랙 baseline(기존) ?? 사용자 설정값(Ph1, 기본 22초)`.
     Phase 1 배포 중간 상태에선 `트랙 baseline ?? 사용자값`.
  2. **폴백은 status 게이트 뒤에서만**(Fable L1): `useStrategyGuide.status`가 `ready`(트랙값 부재)/
     `unavailable`일 때만 사용자값을 쓴다. `idle/loading` 중엔 null 유지 → 폴백값이 먼저 떴다가
     트랙값으로 점프하는 것을 방지.
  3. **폴백값 출처를 UI에 표기**(Fable E2, anti-fabrication): `PitExitVM.pitLossFallback` flag를
     추가해 사용자 폴백값은 `loss 22.0s (set)` 로, 트랙 실측 스크랩값과 시각적으로 구분한다.
  4. **입력 NaN 가드 필수**(Fable E1): `<input type=number>` 빈 값→`clamp(NaN)`이 NaN을 통과→
     `pitLossMs=NaN`→derivePitExit 가드가 걸려 패널이 unavailable로 **회귀**. draft state +
     `Number.isFinite` commit 게이트로 무효 입력은 커밋하지 않고 마지막 유효값으로 복원.
  5. **설정 범위 5~60초, 기본 22초**: sender `defaultStrategyConfig.PitTimeLossMs`(22000ms,
     `cmd/sender/main.go:45`) 및 clamp(5000~60000ms, `:1224`)와 동일 정책으로 맞춤.
  6. **스톱 유형 분류(Phase 2용)는 정지시간 임계값**: `PitStopTimer` ≤3.5s→타이어만, ≥7s→윙 포함
     (사용자 도메인 규칙). Car Damage 스냅샷 차분 대신 채택(더 단순, sender에서 즉시 분류 가능).

- **결정자**: 사용자(전체 스코프 승인 + 임계값 규칙 명시) + 합의(Fable REVISE 리뷰 반영)

- **근거**: pitLossMs 소비처는 `derivePitExit` 단 한 곳이라 폴백 도입의 blast radius가 PitExit로 한정
  된다(Fable 확인). 정적 트랙 데이터가 유일 출처였던 구조에 사용자 폴백을 얹으면 결측 트랙에서도 패널이
  살고, anti-fabrication 원칙은 `(set)` 표기로 지킨다. Phase 1은 웹 프론트만 손대므로 `cmd/server`
  임베드 웹으로 배포되어 Driver Pack 릴리스가 불필요(가벼움). 실측/서버평균은 sender·platform 변경이
  필요해 별도 Phase로 미룬다.

- **기각된 대안**:
  - **정지시간 작업별(윙 N초/타이어 M초) 직접 분해**: 게임 UDP가 피트 시간을 `PitLaneTimeInLaneInMS`/
    `PitStopTimerInMS` 2계층만 제공(`internal/packets/lapdata.go:39-40`) → 원천 불가(조사 확정).
    임계값 유형 라벨링으로 우회.
  - **Car Damage 스냅샷 차분으로 유형 판정**: 사용자가 임계값 규칙 명시 → 더 단순한 쪽 채택.
  - **실측값 전용 신규 P2P 메시지 타입**: 기존 `BroadcastPitwallState` 4Hz 경로에 이미
    pitStopTimer/pitLaneTime이 흐름(`internal/rtc/broadcaster.go:44`) → 신규 채널 불필요(Phase 2).
  - **useDisplayPrefs/DisplaySettings 단위 테스트**: 프로젝트에 훅/컴포넌트 테스트 인프라(jsdom/RTL)
    부재 → 신규 도입은 Phase 1 surgical 범위 초과. 순수 함수 `derivePitExit`만 테스트 추가.

- **하위호환/Deferred**:
  - **sender 트랙별 `PitTimeLossMs` cfg 와 웹 폴백값의 이원화**(Fable A1): sender엔 이미 트랙별 사용자
    설정(`PUT /api/strategy-settings`, `cmd/sender/main.go:1214-1241`)이 있고 sender 전략 오버레이가
    소비한다. Phase 1은 웹 뷰어에 별개 전역 localStorage 값을 둔다. 기각 아닌 **의도된 이원화** —
    원격 뷰어는 sender HTTP API에 접근 불가하므로 localStorage가 유일한 선택. Phase 2(sender 릴리스
    동반)에서 `getStrategyGuide` 응답에 sender cfg 주입으로 일원화 검토.

- **수정 내역**: `useDisplayPrefs.ts`(pitLossSec 설정값·validate·유한값 가드 setter),
  `DisplaySettings.tsx`(Pit Stop 입력 섹션·draft 커밋 가드·제목/aria "Settings" 통일),
  `PitWallHeader.tsx`(버튼 "Display"→"Settings"), `PitWallView.tsx`(status 게이트 폴백 배선),
  `derive/pitExit{,.test}.ts`(`pitLossFallback` VM flag + 5번째 인자, 테스트 3케이스 추가),
  `PitExitPanel.tsx`(`(set)` 표기). 전체 테스트 374 green, tsc/eslint clean.
  계획 문서: `/home/dev/.claude/plans/virtual-churning-truffle.md`.

- **재발 시 대응**: "폴백값이 트랙값이랑 똑같이 보인다" → 결정 3 인용(`(set)` 표기). "로딩 중 값이
  튄다" → 결정 2 인용(status 게이트). "빈 입력에 패널이 죽는다" → 결정 4 인용(NaN 가드). "sender에
  이미 설정 있는데 왜 웹에 또 두나" → Deferred(A1) 인용. "정지시간을 윙/타이어로 쪼개자" → 기각된
  대안 1 인용(게임 데이터 부재). "설정 컴포넌트 테스트 없다" → 기각된 대안 4 인용(인프라 부재).
