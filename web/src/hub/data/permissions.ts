// 계층 permission 매칭 — canonical 구현은 internal/rbac/rbac.go (Go). 이 파일은
// 그 dot-boundary 규칙의 TS 미러다 (apps/setup-manager/src/permissions.ts와 동일).
import type { PlatformAccount } from './session';

// grants는 서버(/me)가 내려주는 "그랜트 노드 원본"(leaf 전개 아님 — admin이면
// ["pithub","pitwall","sender"])이므로 includes()로 비교하면 안 되고 반드시 이
// 함수로 매칭한다. 상위 노드 그랜트는 서브트리 전체를 커버하되 dot 경계를 지킨다:
// "pithub.race"는 "pithub.race.read"를 커버하지만 "pithub.race-analyze.read"는
// 절대 커버하지 않는다.
export function hasPermission(grants: readonly string[], node: string): boolean {
  return grants.some((g) => g === node || (g.length > 0 && node.startsWith(g + '.')));
}

// canViewAnalysis: 허브 ANALYSIS 스크린 게이트. permissions가 오면 그것이 진실
// (RBAC 서버), 없으면 구서버의 admin 불리언 폴백. 진짜 경계는 서버 게이트다 —
// 이 분기는 화면 노출 편의일 뿐이다.
export function canViewAnalysis(account: PlatformAccount | null): boolean {
  if (!account) return false;
  if (account.permissions) return hasPermission(account.permissions, 'pithub.race-analyze.read');
  return account.admin === true;
}

// canManageRBAC: 허브 ACCESS 스크린 게이트. canViewAnalysis와 달리 구서버 admin
// 불리언 폴백을 두지 않는다 — 이 화면이 호출하는 /rbac/* 자체가 RBAC 서버에만
// 존재하므로, 폴백은 없는 API를 부르는 빈 화면만 만든다. 진짜 경계는 서버 게이트다.
export function canManageRBAC(account: PlatformAccount | null): boolean {
  if (!account?.permissions) return false;
  return hasPermission(account.permissions, 'pithub.rbac.read');
}

export function canStartViewAs(account: PlatformAccount | null): boolean {
  if (!account?.permissions || account.banned) return false;
  return hasPermission(account.permissions, 'pithub.view-as.create');
}

// canViewFeedbackInbox deliberately fails closed. This is an operator-only
// surface backed by a new API, so neither the legacy admin flag nor the older
// self-feedback permission can safely stand in for its explicit grant.
export function canViewFeedbackInbox(account: PlatformAccount | null): boolean {
  if (!account?.permissions || account.banned) return false;
  return hasPermission(account.permissions, 'pithub.feedback-inbox.read');
}

// My Setups is new enough that a legacy account response without `permissions`
// must not optimistically call an endpoint an older server may not have.
export function canReadMySetups(account: PlatformAccount | null): boolean {
  if (!account?.permissions) return false;
  return hasPermission(account.permissions, 'pithub.race.read');
}

// A banned user may retain private-read access but cannot edit private setup
// metadata. This mirrors the server gate while keeping the form affordance
// accurate before a POST is attempted.
export function canEditMySetups(account: PlatformAccount | null): boolean {
  if (!account?.permissions || account.banned) return false;
  return hasPermission(account.permissions, 'pithub.race.update');
}
