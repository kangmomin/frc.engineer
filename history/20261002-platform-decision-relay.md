# 결정 모델(Jev) 기본 제공은 플랫폼 relay로 — 키는 서버 환경변수, 사용은 RBAC 권한, 기본 섀도

- **날짜**: 2026-10-02
- **이슈**: 가상 엔지니어의 결정 모델(Jev)을 쓰려면 드라이버가 직접 키를 넣어야 했다([20261001-virtual-race-engineer-radio.md](20261001-virtual-race-engineer-radio.md)). 사용자는 키를 기본 제공하고, 제공 여부와 키를 서버에서 관리하길 원했다. 선택지는 세 가지였다. (A) Sender·Driver Pack 빌드에 키 내장, (B) 서버가 키를 내려 주고 클라이언트가 직접 호출, (C) 플랫폼이 키를 들고 대신 호출하는 relay. (출처: 대화)
- **결정**:
  1. **(C) 플랫폼 relay**로 한다. `POST /engineer/decision`이 Sender의 와이어 본문을 받아 서버 키·서버 모델로 Jev에 전달한다. `GET /engineer/decision/config`는 키 설정 여부(`available`)만 알려 준다.
  2. **사용 자격은 RBAC**로 정한다. 새 권한 `sender.engineer-decision.create`(마이그레이션 017)를 만들고 일반 `user` 역할에는 부여하지 않는다. 관리자는 `sender` 상위 권한으로 상속한다. 업로드(기기) 토큰만 허용하고 정지 계정·웹 세션·View As는 거부한다.
  3. **키와 제공 여부는 서버 환경변수**(`PLATFORM_ENGINEER_DECISION_URL`·`_API_KEY`·`_MODEL`·`_TIMEOUT_MS`·`_RATE_PER_MIN`)로 관리한다. URL과 키를 둘 다 비우면 꺼진다. 하나만 있거나 숫자 값이 잘못되면 기동을 실패시킨다(`PLATFORM_UPDATE_LOG_*`와 같은 fail-fast).
  4. **기본 제공은 섀도 모드**다. `DefaultSettings`를 `provider: platform`, `mode: shadow`로 바꾼다. 이전 버전 설정 중 엔드포인트가 없던 설정(사실상 기본값 `off`)은 같은 기본값으로 올리고, 엔드포인트가 있던 설정은 `custom`으로 유지한다.
  5. Sender의 relay 사용은 **fail-closed**다. 권한·서버 제공이 확인되기 전에는 호출하지 않는다.
- **결정자**: 사용자 (C안, RBAC, 서버 환경변수, 기본 섀도) / 에이전트 (세부: fail-closed, 질문 id 허용 목록, 메모리 rate limit, 타임아웃 기본값)
- **근거**:
  - Driver Pack 인스톨러는 GitHub Release로 공개 배포된다. 내장 키(A)는 문자열 추출로 바로 노출된다. 내려받은 키(B)도 사용자 PC의 설정 파일·메모리·자기 HTTPS 요청에 남는다. relay(C)만 키가 서버 밖으로 나가지 않고, 권한 회수·키 교체·제공 중단을 서버에서 즉시 할 수 있다.
  - 기존 자문 게이트(`pitwall.broadcast.create` 등)는 미확인 시 허용(fail-open)이지만, relay는 호출마다 서버의 모델 비용을 쓴다. 권한 없는 다수 사용자가 기본 섀도로 403을 반복하지 않게 확인 후에만 켠다.
  - 결정 모델은 실시간 콜 경로 밖이다(섀도는 기록만, 적용은 실패 시 규칙대로 말함). 그래서 플랫폼을 한 번 더 거쳐도 주행 중 체감 영향이 작다. 대신 Sender 쪽 `platform` 기본 타임아웃을 3000ms로 늘린다(서버→Jev 기본 2500ms).
- **기각된 대안**:
  - (A) 빌드 내장 키 / (B) 서버가 키 배포: 위 근거대로 키 노출.
  - DB 기반 키 관리·관리자 UI: 사용자가 환경변수를 선택했다. 키를 DB에 두면 암호화·감사 로그가 추가로 필요하다.
  - DB 기반 `AllowRate`: relay는 나간 콜마다 호출되어 매번 DB를 치기엔 잦다. 플랫폼이 단일 인스턴스라 메모리 고정 창(계정당 분당)으로 충분하다. 다중 인스턴스가 되면 재검토한다.
  - 임의 질문 중계: 서버 키가 범용 Jev 프록시로 쓰이지 않게 질문 id를 `speak`·`urgency`·`intent`로 제한하고, 본문 32KiB·질문 4개로 묶는다. 클라이언트의 `model`은 무시한다.
- **수정 내역**: `internal/engineer/decision`(Provider·Relay·`NewPlatformClient`), `internal/engineer`(`SetRelay`·`UpgradeSaved`·상태 `decisionProvider`/`decisionUnavailable`·기본값), `internal/rbac`·`internal/platformsvc/migrations/017_engineer_decision.sql`(권한), `cmd/platform/engineer_decision.go`(relay·환경변수), `cmd/sender/main.go`·`uploader.go`(권한 확인 후 relay 활성화), `apps/setup-manager`(Provider 선택·상태 표시), `docs/api/engineer-radio.md`.
- **재발 시 대응**: "Jev 키를 앱에 넣자", "서버가 키를 내려 주자", "권한 확인 전에도 relay를 호출하자"는 본 문서 인용으로 종결한다. Jev 이용약관상 키 하나로 여러 사용자 요청을 중계해도 되는지는 운영자가 별도로 확인한다.
