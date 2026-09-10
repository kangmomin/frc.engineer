# 사고 리플레이 차량 손상: 참가자당 t0·종료 2스냅샷 + 4단계 초록→빨강 스케일

- **날짜**: 2026-09-10
- **이슈**: 사고 분석에서 차량 손상을 부위별 수치와 초록→빨강 강도로 보여 달라는 요청. 인시던트 체인
  (레코더 → sender 업로드 → 플랫폼 ingest → 허브 읽기)에 손상 데이터가 전혀 없어서 저장 시점, 부위,
  와이어 인코딩, 색 스케일을 정해야 했다.
- **결정**:
  1. 참가자마다 첫 병합 COLL(t0)과 클립 종료 시점의 `CarDamage` 스냅샷을 12개 정수 튜플
     `damageBefore`/`damageAfter`로 저장한다. 순서: 앞 왼쪽 윙, 앞 오른쪽 윙, 리어 윙, 플로어,
     디퓨저, 사이드포드, 엔진, 기어박스, 타이어 RL·RR·FL·FR(패킷 순서 유지). 캡처 시 0..100으로
     클램프하고, 기존 캐시와 같은 30프레임 staleness를 적용하며, 스냅샷별 존재 여부를 따로 둔다.
  2. 스키마 버전은 올리지 않는다. 업로드 디코더가 미지 필드를 허용하므로 신규 sender → 구 플랫폼은
     필드가 버려지고, 구 데이터는 `null`이 되어 패널이 나오지 않는다. **플랫폼을 sender보다 먼저 배포한다.**
  3. 허브는 클립 종료 값으로 탑뷰 도형과 목록을 칠하고, t0보다 늘어난 부위에만 "구간 중 +N"을 붙인다.
     칠할 스냅샷은 값이 아니라 존재 여부로 고른다(수리로 0이 된 값이 t0 값으로 되돌아가지 않게).
  4. 색은 0–24 / 25–49 / 50–74 / 75–100% 4단계 이산 스케일이며 `HubTheme.damageScale`에 둔다.
     수치는 항상 병기한다.
- **결정자**: 사용자(2스냅샷, 12부위, 탑뷰 도형) / 에이전트(튜플 인코딩, 4단계 스케일 — 이 질문을 담은 구현 보고 후 사용자가 "굳. 이제 배포해줘"로 배포를 지시)
- **근거**: 손상은 ~10Hz로 천천히 바뀌는 상태라 프레임별 저장은 중복이다. 두 스냅샷이면 사고 전부터
  있던 손상과 구간 중 증가를 구분할 수 있다. 12값 튜플은 기존 14값 프레임 튜플 컨벤션을 따르며 최악
  ~129B/참가자다. 색은 dataviz `validate_palette.js`로 명도 단조 팔레트를 탐색해 light(ΔE 15.3, CVD 10.8)와
  dark(ΔE 16.6, CVD 9.3) 모두 hard check를 통과했다. dark는 명도 밴드(범주형 동일 비중 규칙)만 FAIL이다.
  한계: t0 스냅샷은 패킷 주기 탓에 첫 접촉을 이미 포함할 수 있고, 병합 클립의 증가는 여러 충돌을 합산한다.
- **기각된 대안**:
  - 프레임별 손상 저장 — 사용자 기각, 중복값이 업로드 예산을 잠식.
  - 연속 HSL 보간 — `web/src/views/pitwall/derive/leaderboardRows.ts:50-52`가 이미 기각한 방식이고 status 인코딩은 이산 단계가 원칙.
  - 5단계 스케일 — 최선안도 light normal-vision 인접 ΔE 11.9 < 15.
  - 튜플 안 `null` 원소를 거부하는 커스텀 디코더 — `[0,…]` 직접 전송과 같은 결과라 위조 능력을 더하지 않음.
  - tick 링에 손상 이력 저장 — 메모리·복잡도 대비 정확도 이득이 ~100ms.
- **수정 내역**: `Add: 사고 리플레이에 부위별 차량 손상 표시` 커밋, Minmo Driver Pack v4.58.0 릴리스에 포함. `internal/telemetry/incident_recorder.go`, `internal/telemetry/processor.go`,
  `internal/dto/incident.go`, `cmd/sender/uploader.go`, `internal/platformsvc/ingest.go`,
  `internal/platformsvc/race_analysis.go`, `internal/platformsvc/testdata/race_analysis_v2.json`,
  `web/src/hub/screens/incidentDamage.ts`, `web/src/hub/screens/IncidentReplay.tsx`,
  `web/src/hub/screens/Analysis.module.css`, `web/src/hub/theme.ts`, `web/src/hub/data/raceAnalysisTypes.ts` 및 관련 테스트.
- **재발 시 대응**: 단계 수·연속 보간·프레임별 저장·`null` 원소 검증이 다시 제기되면 본 문서를 인용하여 종결.
