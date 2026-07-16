# sender 페어링 필수화 — 미페어링 시 피트월 연결 차단 + 양쪽 UI 차단 모달

- **날짜**: 2026-07-14
- **이슈**: 페어링 키(upload token) 없이도 sender의 모든 기능(룸 호스팅, 오버레이 등)이 동작했다.
  사용자 요구: 페어링 키를 기입·인증하지 않으면 sender를 사용할 수 없게 하고, 처음 진입 시
  발급 가이드가 포함된 모달로 온보딩할 것. 선택지: (a) UI 모달만 (b) UI 모달 + 피트월 연결 차단
  (c) 오버레이·로컬 API까지 전면 차단.
- **결정**: (b) 채택 — 미페어링 시 시그널링 연결(룸 호스팅/텔레메트리 중계)을 차단하고,
  settings.html·Driver Pack(Electron) 양쪽에 닫을 수 없는 페어링 모달을 띄운다.
  페어링 성공 시 즉시 연결을 시작한다. 오버레이/로컬 API는 페어링 없이도 유지.
- **결정자**: 사용자 (차단 범위·모달 위치 명시 선택)
- **근거**: 실질 강제는 sender(Go) 게이트가 담당하므로 UI는 온보딩 역할에 집중.
  전면 차단은 듀얼PC/OBS 등 로컬 사용까지 막아 부작용이 큼.
- **기각된 대안**:
  - (a) UI 모달만 — 강제력 부족 (사용자 기각)
  - (c) 전면 차단 — 변경 범위 과대·로컬 사용 차단 (사용자 기각)
  - UI fail-closed(상태 확인 전 무조건 모달) — Codex 리뷰 제기. 서버측 게이트가 있으므로 순간
    fail-open은 강제성 구멍이 아니고, fail-closed는 기페어링 사용자에게 모달 플래시 유발. 기각.
  - pair persist 실패 시 요청 실패 처리 — Codex 리뷰 제기. 기존 warn-and-continue 유지(surgical).
    최악 케이스는 재시작 후 모달 재표시 → 새 코드로 재페어링. 기각.
  - 저장 토큰의 서버측 재검증 — 플랫폼에 검증 엔드포인트 없음. paired = 토큰 존재로 정의. 범위 외.
- **수정 내역**: `cmd/sender/main.go`(shouldBeConnected 페어링 조건 + connectWithRetry single-flight
  가드 + 페어링 성공 시 연결 + `/api/status`에 `paired`), `cmd/sender/settings.html`(차단 모달·inert),
  `apps/setup-manager/src/F1SetupManager.tsx`(usePairingGate 훅 — 구버전 sender는
  `/api/upload/status` 폴백 — + PairingGateModal). plan:
  `/workspace/work-log/claude/20260714-sender-pairing-gate-plan.md`
- **재발 시 대응**: 오버레이/로컬 API 차단, UI fail-closed, persist 실패 처리 강화가 재제기되면
  본 문서 인용으로 종결. 플랫폼에 토큰 검증 엔드포인트가 생기면 "저장 토큰 재검증" 항목만 재평가.
