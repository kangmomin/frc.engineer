-- 009_rbac.sql — RBAC: 유저 →(다대다)→ Role →(다대다)→ permission 노드.
--
-- 노드 이름은 {service}[.{scope}[.{action}]] — kebab-case 세그먼트, '.' 구분,
-- 깊이 최대 3, action은 CRUD 4종만. CHECK는 internal/rbac(ValidNode/ValidRoleName)의
-- Go 검증을 미러한다. 매칭 규칙은 "정확 일치 OR dot-boundary 조상 일치"
-- (internal/rbac.HasPermission) — 상위 노드 그랜트가 서브트리 전체를 커버한다.
--
-- 카탈로그(permissions)는 append 전용: 권한 추가는 반드시 새 마이그레이션의
-- INSERT로만 한다 (이 파일은 적용 후 checksum 고정 — 수정 금지). 카탈로그 행은
-- 삭제하지 않는다(role_permissions FK가 막는다 — 의도).
--
-- 시드 Role 'user'/'admin'은 시스템 불변식의 일부다: 'user'는 신규 계정 기본
-- 부여(accounts upsert의 grant CTE)와 아래 백필의 대상이고, 'admin'은
-- PLATFORM_ADMIN_ACCOUNT_IDS env 부트스트랩의 대상 — 관리 API는 둘의 삭제를
-- 거부한다. 'user'의 그랜트가 leaf뿐인 것은 시드 원칙(미래 action이 전 유저에
-- 암묵 유출되는 것 방지)이지 런타임 불변식이 아니다.

CREATE TABLE platform.permissions (
    name       TEXT PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- internal/rbac.ValidNode 미러: kebab 세그먼트, 깊이 1..3, ≤64자
    CONSTRAINT permissions_name_format_chk CHECK (
        name ~ '^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*){0,2}$'
        AND char_length(name) <= 64
    ),
    -- 3번째 세그먼트(action)는 CRUD 4종 또는 부재('')만
    CONSTRAINT permissions_action_chk CHECK (
        split_part(name, '.', 3) IN ('', 'create', 'read', 'update', 'delete')
    )
);

CREATE TABLE platform.roles (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- internal/rbac.ValidRoleName 미러
    CONSTRAINT roles_name_format_chk CHECK (
        name ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(name) BETWEEN 1 AND 32
    ),
    CONSTRAINT roles_description_chk CHECK (char_length(description) <= 200)
);

-- Role → permission 그랜트. permission 쪽은 CASCADE 없음(카탈로그 불멸).
CREATE TABLE platform.role_permissions (
    role_id         UUID NOT NULL REFERENCES platform.roles(id) ON DELETE CASCADE,
    permission_name TEXT NOT NULL REFERENCES platform.permissions(name),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (role_id, permission_name)
);

-- 계정 → Role 할당.
CREATE TABLE platform.account_roles (
    account_id UUID NOT NULL REFERENCES platform.accounts(id) ON DELETE CASCADE,
    role_id    UUID NOT NULL REFERENCES platform.roles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (account_id, role_id)
);
-- "이 Role을 가진 계정" 역조회(관리 API·Role 삭제 영향 파악)용.
CREATE INDEX account_roles_role_idx ON platform.account_roles (role_id);

-- ── 시드 ─────────────────────────────────────────────────────────────────
-- internal/rbac.AllSeededNodes()와 3중 핀(이 INSERT ↔ Go 목록 ↔ testStore 복원).
-- 34노드 = 루트 3 + 중간 11 + leaf 20. 전부 현재 배선되는 게이트의 노드 또는 조상.
INSERT INTO platform.permissions (name) VALUES
  ('pithub'), ('pitwall'), ('sender'),
  ('pithub.device'),       ('pithub.device.create'),
  ('pithub.race'),         ('pithub.race.create'),         ('pithub.race.read'),
  ('pithub.race-analyze'), ('pithub.race-analyze.create'), ('pithub.race-analyze.read'), ('pithub.race-analyze.delete'),
  ('pithub.market'),       ('pithub.market.create'),       ('pithub.market.read'),       ('pithub.market.update'),
  ('pithub.wallet'),       ('pithub.wallet.read'),
  ('pithub.purchase'),     ('pithub.purchase.create'),
  ('pithub.review'),       ('pithub.review.create'),
  ('pithub.feedback'),     ('pithub.feedback.create'),     ('pithub.feedback.read'),
  ('pithub.rbac'),         ('pithub.rbac.create'),         ('pithub.rbac.read'),
                           ('pithub.rbac.update'),         ('pithub.rbac.delete'),
  ('pitwall.broadcast'),   ('pitwall.broadcast.create'),
  ('sender.setup'),        ('sender.setup.read');

INSERT INTO platform.roles (name, description) VALUES
  ('user',  '기본 사용자 — 현행 일반 기능 전체'),
  ('admin', '운영자 — 전 서비스 서브트리');

-- user = leaf 13개(시드 원칙 — 위 헤더 참조), admin = 서비스 루트 3개(상속 그랜트).
INSERT INTO platform.role_permissions (role_id, permission_name)
SELECT r.id, g.perm
FROM platform.roles r
JOIN (VALUES
  ('user',  'pithub.device.create'),
  ('user',  'pithub.race.create'),
  ('user',  'pithub.race.read'),
  ('user',  'pithub.market.create'),
  ('user',  'pithub.market.read'),
  ('user',  'pithub.market.update'),
  ('user',  'pithub.wallet.read'),
  ('user',  'pithub.purchase.create'),
  ('user',  'pithub.review.create'),
  ('user',  'pithub.feedback.create'),
  ('user',  'pithub.feedback.read'),
  ('user',  'pitwall.broadcast.create'),
  ('user',  'sender.setup.read'),
  ('admin', 'pithub'),
  ('admin', 'pitwall'),
  ('admin', 'sender')
) AS g(role_name, perm) ON g.role_name = r.name;

-- 백필: 기존 모든 user 계정에 기본 Role — 현행 동작 100% 보존의 핵심
-- (기존 upload 디바이스의 POST /races 무중단 포함). 시스템 계정(treasury/
-- fee_sink)은 로그인/권한 주체가 아니므로 제외.
INSERT INTO platform.account_roles (account_id, role_id)
SELECT a.id, r.id
FROM platform.accounts a
JOIN platform.roles r ON r.name = 'user'
WHERE a.kind = 'user';
