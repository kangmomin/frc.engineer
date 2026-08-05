# 사고 클립 캡처는 SessionTime 축 + RaceSummary 최상위 블록 + races 트리밍으로 설계한다

- **날짜**: 2026-08-05
- **이슈**: 플레이어 연루 COLL 전후 1초(20Hz)를 "사고 클립"으로 캡처해 자동 업로드에 동봉하는 기능.
  Codex 3관점(Logic/Architecture/EdgeCases) + Claude 독립 감사 검증 루프(2 iteration, v1→v5)에서
  시간축·부착 경로·트리밍 위치·엣지 정책에 대한 상충 제안이 나왔다.
  (계획서: `/workspace/work-log/claude/20260805-incident-capture-plan.md` — Verification Loop 기록 포함)

- **결정**:
  1. **시간축은 전적으로 `Header.SessionTime`(게임 시간)**. 윈도우/샘플 게이트/데드라인/디바운스 모두.
     wall-clock 미사용, 시계 주입(`now func()`) 없음 — recorder는 패킷 데이터만으로 완전 결정론적.
  2. **로컬 저장은 `RaceSummary.Incidents` 최상위 omitempty 블록** (Replay 패턴).
     부착은 저장 콜백에서 `processor.GetIncidentClips(uid)` 직접 호출 (RaceDetailInput/BuildSummary 불변).
     DataChannel strip 3곳: sender 디브리프 브로드캐스트, server 브로드캐스트, `sendRaceSummary`(P2P 아카이브).
     공용 `cloneRaceSummaryWithoutReplay`에서는 strip하지 않는다 — 수동 업로드 경로가 같은 헬퍼를 쓴다.
  3. **차량 선별은 per-sample `ResultStatus ∈ {2,3}` + 3D 최소거리 ≤40m + 가까운 순 10대 상한**,
     충돌 상대는 필터 우회 강제 포함. 동일 페어 1s 디바운스, 병합 윈도우 5s clamp,
     telemetry/lapData 캐시 0.5s(30프레임) 구식화 상한, 캡처 시 NaN/Inf 새니타이즈.
  4. **업로드 트리밍은 `races.TrimIncidentsForUpload`(300KB 예산)**: ① 전 클립 6대 재투영(파트너 보존)
     → ② 뒤(최신) 클립부터 제거(크기 정렬 없음, 결정적). 로컬 저장본은 원본 유지.
     최종 안전망: uploadRequest 전체 480KB 초과 시 incidents만 드롭(랩 데이터 보호).
     서버 `validateUpload`는 소스 클램프와 동일 상한(클립 20·participants 10·frames 101·collisions 20·
     이름 48룬·인덱스 0..23·14값 배열·float 유한성)을 미러링 — "sender 자기검증 불변식".
  5. 플랫폼 저장은 `race_detail` opaque JSONB 그대로 (마이그레이션 없음, schema_version 1 유지).

- **결정자**: 합의 (반경 방식·20Hz·±1s·트리밍 허용은 사용자 대화 합의, 세부 설계는 에이전트 + 검증 루프)

- **근거**:
  - SessionTime 축: "전후 1초"의 의미(게임 내 1초)와 정확히 일치, 일시정지 면역, COLL 이벤트 헤더의
    SessionTime이 그대로 t0 — 축 변환 자체가 사라진다. float32 정밀도는 4096s에서 ULP ~0.25ms로 충분.
  - 최상위 블록: `RaceDetail`에 넣으면 디브리프 브로드캐스트에 실려 SCTP 256KB 예산을 침범한다.
    Replay가 이미 같은 이유로 최상위 분리돼 있어 선례를 따랐다.
  - per-sample 상태: finalize 시점 최신 상태로 판정하면 윈도우 중 리타이어(2→7)한 충돌 상대가
    탈락하는 모순. 충돌 상대 강제 포함은 "거리상 자동 포함" 가정이 패킷 결손에서 불변식이 아니기 때문.
  - 트리밍을 `races`에 둔 것: 구조 상한만으론 병합 프레임 변동 때문에 512KiB를 보장 못 해 바이트 예산
    검사가 필요하고, `types_test.go`(package races)의 "예산 통과 후 워스트" 픽스처가 함수를 직접
    호출해야 한다(cmd 패키지는 임포트 불가).

- **기각된 대안** (계획서 Rejected Decisions 9건의 요약 — 재제기 시 계획서 해당 항목 인용):
  - **wall-clock 시간축**: 일시정지·재생 배속에서 "게임 내 1초"와 어긋난다.
  - **RaceDetailInput 경유 부착**: dto/BuildSummary 시그니처 변경 전파 대비 이득 없음 (Replay 선례로 충분).
  - **트리밍 1단계 단순화(큰 클립부터 제거)**: 가장 큰 클립 = 다중 추돌 = 가치가 가장 높은 데이터를
    먼저 통째로 버리게 된다.
  - **트리밍 uploader(cmd/sender) 배치**: 테스트 픽스처가 함수 호출 불가.
  - **고정 20Hz·완전한 2초 윈도우 보장**: 게임 송신 레이트가 유저 설정(10~60Hz)이라 강제 불가 —
    부분 윈도우 허용은 사용자 합의 사양.
  - **all-or-nothing을 "차량 수 불변"으로 재해석해 트리밍 금지**: all-or-nothing은 포함된 차량의
    시간축 완전성 의미. 예산 트리밍은 합의된 메커니즘.
  - **finalize 후 FLBK 시 확정 클립 소급 폐기**: 확정 클립은 단일 타임라인으로 내부 일관 —
    되감기로 무효화된 사고도 실제 일어난 사건이라 분석 가치가 있다(플래시백을 쓴 이유가 곧 그 사고).
  - **FLBK 상세 파서 확장**: 폐기 정책에는 이벤트 코드 문자열로 충분.
  - **종료 이벤트 전량 드롭/RCWN 조기 저장 대응**: 요약 파이프라인 전체의 기존 동작 상속 — 별도 과제.

- **수정 내역**: (커밋 전 — 해시는 커밋 시 추가)
  - 신규: `internal/dto/incident.go`, `internal/telemetry/incident_recorder.go`(+테스트),
    `internal/races/incidents.go`(+테스트)
  - 수정: `internal/telemetry/processor.go`(배선·`GetIncidentClips`), `internal/races/types.go`
    (`RaceSummary.Incidents`), `cmd/sender/main.go`(부착+strip 2곳), `cmd/server/main.go`(부착+strip),
    `cmd/sender/uploader.go`(미러·매핑·480KB 안전망), `internal/platformsvc/ingest.go`
    (미러·validateUpload 상한, +테스트), `internal/races/types_test.go`(SCTP/HTTP 이중 예산)
  - 검증: 전체 build/vet/test 통과 + mockudp E2E(`test-sets/race-clean-start` 재생, 플레이어 COLL 4건 →
    클립 4개, t0/윈도우/참가자 순서/14값 배열 실측 일치)

- **재발 시 대응**: 위 기각 대안(시간축·부착 경로·트리밍 위치/방식·FLBK 소급 폐기 등)이 simplify나
  후속 리뷰에서 재제기되면 본 문서와 계획서의 Rejected Decisions를 인용하여 즉시 종결한다.
