# Sender 캡처/업로드 신뢰성 — sealed-ID 프로토콜 채택, CHQF/RCWN 강등, 서버 upsert 기각

- **날짜**: 2026-08-22
- **이슈**: 세션 요약 저장·업로드 트리거가 게임의 세션 종료 이벤트(SEND/CHQF/RCWN) 하나뿐이라
  세션 미완료 종료 시 기록이 전무하고, 업로드는 1회 fire-and-forget이라 실패 시 유실됐다
  (DB 관측: 최근 30건 중 부분 캡처 흔적 3~4건, 8/21 퀄리처럼 후속 세션 미업로드 의심 사례).
  추가로 서버 ingest가 (account_id, source_race_id) **insert-once**라서, "부분 저장 후 완전본
  재업로드" 설계는 부분본이 서버에 박제되고 완전본이 영구 유실되는 모순을 낳는다.
- **결정**:
  1. **Sealed-ID 프로토콜** (클라이언트 측 해소): 업로드 시도 전 `<id>.uploaded` 사이드카를
     내구 기록(write+fsync+rename)하고, seal된 ID는 콘텐츠 불변 — 같은 세션의 이후 저장은
     새 ID를 발급한다. 재시도는 항상 동일 바이트를 보내므로 서버 Duplicate 응답이 "동일
     콘텐츠 기존재"와 동치가 된다 (응답 유실/크래시 인터리빙 포함 안전 — Codex Iter3 검증).
  2. **저장 트리거 4종 추가** (sender 전용 `SetCheckpointSaves` 게이트): idle-timeout(3분) /
     session-switch / shutdown flush(Start 고루틴 내부) / **CHQF·RCWN을 체크포인트로 강등**
     (우승자 선언 시점 조기 확정으로 플레이어 잔여 랩이 잘리는 기존 결함 동시 해소).
     final-class는 SEND·session-switch(+legacy 빈 트리거)만 — 즉시 업로드는 final-class 한정.
  3. **부팅/페어링 sweep**: 사이드카 없는 요약을 최신순 ≤20/회 재시도. legacy 파일(트리거
     없음)만 7일 컷, 신규 파일은 마커 기반 점진 드레인(기아 없음).
  4. **capture 마킹**: `captureStartLap`/`finalizeTrigger`를 RaceDetail→업로드 payload에 추가
     (schemaVersion 1 유지, additive — 구서버는 필드 무시 fail-soft).
- **결정자**: 에이전트 (검증 루프: Codex 다관점 3회 + Claude self-review 1회, 최종 APPROVE)
- **근거**: insert-once는 플랫폼 신뢰 모델(불변 문서)의 의도된 제약 — 서버를 바꾸는 대신
  "업로드된 콘텐츠는 불변, 변경은 새 정체성"으로 클라이언트가 같은 불변식을 따르는 쪽이
  배포 결합 없이 안전하다. 락은 로컬 파일/맵 연산만 보호(네트워크는 락 밖) — seal의 콘텐츠
  불변이 동시 업로더 안전을 보장하므로 processor 고루틴이 네트워크에 블록되지 않는다.
- **기각된 대안**:
  - **서버 ingest upsert(콘텐츠 갱신)**: 신뢰 모델 변경으로 범위 밖. sealed-ID가 동일 문제를
    클라이언트 측에서 해소.
  - **idle N분 후 "dead 선언 + 즉시 업로드"**: 장시간 일시정지 후 재개 시 partial 박제 경로.
  - **RaceSummarySchemaVersion 2 범프**: additive 필드라 불필요, 배포 순서 결합만 생성.
  - **실패 final의 pending 스냅샷 큐(완전 내구성)**: 로컬 디스크 오류 한정의 희귀 케이스 —
    session-switch는 1회 즉시 재시도 후 유실 수용, SEND 실패는 finalSavePending으로 idle 재시도.
- **수용된 한계**: 사이드카는 머신-전역(재페어링 시 이전 계정분 재업로드 안 함) · seal fsync와
  HTTP 발신 사이 전원 단절 미커버 · 구서버에선 신규 필드 소실(같은 세션 2행 구분은 랩 수 의존) ·
  레이스 종료 시 RCWN/CHQF/SEND로 요약 방송 최대 3회(뷰어가 최신으로 덮어써 데이터 갱신으로
  수용; idle-timeout/shutdown 저장은 방송 제외 — 진행 중 레이스에 디브리프 오방송 방지).
- **수정 내역**: internal/telemetry(processor.go — saveRaceSummary/checkpoint/idle/flush/Done,
  pitwall_manager.go — captureStartLap·PlayerHasCompletedLap), internal/races(merge.go,
  DefaultSummaryID, RaceDetail 필드), internal/dto(RaceDetailInput 필드),
  internal/platformsvc(UploadDetail 필드+검증), cmd/sender(upload_state.go 신설 — sealed-ID·
  sweep·uid→id 인덱스, main.go 콜백/수동 업로드/페어링/종료 대기 통합, uploader.go 매핑).
  계획서: work-log/claude/20260822-sender-capture-reliability-plan.md (v4, 수렴 기록 포함).
- **재발 시 대응**: "왜 업로드가 세션당 2행이 될 수 있나", "왜 CHQF에서 업로드 안 하나",
  "서버에서 레이스를 갱신하면 안 되나", "checkpoint 파일은 왜 sweep만 올리나" 류의 재론은
  본 문서 인용으로 종결.
