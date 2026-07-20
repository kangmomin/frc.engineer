# Pit Wall 드라이버 모달·현 위치 스트립 — 랩 히스토리 클라이언트 축적 설계와 목업 degrade 범위

- **날짜**: 2026-07-20
- **이슈**: 디자인(claude.ai/design `Pit Wall.dc.html`)의 ① 리더보드 행 OPEN → 드라이버 상세 모달(Recent Laps 테이블 + Lap Trace/Tyre Wear 차트), ② 리더보드 최상단 "현 위치" 스트립을 실 앱에 이식. 목업은 랩 시리즈를 합성 생성하지만 와이어(DriverInfo)에는 랩 히스토리가 없고, 스트립의 코너 라벨·high-wear zone도 목업 전용 데이터다.
- **결정**:
  1. **랩 히스토리는 클라이언트 축적**(`store/lapHistoryStore.ts`) — `lastLapTime` **값 전이** 기반 드라이버별 상태기계(우선순위: seed > 회귀 > 점프 > +1 폴백 > 터미널 틱 전이)로 완주 랩을 채록. 점프(+2 이상)는 랩 귀속 확정 불가로 **미커밋**, +1 폴백은 freshness(전이 동반) 필수, 회귀는 즉시 세대 프루닝, 터미널 틱 직후 플래시백은 revert 가드(커밋값/staleBaseline 비교, baseline은 커밋 무관·랩 전진 만료). partial 커밋은 pit=null(unknown).
  2. **리플레이 프레임은 축적하지 않는다** (raceMetaTracker와 동일 게이트) — 라이브 히스토리가 리플레이 rewind로 소거되는 것 방지. 재생 중 모달은 라이브 축적분을 보여줌(문서화된 한계).
  3. **스트립은 "현 위치"만 구현** — 코너 라벨(T1…)·high-wear zone 툴팁은 실데이터가 존재하지 않아 미구현. `ui/TrackStrip` 재사용도 기각(섹터 경계 거리 데이터가 옵션이라 부재 시 오표시).
- **결정자**: 에이전트 (Codex Plan Reviewer 검증 루프 6회 수렴 — iter-6 APPROVE, Critical 0. plan: `/workspace/work-log/claude/20260720-pitwall-open-modal-trackpos-plan.md`)
- **근거**: 레포 파생 원칙(조작/추정 금지, 결측 degrade — `leaderboardRows.ts`). 채록 정확성은 와이어 불변식 2건에 의존: ⓐ lastLapTime·currentLapNum은 같은 LapData 패킷의 일관 쌍, ⓑ 터미널 틱에 lastLapTime 게시가 lapNum 증가에 선행(`useSectorAccumulator.ts` 실측 선례). 확신 없는 랩 귀속(점프 공백)은 기록 대신 차트 분절(구멍)로 정직하게 표시.
- **기각된 대안**:
  - 롤오버 시점 스냅샷 신뢰 채록(v1) — 프레임 드랍/텔레포트에서 랩 혼합 fabrication (Codex iter-1 Critical).
  - 리플레이 프레임 축적 + rewind 리셋 — 라이브 히스토리 소거 대가가 더 큼 (iter-1 Critical).
  - 점프 구간 최신 랩 커밋 — garage 텔레포트가 라인 통과 없이 lapNum을 전진시켜 오귀속 (iter-3/4 Critical).
- **수정 내역**: `web/src/store/lapHistoryStore.ts`(+test 15), `web/src/views/pitwall/DriverDetailModal.tsx`, `derive/driverDetail.ts`(+test 13), `TrackPositionStrip.tsx`, `LeaderboardPanel.tsx`/`PitWallView.tsx`/`AppShell.tsx` 연결.
- **재발 시 대응**: 코너/웨어존 미구현·리플레이 미축적·최종 랩 누락 가능성이 리뷰에서 재제기되면 본 문서와 plan의 Rejected Decisions 인용으로 종결. 코너 데이터가 향후 와이어에 추가되면 `ui/TrackStrip` corners prop 재사용을 검토.
