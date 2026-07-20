# 실측 코너 데이터셋 도입 — RACE 스트립 코너 틱 + QUALI 다음 코너 라벨

- **날짜**: 2026-07-20
- **이슈**: 게임 UDP에는 코너 번호 데이터가 없어 `TrackPositionStrip`은 코너 라벨을 "실데이터 없음 — fabrication 금지"로 미구현 상태였다. 사용자가 MultiViewer/FastF1 코너 데이터(번호 + 스타트라인 기준 거리)를 `lapDistance`와 매칭하는 접근을 제시. 표시 범위·데이터 공백 처리·통합 방식에 판단이 필요했다.
- **결정**:
  1. **데이터 소스**: MultiViewer API(`api.multiviewer.app/api/v1/circuits/{key}/{year}`). 2025 캘린더 24개 서킷 전체 확보. 코너 거리는 절대 미터가 아닌 **랩 대비 비율(pct)로 정규화 저장** → 런타임에 게임 `session.trackLength`를 곱함(실측/게임 길이 차 흡수). API는 요청 연도가 없으면 최신 빈티지로 폴백(대부분 2021~2023, Suzuka만 2025) — 트랙별 반환 연도를 생성 파일 주석에 기록.
  2. **25/26 공용 단일 데이터셋**: `session.trackId`는 Go `CanonicalTrackID`가 정규화한 단일 ID 공간이므로 canonical trackId 키 한 벌로 양 포맷 커버.
  3. **데이터 공백 트랙(리버스 39-41·Madring 42)은 숨김**: MultiViewer에 소스가 없음. 사용자 확정으로 수작업 추정 데이터 배제 — 해당 트랙에서 모든 조회가 null을 반환해 기존 렌더 유지.
  4. **Hungaroring 이중 apex 중복 번호(T1·T12 각 2회)는 원본 유지**: dedupe는 원본 가공(fabrication)이며 이중 apex 정보 손실 — 테스트로 고정해 후속 "정리"를 차단.
  5. **표시 범위(사용자 확정)**: RACE 리더보드 상단 스트립(T{n} 틱 2층 + `→ T{n}` 라벨) + QUALI My Lap 진행바 옆 라벨. My Car 타일은 채택하지 않음.
  6. **통합 방식**: 미사용 `ui/TrackStrip` 마운트 대신 **`TrackPositionStrip` 가산 확장** — `sectorSplits`(m) 데이터 소스가 없고 시각 언어가 달라 채택 시 API 수술+리스타일 필요. 검증된 순수 함수(`wrapPct`/`buildCornerMarks`)만 재사용. `bandH=0` 강등으로 데이터 없는 트랙은 기존과 동일 렌더가 구조적으로 보장됨.
  7. **경계 시맨틱**: 다음 코너 = `pcts.find(c => c.pct > frac) ?? pcts[0]` — apex 도달 시 통과로 간주해 전진, 마지막 apex 후 T1 랩어라운드. 음수/초과 lapDistance는 `wrapPct` 래핑.
  8. **재생성 체계**: 빌드타임 fetch 배제(외부 API 종속) — 커밋된 생성 파일(`trackCorners.data.ts`) + 수동 스크립트(`web/scripts/fetch-track-corners.mjs`, 검증 실패 시 중단).
- **결정자**: 사용자(범위·공백 처리) + 합의(Plan 검증 루프: Explore 2 + Plan 1 에이전트)
- **근거**: 코너 번호는 레이아웃 불변 시 안정적이고, 비율 정규화가 빈티지·게임 간 길이 차를 흡수. 수작업 기반 데이터의 정밀도 한계(수십 m)는 구간 판정/시각화 용도로 충분.
- **기각된 대안**: `ui/TrackStrip` 마운트(위 6), Hungaroring dedupe(위 4), Madring 수작업 데이터(위 3), 빌드타임 fetch(위 8).
- **수정 내역**: `web/scripts/fetch-track-corners.mjs`, `web/src/constants/trackCorners{.data,,.test}.ts`(신규), `TrackPositionStrip`/`LeaderboardPanel`/`PitWallView`, `derive/myLap{,.test}.ts`/`MyLapPanel`. 테스트 358개 green, mock(Suzuka) 시각 검증 완료.
- **재발 시 대응**: "코너 위치가 몇 m 어긋난다" → 소스 빈티지·수작업 정밀도 한계(본 문서 근거) 인용. "리버스/Madring에 코너 표시하자" → 결정 3 인용. "중복 T1 정리하자" → 결정 4 + `trackCorners.test.ts` 고정 인용. 데이터 갱신은 생성 스크립트 재실행으로만.
