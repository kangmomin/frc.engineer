# 허브 RBAC 관리 UI를 도입하고, 계정 피커용 검색 API를 추가한다

- **날짜**: 2026-08-08
- **이슈**: `20260806-rbac-permissions.md` 결정 6에서 "관리는 admin API만, 허브 관리 UI는 범위 외"로
  못박았으나, 실제 운영에서 admin Role 부여 이후 권한 작업이 전부 curl이 되어 사용자가 허브
  관리 화면을 요청했다. 화면을 붙이려 하자 **계정 피커를 만들 방법이 없다는 제약**이 드러났다 —
  `/rbac/accounts/{id}/roles`는 UUID를 이미 알아야 하고, 플랫폼에 계정 목록/검색 라우트가 없었다.

- **결정**:
  1. **결정 6을 뒤집어 허브에 ACCESS 스크린을 도입한다** (사용자 AskUserQuestion 확정).
     기각 사유였던 "범위 외"는 우선순위 판단이었고 설계 제약이 아니었다 — RBAC 서버 설계
     자체는 변경하지 않고 기존 `/rbac/*` 7종을 그대로 화면으로 올린다.
  2. **`GET /rbac/accounts?q=` 를 신설한다** (사용자 확정: UUID 직접 입력 대신 검색).
     `pithub.rbac.read` 게이트 **재사용** — 권한 카탈로그는 append 전용이므로 새 노드를
     만들지 않는 편이 마이그레이션 0으로 끝난다. 읽기 경로라 변경 예산(rbacRatePerMin)을
     쓰지 않는다. 결과는 50행 상한, 빈 q는 첫 페이지(빈 검색창 대신 실제 행으로 열린다).
  3. **시스템 계정(treasury·fee sink)도 검색 결과에 포함한다.** 같은 테이블의 할당 가능한
     행이고, 감추면 "누가 무엇을 들고 있는지"를 잘못 보여주게 된다. UI는 `kind` 배지로 구분한다.
  4. **화면은 항상 현재 상태 전체를 체크박스로 띄우고 그대로 되돌려 보낸다.** `/rbac` 변경
     API가 전부 치환 semantics라, 부분 add/remove UI를 만들면 누락이 곧 권한 회수가 된다.
     체크박스 전체 전송이 이 사고 유형을 구조적으로 없앤다.
  5. **자기 락아웃을 저장 전에 계산해 경고한다.** 대상이 본인 계정이고 결과 Role 집합이
     `pithub.rbac.update`를 못 덮으면 붉은 배너 + 버튼 라벨을 "락아웃 감수하고 저장"으로
     바꾼다. 차단하지는 않는다 — 서버가 의도적으로 last-admin 가드를 두지 않기로 한
     결정(20260806 결정 6, 경합만 늘고 실익 없음)과 층을 맞춘다.
  6. **`canManageRBAC`에는 구서버 admin 불리언 폴백을 두지 않는다.** `canViewAnalysis`와
     갈리는 지점이다: `/rbac/*`는 RBAC 서버에만 존재하므로, 폴백은 없는 API를 호출하는
     빈 화면만 만든다. permissions 배열이 없으면 화면 자체를 열지 않는다.
  7. **ACCESS 항목은 사이드바 맨 끝(idx 08)에 둔다.** 조건부 노출 항목을 중간에 넣으면
     앞 항목의 번호가 권한에 따라 흔들린다.

- **결정자**: 사용자 (AskUserQuestion 2문항 — 계정 선택 방식·화면 범위 모두 확정),
  세부 설계는 에이전트

- **근거**:
  - 계정 검색 없이는 화면이 "UUID 붙여넣기"가 되어 관리 화면의 목적을 못 채운다. 검색 API가
    유일하게 제대로 동작하는 경로였고, 기존 permission 노드 재사용으로 카탈로그 변경이 0이다.
  - 락아웃 경고를 서버가 아닌 화면에 둔 이유: 서버 가드는 이미 기각된 결정이고, 경고는
    보안 경계가 아니라 조작 실수 방지다 — 자문 게이트(sender)와 같은 층위.
  - 상위 그랜트가 하위를 덮는 것을 UI가 "상위 포함"으로 표시한다. dot 경계 규칙
    (`pithub.race`가 `pithub.race-analyze`를 덮지 않음)은 `hasPermission` TS 미러가 그대로 지킨다.

- **기각된 대안**:
  - UUID 직접 입력 (백엔드 변경 0) — 관리 화면으로서 실용성이 없다고 사용자가 판단
  - 계정 할당만 담고 Role 관리는 계속 curl — 새 Role 생성에 여전히 curl이 필요해 반쪽
  - 검색 결과에서 시스템 계정 제외 — 보유 현황을 잘못 표시
  - `pithub.rbac.accounts.read` 같은 신규 permission 노드 — 마이그레이션 append가 필요하고
    기존 `rbac.read`와 실질 경계가 같다

- **수용된 잔여 리스크**: 검색 50행 상한을 UI가 "더 있음"으로 알리지 않는다(운영자가 좁히면
  되는 규모); 락아웃 경고는 본인 계정 편집에만 적용되고 admin **Role의 그랜트**를 줄이는
  경로는 정적 경고문만 띄운다(정확한 판정에 자기 Role 목록이 필요한데 화면이 그것을 항상
  들고 있지 않다); 화면 노출은 `/me` 캐시 기반이라 권한 변경 후 새로고침이 필요하다.

- **수정 내역**: (이 문서와 함께 커밋 예정)
  `internal/platformsvc/rbac.go`(SearchAccounts+AccountRoles), `cmd/platform/main.go`(라우트+핸들러),
  `web/src/hub/data/platform.ts`(RBAC 클라이언트 7종), `web/src/hub/data/permissions.ts`(canManageRBAC),
  `web/src/hub/screens/Access.tsx`(신규), `web/src/hub/components/Sidebar.tsx`, `web/src/hub/HubApp.tsx`

- **재발 시 대응**: "허브 관리 UI는 범위 외"(20260806 결정 6)가 다시 인용되면 본 문서로 대체됐음을
  밝히고 즉시 종결한다. 치환 semantics를 부분 add/remove UI로 바꾸자는 제안, last-admin 서버 가드
  재도입 제안은 각각 결정 4·5와 20260806 결정 6을 인용해 종결한다.
