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
