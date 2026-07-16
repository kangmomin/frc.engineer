# 플랫폼 호스트 역할 분리 — API는 pithub, 웹 허브(안내 링크)는 pitwall

- **날짜**: 2026-07-16
- **이슈**: `platformBaseUrl` 하나가 (1) 페어링 교환·업로드 **API 베이스**와 (2) 페어링 모달의
  **웹 허브 안내 링크** 두 역할을 겸했다. v4.42.0 릴리스 후 "안내가 pithub인데 pitwall이다"라는
  제보를 받고 v4.43.0에서 두 역할 모두 pitwall로 변경 → 페어링이 405로 전면 실패.
  실측 결과 두 호스트의 실체가 다름:
  - `pitwall.up.railway.app` = 웹 프론트엔드(정적 호스팅). Steam 로그인·PROFILE → 디바이스 페어링
    UI(`web/src/hub/screens/Profile.tsx`)가 있는 곳. POST를 받으면 405.
  - `pithub.up.railway.app` = 플랫폼 API 서버(`cmd/platform`). `/device/exchange`, `/races` 라우트.
    프론트는 빌드타임 `VITE_PLATFORM_URL`로 이 API를 호출.
- **결정**: 역할별 상수 분리 — `defaultPlatformBaseURL`(API)은 pithub 유지,
  `defaultHubBaseURL`(사용자 안내 링크)은 pitwall. `/api/upload/status`의 `platformBaseUrl`
  필드는 UI 링크 전용이므로 허브 URL을 반환 (필드명은 기배포 UI 호환을 위해 유지).
- **결정자**: 합의 (사용자 승인 "ㄱㄱ")
- **근거**: 405 실측 재현 + `cmd/platform` 라우트 확인 + pithub `/health` 200 확인.
- **마이그레이션 이력**:
  - v4.43.0: config의 pithub → pitwall 치환 (잘못된 방향, 사고 원인)
  - v4.44.0: config의 pitwall → pithub 원복 치환 (`normalizePlatformBaseURL`)
- **수정 내역**: `cmd/sender/uploader.go`(상수 분리 + 역마이그레이션),
  `cmd/sender/main.go`(`/api/upload/status`가 `defaultHubBaseURL` 반환).
  settings.html·F1SetupManager.tsx의 pitwall 링크는 링크 역할이므로 v4.43.0 상태 유지.
- **재발 시 대응**: "pithub가 안내에 노출된다" 또는 "API 베이스를 pitwall로" 류 제기가 나오면
  본 문서 인용으로 종결. 플랫폼 API가 pitwall 도메인 하위로 통합되면 그때 재평가.
