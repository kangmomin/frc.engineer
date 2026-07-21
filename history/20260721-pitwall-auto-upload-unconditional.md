# 레이스 자동 업로드를 opt-in 토글에서 "무조건(항상)"으로 전환

- **날짜**: 2026-07-21
- **이슈**: pithub(`platform.races`)에 레이스가 한 건도 들어오지 않고 `platform.sessions`(로그인/페어링 인증)만 채워짐. 원인 추적 결과 파이프라인(캡처→매핑→ingest)은 전 구간 정상이었고, 실제 원인은 **업로드 트리거가 걸린 적이 없음**이었다:
  - 자동 업로드가 opt-in·기본 OFF (`cfgAutoUpload=false`)이고 페어링해도 켜지지 않음.
  - 유일한 토글은 sender의 독립 `settings.html`에만 있고, 실사용 앱인 **Driver Pack(`F1SetupManager.tsx`)에는 자동 업로드를 켤 UI가 아예 없었다** (`autoUpload`를 status 타입에 선언만 하고 미사용). 따라서 Driver Pack 사용자는 업로드를 켤 방법 자체가 없었음.
  - 자동 업로드 실패는 `logger.Warn`만 남기고 UI에 노출되지 않아 "안 켬"과 "실패"가 구분 불가.
  - 선택지: (A) Driver Pack에 opt-in 토글을 추가한다 / (B) 페어링을 업로드 동의로 보고 자동 업로드를 무조건 상시화한다.
- **결정**: **(B)** — 페어링된 기기는 레이스 종료 시 **항상** 업로드. opt-in 토글/엔드포인트/설정 필드를 제거한다.
- **결정자**: 사용자 (대화 중 "근데 무조건 자동 업로드야"로 명시)
- **근거**: 페어링은 이미 피트월 연결의 필수 게이트(미페어링 시 연결 차단, `aeb5a0a7`)이므로 페어링=플랫폼 사용 동의로 볼 수 있다. 업로드가 기능의 존재 이유이므로 opt-in 토글은 사용자가 켤 방법조차 없는 상태에서 "가짜 off 스위치"로 남을 뿐이다. 게이트를 제거하면 기존에 저장된 `autoUpload=false` config도 재페어링 없이 다음 레이스부터 즉시 업로드된다(Go가 미지 필드로 무시).
- **기각된 대안**: (A) Driver Pack에 토글 추가 — "무조건 업로드" 결정과 배치되어 기각. 토글을 남기면 꺼도 올라가는 모순된 off 스위치가 되어 오히려 혼란.
- **프라이버시 영향**: 이 결정으로 페어링한 모든 사용자의 랩타임이 공개 리더보드에 항상 게시된다. 셋업/디테일은 서버에 비공개 저장(리더보드 미노출). "무조건 업로드" 결정에 내포된 트레이드오프로 수용.
- **수정 내역**:
  - `cmd/sender/main.go`: 업로드 게이트 `if autoUpload && token != ""` → `if token != ""`. `AutoUpload` config 필드·기본값·로드·스냅샷 제거, `/api/upload/status` 응답에서 `autoUpload` 제거, `POST /api/upload/auto` 핸들러 제거.
  - `cmd/sender/settings.html`: 자동 업로드 토글 UI + 관련 JS(상태 반영·change 리스너) 제거.
  - `apps/setup-manager/src/F1SetupManager.tsx`: 죽은 `SenderUploadStatus.autoUpload` 타입 필드 제거.
  - 검증: `go build ./...` OK, `go test ./cmd/sender/...` OK.
- **재발 시 대응**: "자동 업로드를 옵션으로 되돌리자/토글 추가하자"는 제안이 나오면 본 문서를 인용하여 종결. 재도입은 프라이버시 동의 UX(공개 게시 고지)를 함께 설계할 때만 재논의.
