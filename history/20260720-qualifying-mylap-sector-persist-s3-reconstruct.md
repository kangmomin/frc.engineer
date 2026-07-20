# My Lap 섹터 표시를 '완료 트리오 유지' 방식으로 전환하고 S3 역산을 허용

- **날짜**: 2026-07-20
- **이슈**: Qualifying "My Lap" 패널의 섹터 표시(`deriveMyLap`)가 (1) S3 실제 기록을 절대
  보여주지 않고(`currentSector === 2 ? '•••' : '—'`), (2) 라이브 와이어 값을
  `currentSector` 게이팅으로 표시해 새 랩 시작(currentSector=0) 즉시 S1·S2가 대시로 사라졌다.
  사용자 요구: "섹터 1·2·3가 나오고 다음 랩 S1이 나오기 전까진 리셋되지 않도록."
  기존 코드에는 MyLap S3에 대해 명시적 **"역산 금지"** 주석(anti-fabrication)이 있었다.
- **결정**:
  1. 섹터 슬롯을 프레임 간 상태(`usePlayerSectorDisplay`)로 유지 — 마지막 완료 섹터를
     **다음 랩 S1 완주 전까지** 붙든다.
  2. MyLap S3에 한해 **역산 허용** — 랩 롤오버 직전 스냅샷의 `lastLapTime - s1 - s2`로
     직전 '완료 랩'의 S3를 계산해 표시한다.
- **결정자**: 사용자 (요구) + 에이전트 (설계)
- **근거**:
  - 유지 방식은 순수 유도로는 불가능(와이어 필드가 랩 시작 시 리셋됨) → 상태 hook 필요.
    상태 전이는 순수 reducer `advanceSectorDisplay`로 분리해 단위 테스트로 고정했다.
  - S3 역산은 **신규 fabrication이 아니다**: `useSectorAccumulator`가 `bestS3`에 이미
    채택·배포한 동일 기법이다. 현재 진행 중 랩의 미완 S3를 지어내는 게 아니라, 이미 완주해
    `lastLapTime`에 확정된 '완료 랩'의 S3만 보여주므로 anti-fabrication 원칙과 충돌하지 않는다.
    무효(아웃랩 등 `lastLapTime<=0`) 시엔 덮어쓰지 않고 대시로 degrade.
- **기각된 대안**:
  - 슬롯별 독립 유지(S1은 새 랩 값, S2/S3는 옛 랩 값 혼재) — 서로 다른 랩 섹터가 한 화면에
    섞여 오독 위험. "다음 S1에서 리셋"이라는 사용자 표현과도 어긋나 기각.
  - hook 미분리(전이 로직을 effect 내 인라인) — accumulator 선례이나, 상태 머신이 트리키해
    테스트 가능한 순수 reducer 분리를 택함.
- **수정 내역**:
  - 신규 `web/src/views/qualifying/useSectorDisplay.ts` (reducer + hook) + 테스트
  - `derive/myLap.ts`: `SectorDisplay` 인자 추가, currentSector 게이팅 제거, `s3Color` 추가
  - `MyLapPanel.tsx`: S3 색상 하드코딩(muted) → `lap.s3Color`
  - `QualifyingView.tsx`: hook 배선
  - `derive/myLap.test.ts`: 라이브 게이팅 테스트 → disp 기반 테스트로 교체
- **재발 시 대응**: simplify/code-review 등에서 "MyLap S3 역산은 fabrication" 지적이 재제기되면
  본 문서 인용(완료 랩 실측치 재사용, accumulator bestS3와 동일 기법)으로 종결.

---

## 후속 결정 (2026-07-20): 자체 역산 hook 폐기 → lapHistoryStore 재사용

- **이슈**: 위 `usePlayerSectorDisplay`의 S3 역산이 실환경에서 **안 떴다**. FABLE end-to-end
  분석 + 실측 캡처(`test-sets/quali-full-session`) 검증으로 원인 확정:
  `lastLapTime`·`currentLapNum++`·섹터 리셋이 **같은 패킷에서 원자적으로** 뒤집힌다(옛 주석의
  '롤오버 직전 틱 선반영' 가정은 사실과 반대였다). 그래서 롤오버 프레임의 `prev.lastLapTime`은
  '직전 랩 총합'(첫 랩 뒤엔 0)이라 `s3 = prev.lastLapTime - s1 - s2`가 음수/오류 → `s3>0`
  가드 실패로 **첫 완주 랩 후 S3가 계속 대시**(이후엔 오차 +수백~수천 ms의 틀린 값).
  ※ 추가 확인: 사용자가 "어떠한 상황에서도 안 뜬다"고 한 근본 이유는 **돌리던 빌드(v4.46.0)가
  S3 기능 커밋(`7a25b452`)보다 앞서** 애초에 S3 숫자 표시 코드 자체가 없었기 때문 — 재배포 필요.
- **결정**: 자체 역산(`useSectorDisplay.ts` 전체: reducer+hook+테스트)을 **폐기**하고, 이미 검증·
  배포된 `lapHistoryStore`의 `LapRecord.s3Ms`를 재사용한다. My Lap 섹터 표시는 **stateless
  하이브리드**로 파생한다 — 현재 랩에서 완주한 S1/S2는 라이브(currentSector 게이팅), 아직 안 나온
  슬롯과 S3는 직전 완료 랩(lapHistoryStore) 값으로 폴백.
- **결정자**: 사용자 (버그 리포트 "섹터3 아직 안나오고") + 에이전트 (원인 분석/재설계)
- **근거**:
  - `lapHistoryStore`는 **원자적 +1 롤오버 프레임**에서 커밋한다 — 완주 랩 총합은 그 프레임의
    `d.lastLapTime`, 그 랩 섹터는 직전 스냅샷(snap)에 남아 있어 `s3 = d.lastLapTime − snap.s1 −
    snap.s2`가 안정적이다(코드의 '+1 경로'가 실제 주 경로). FABLE가 실측 캡처를 4Hz/2Hz·모든
    샘플 오프셋으로 재현한 결과 4개 랩 모두 정확한 s3 커밋 확인. 동일 `s3Ms`가 이미
    DriverDetailModal·PostRaceDebrief에서 표시 중 — 검증된 데이터.
  - 중복 역산 로직 제거(DRY) + 상태 hook 삭제로 순 코드 감소.
  - stateless라 rewind/세션 리셋 처리를 lapHistoryStore에 위임(자체 리셋 로직 불필요).
- **수정 내역**:
  - 삭제: `web/src/views/qualifying/useSectorDisplay.ts` + `.test.ts`
  - `derive/myLap.ts`: `SectorDisplay` 인자 → `LastLapSectors`(직전 완료 랩) + 라이브 현재 섹터 폴백
  - `QualifyingView.tsx`: hook 배선 제거 → `useLapHistoryStore`에서 플레이어 마지막 레코드 조회
  - `derive/myLap.test.ts`: 하이브리드(라이브 오버라이드 + 폴백) 테스트로 교체
  - **`useSectorAccumulator.ts`**: `bestS3` 역산이 같은 원자성 버그(`snap.lastLapTime` 사용)를
    갖고 있어 bestS3가 틀리거나 첫 완주 랩까지 비었다 → `d.lastLapTime`(+1 롤오버만) 사용으로
    정정. (bestS3는 S3 타일 색상·`computeOverallBestSectors`·tryStatus 베이스라인에 반영.)
  - `lapHistoryStore.ts` 헤더/인라인 주석: '틱 선반영' 오기술을 원자적 전이·'+1 주 경로'로 정정.
- **재발 시 대응**: "My Lap S3가 왜 lapHistoryStore를 거치나 / 자체 역산이 더 단순하지 않나" 또는
  "롤오버 직전 틱에 lastLapTime이 먼저 갱신된다" 재제기 시 본 섹션 인용(전이는 원자적 동일 패킷 —
  실측 확정 — 이라 자체 롤오버 역산은 신뢰 불가, 검증된 lapHistoryStore 소스로 통일).

---

## 후속 결정 (2026-07-21): Race(Pit Wall) 리더보드 sector 컬럼에도 동일 적용

- **이슈**: 사용자가 실제로 보던 화면은 Qualifying이 아니라 **Race(Pit Wall) 뷰**였다. 리더보드
  `sector` 컬럼(`deriveSectorCells`)은 S3를 상시 `'—'`로 하드코딩("현재 랩 sector1/2 + lastLapTime
  혼합 = fabrication"이라며)했고, S1/S2도 currentSector 게이팅이라 새 랩 시작 시 즉시 '·'로 사라졌다.
  → 최초 요청("섹터3 안나오고 너무 빨리 사라짐")의 진짜 대상.
- **결정**: `deriveSectorCells`를 My Lap과 동일한 lapHistoryStore 하이브리드로 전환한다 — 현재 랩
  라이브 S1/S2 우선, 미완 슬롯과 S3는 드라이버별 직전 완료 랩 레코드로 폴백. S3는 '같은 완료 랩'의
  실측(lastLapTime−s1−s2, 원자적 +1 커밋)이라 fabrication 아님.
- **근거**: lapHistoryStore는 전 드라이버 히스토리(Map<index, LapRecord[]>)를 이미 축적 → 리더보드
  전 드라이버에 드라이버별 마지막 레코드로 S3/폴백 제공 가능. 커밋 시에만 참조 변경이라 리렌더 저비용.
  marshal flag 톤은 라이브 현재 섹터에만 적용(폴백 값엔 best 비교 톤).
- **결정자**: 사용자 (Race 중점 리다이렉트) + 에이전트
- **수정 내역**:
  - `derive/leaderboardRows.ts`: `deriveSectorCells(driver, session, lastLap?)` + `deriveLeaderboardRows`에
    `lapHistory?` 인자 추가(드라이버별 마지막 레코드 조회), 'S3 상시 대시=fabrication' 주석 정정
  - `PitWallView.tsx`: 이미 있던 `lapHistory`를 `deriveLeaderboardRows`에 전달
  - `derive/leaderboardRows.test.ts`: 폴백/라이브 오버라이드/직전 랩 S3 테스트 추가
- **재발 시 대응**: "리더보드 S3는 fabrication이라 대시여야" 재제기 시 본 섹션 인용(같은 완료 랩 실측,
  My Lap과 동일 검증 소스).
