# 피드백(의견 보내기) 기능 설계 — 인증 범위·status 운영·용량 캡

- **날짜**: 2026-07-20
- **이슈**: pithub(플랫폼 API)에 의견 보내기 기능을 추가하며 (1) 익명 허용 여부,
  (2) 제출된 의견의 확인 방식(관리자 UI 유무), (3) body 용량과 요청 캡,
  (4) FK 삭제 정책을 결정해야 했다.
- **결정**:
  - 인증: Steam 웹 세션(ScopeWeb) 필수 + banned 거부 — 익명 불허.
  - 조회: 사용자 본인은 허브 FEEDBACK 화면에서 `GET /me/feedback`으로 목록+처리 상태 확인.
    관리자 UI는 만들지 않음 — 운영자는 SQL로 읽고 `status`를 직접 갱신
    (`open → in_progress/resolved/dismissed`, 밴 관리와 동일한 운영 모델).
  - body 2000룬(리뷰 500과 별개 — 버그 재현 절차 수용) + 요청 캡 16KiB
    (한글 2000자 ≈ 6KB UTF-8; 4KiB였다면 유효 입력을 거부).
  - `platform.feedback.account_id`는 plain `REFERENCES` (CASCADE 없음).
- **결정자**: 사용자 (인증·폼 구성·조회 방식) / 에이전트 (용량 캡·FK·status 집합)
- **근거**: 기존 쓰기 API 전부가 웹 세션 필수라 스팸 방어(계정별 rate limit + 밴 연동)를
  그대로 재사용. 관리자 UI는 현 운영 방식(밴도 DB 직접 조작)과 일치하는 최소 범위.
- **기각된 대안**:
  - 익명 제출 허용 — IP rate limit 등 별도 스팸 방어 필요, 범위 초과.
  - `ON DELETE CASCADE` — wallets(PK 겸용) 전용 패턴. ledger/purchases 등 다른 참조
    테이블은 plain REFERENCES이고 계정 삭제 플로우 자체가 없음.
  - 관리자 조회 API/UI — 사용자 명시 결정으로 SQL 운영.
- **수정 내역**: `internal/platformsvc/migrations/006_feedback.sql`, `feedback.go`,
  `cmd/platform/main.go`(POST /feedback·GET /me/feedback), `web/src/hub/screens/Feedback.tsx` 외
  (본 커밋 시리즈 참조)
- **재발 시 대응**: "익명 의견 받자", "피드백 관리자 페이지 만들자", "CASCADE 붙이자" 류
  재제기 시 본 문서 인용으로 종결. 플랫폼에 관리자 콘솔이 정식 도입되면 그때 재평가.
