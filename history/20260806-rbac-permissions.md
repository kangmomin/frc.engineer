# RBAC는 계층 그랜트 + 기본 Role 백필 + 클라이언트 자문 게이트로 설계한다

- **날짜**: 2026-08-06
- **이슈**: `{service}.{scope}.{action}` CRUD permissions를 계층 구조로 Role에 할당하고
  유저별 Role을 할당하는 시스템(유저 > Role < permissions). ① service 네임스페이스 범위
  (sender는 무인증 로컬 앱 — 집행 불가), ② 기존 스코프/admin env와의 관계, ③ 계층 의미론,
  ④ 기본 Role 부여 방식이 쟁점이었다.
  (계획서: `/workspace/work-log/claude/20260806-rbac-permissions-plan.md` — 검증 루프 전 기록)

- **결정**:
  1. **네임스페이스는 pithub·pitwall·sender 3개 전부** (사용자 결정). pithub는 서버 집행
     (전 인증 라우트 16개 permission 게이트), sender/pitwall은 **클라이언트 자문 게이트** —
     sender가 앱 기동/페어링 시 `GET /permissions`를 fetch(fail-open: 미페어링/실패/구서버
     404/401·403 = 전 기능 허용, 차단은 200+그랜트 미커버만. 20260727 업데이트 게이트의
     fail-open 정책 계승). 자문 게이트는 보안 경계가 아님을 코드 주석에 명문.
  2. **계층은 dot-boundary 상속 그랜트**: Role에 임의 깊이 노드를 할당하면 서브트리 전체
     허용(정확 일치 OR 조상 일치). `pithub.race` 그랜트가 `pithub.race-analyze.*`에
     오매칭되지 않도록 dot 경계 필수 — 카탈로그에 실제 형제 존재. canonical 구현은
     `internal/rbac`(의존성 0 leaf 패키지, sender와 공유), TS 미러 2곳.
  3. **세션 스코프(web/upload)는 자격증명 계층으로 유지**, RBAC는 계정 축으로 추가.
     `Principal.Permissions`를 `LookupSession` 단일 쿼리의 ARRAY 서브쿼리로 집계
     (라운드트립 0 증가, 매 요청 재집계 = 회수 즉시 반영).
  4. **기본 Role('user', leaf 13개 — 시드 원칙, 런타임 불변식 아님)을 009에서 시드+전
     계정 백필**해 현행 동작 100% 보존. 신규 계정은 UpsertSteamAccount의 xmax=0 CTE로
     생성 시에만 부여 — **운영자가 회수한 Role이 재로그인으로 부활하지 않는다**(통합
     테스트로 핀).
  5. **`PLATFORM_ADMIN_ACCOUNT_IDS` env는 admin Role 부트스트랩으로 흡수**: 부팅 시 멱등
     부여(warn+계속), adminGate/isAdmin 삭제. env 제거 ≠ 회수 — **영구 제거 = env 제거
     AND API 회수** (부트스트랩 모델의 본질적 결과, 운영 수칙). 마지막 admin 자기 락아웃의
     복구 경로 = env 포함 재기동 또는 SQL.
  6. **관리는 admin API만**(`/rbac/*` 7종, `pithub.rbac.*` 게이트, 치환 semantics,
     시드 Role 삭제 금지). 허브 관리 UI는 범위 외.

- **결정자**: 합의 (네임스페이스 3종·전 라우트 집행·상속 그랜트·admin API만은 사용자
  AskUserQuestion 확정, 세부 설계는 에이전트 + 검증 루프[Explore 2종 → Plan 에이전트 →
  Codex 3관점 2라운드 ISSUES→PROCEED])

- **근거**:
  - sender 집행 불가는 탐색으로 확정: 로컬 API 32라우트 전부 무인증, principal 없음
    (upload 토큰은 불리언 semantics), "setup"은 빌드타임 번들 정적 카탈로그 — 서버 왕복
    자체가 없다. 사용자가 "업데이트 확인과 함께 권한 체크" 방식(자문)을 선택.
  - user Role leaf-only: 미래 action 추가가 전 유저에게 암묵 유출되는 것을 시드 단계에서
    방지. admin은 루트 3개 — 미래 노드 자동 포함이 의도.
  - /me는 permission 게이트 금지: 웹 fetchMe가 401/403에 토큰을 삭제하므로 게이트 시
    Role 0개 계정이 로그인 루프에 갇힌다. `/permissions`도 동일(자기 조회 semantics).

- **기각된 대안** (상세: 계획서 Rejected Decisions):
  - admin 부트스트랩 실패 fatal화 (Role 할당은 재기동 간 영속 — 기존 env 게이트보다 우월,
    warn+skip 철학 유지)
  - 인가 회귀 httptest (관례 부재, 순수/통합 테스트가 위험부 커버, 16라우트 표 대조
    self-review 수행됨 — 전 라우트 일치 확인)
  - user leaf-only의 런타임 강제 (시드 원칙으로 강등 — 관리 API는 운영자 신뢰 모델)
  - 매 로그인 기본 Role 재부여 (회수 부활), DB 트리거 (비즈니스 로직 트리거 관례 이탈)

- **수용된 잔여 리스크**: Role 0개 계정 = 의도된 운영 상태(게이트 라우트 균일 403,
  /me·/permissions·logout은 동작); xmax=0 구현 디테일 의존(테스트 핀 + tx 2쿼리 폴백 주석);
  롤링 배포 창의 Role 없는 신규 계정(Railway 단일 인스턴스 창≈0, 복구 SQL 아래);
  sender 권한 주기 재검사 없음(기동/페어링 시만 — 서버가 실시간 집행하므로 자문 지연 수용).

- **배포 체크리스트**:
  1. push → Railway 재배포로 009 자동 적용 (백필 포함)
  2. 백필 검증: `SELECT count(*) FROM platform.accounts a WHERE a.kind='user' AND NOT EXISTS
     (SELECT 1 FROM platform.account_roles ar WHERE ar.account_id=a.id)` = 0
  3. `PLATFORM_ADMIN_ACCOUNT_IDS`는 기존 값 유지 (이제 admin Role 부트스트랩 입력)
  4. 스모크: user 토큰 /wallet 200·/analysis 403, admin 토큰 /analysis 200·/rbac/roles 200,
     무토큰 401, `/me`에 permissions 배열, sender 로그 "platform permissions fetched"
  5. 롤링 창 복구 SQL(필요시): `INSERT INTO platform.account_roles SELECT a.id, r.id FROM
     platform.accounts a JOIN platform.roles r ON r.name='user' WHERE a.kind='user' AND NOT
     EXISTS (SELECT 1 FROM platform.account_roles ar WHERE ar.account_id=a.id AND
     ar.role_id=r.id)` — 부팅 자동 재백필은 회수 부활 때문에 금지

- **수정 내역**: `d1fd72cd`(internal/rbac), `782d5dee`(009+스토어), `87e5e8af`(플랫폼 게이트
  전환+관리 API), `3d1bc511`(sender 자문 게이트), `e0476d85`(Driver Pack 셋업 게이트),
  `f216935b`(허브 permissions 전환)

- **재발 시 대응**: 네임스페이스 범위·스코프 병행·계층 의미론·기본 Role 부여 방식·부트스트랩
  fail-open이 후속 리뷰에서 재제기되면 본 문서와 계획서 Rejected Decisions를 인용하여 즉시
  종결한다. 새 permission 추가는 **새 마이그레이션 append + internal/rbac 상수 + testStore
  복원 목록** 3곳 동기화(통합 테스트가 드리프트를 잡는다).
