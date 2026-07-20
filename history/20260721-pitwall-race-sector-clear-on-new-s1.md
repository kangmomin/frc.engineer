# RACE 리더보드 섹터 — 새 랩 S1 진입 시 S2/S3 클리어(폴백 종료) 후 순차 채움

- **날짜**: 2026-07-21
- **이슈**: RACE(pitwall) 리더보드의 섹터 셀(`deriveSectorCells`)이 커밋 `c24249d4`
  ("sector 컬럼 S3 표시 + S1/S2 유지") 이후 **직전 완료 랩 폴백** 정책이었다. 즉 새 랩이
  시작돼도 라이브 S1/S2가 없으면 직전 랩 값을 계속 표시하고 S3는 항상 직전 랩을 표시해,
  새 랩 S1이 찍힌 뒤에도 S2/S3 칸에 이전 랩 값이 남아 있었다. 사용자 요구:
  "S1·S2·S3가 다 찬 뒤 새 랩 S1이 찍히면 S2·S3를 빈 칸으로 만들고 S1을 채운 뒤,
  S2·S3 데이터가 넘어올 때마다 채워라."
- **결정**: pitwall(RACE) 리더보드 **한정**으로 폴백을 `lapStarted`(= `liveS1 > 0`,
  즉 새 랩 S1 완주 `currentSector>=1`) 게이팅으로 전환한다.
  - `currentSector==0`(새 랩 S1 미완주): 직전 완료 랩 S1/S2/S3를 그대로 유지(다 찬 상태 보존).
  - `currentSector>=1`(새 랩 S1 진입): 폴백을 끊어 S2/S3를 빈 칸으로 비우고 S1만 새 값 표시.
  - 이후 라이브 S2(`currentSector>=2`), 랩 완료 시 `lastLap` 갱신으로 S3를 순차 채움.
- **결정자**: 사용자 (요구) + 에이전트 (구현)
- **근거**: 리더보드는 각 드라이버가 **현재 랩에서 어느 섹터까지 왔는지**를 실시간 파악하는
  도구다. S1만 채우고 S2/S3를 빈 칸으로 두면 "아직 안 나옴"을 정직하게 표현한다. 옛 랩 값을
  남기는 '혼재'가 아니라 '빈 칸'이므로 서로 다른 랩 섹터가 섞여 오독될 여지가 없다. S1 완주
  전(`currentSector==0`)에는 직전 완료 랩 트리오를 유지해 완전 공백 구간을 만들지 않는다.
  S3는 여전히 완료 랩 `lastLapTime−s1−s2` 실측치로만 채워 fabrication이 아니다(S3 역산
  정당성은 `20260720-qualifying-mylap-sector-persist-s3-reconstruct.md` 인용).
  랩 완료 전이의 무갭 복귀는 `lastLapTime` 갱신·`lapNum++`·섹터 리셋이 같은 패킷이라는
  `lapHistoryStore` 원자성 가정에 의존(같은 프레임에 `lastLap` 갱신 + `currentSector` 리셋).
- **기각된 대안 / Qualifying과의 차이**:
  - Qualifying "My Lap"은 정반대 정책이다 — 다음 S1 완주 전까지 **완료 트리오를 유지**하고,
    "S1은 새 값·S2/S3는 옛 값 혼재"를 오독 위험으로 명시 기각했다
    (`20260720-qualifying-mylap-sector-persist-s3-reconstruct.md`). 본 결정은 그 로그와
    **모순이 아니다**: (1) 대상 패널이 다르다(단일 My Lap 패널 vs 20+행 리더보드), (2) Race의
    클리어는 '혼재'가 아니라 '빈 칸'이라 Qualifying 기각 사유(랩 혼재 오독)가 적용되지 않는다.
    Qualifying My Lap 정책은 이번 변경 범위 밖으로 그대로 둔다.
  - c24249d4의 "S1/S2 유지" 폴백 자체 유지 — 사용자가 새 랩 진행 상황 가시화를 명시 요구해 기각.
- **수정 내역**: `web/src/views/pitwall/derive/leaderboardRows.ts` `deriveSectorCells` —
  `dispS1/S2/S3` 폴백을 `lapStarted` 게이팅으로 교체(3줄) + 정책 주석 갱신. (본 커밋 참조)
- **재발 시 대응**: "새 랩에서 S2/S3가 왜 사라지나 / c24249d4는 유지였는데" 또는 "Qualifying과
  정책이 달라 일관성 없다"는 재제기 시 본 문서 인용으로 종결. 두 패널의 정책 차이는 목적
  차이(리더보드 진행 가시화 vs My Lap 완료 트리오 유지)에서 비롯된 의도된 결정이다.
