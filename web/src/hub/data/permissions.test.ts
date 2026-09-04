import { describe, expect, it } from 'vitest';
import { canDeleteAdminAnalysisReports, canEditMySetups, canManageRBAC, canReadAdminAnalysisReports, canReadMySetups, canReadRaceAnalysis, canStartViewAs, canViewAnalysis, canViewFeedbackInbox, hasPermission } from './permissions';
import type { PlatformAccount } from './session';

// internal/rbac/rbac_test.go의 테이블과 동형 — Go/TS 매칭 규칙이 갈라지면 여기서 잡힌다.
describe('hasPermission (dot-boundary ancestor match)', () => {
  const cases: Array<[string, string[], string, boolean]> = [
    ['exact leaf', ['pithub.market.create'], 'pithub.market.create', true],
    ['root covers leaf', ['pithub'], 'pithub.race.read', true],
    ['root covers mid', ['pithub'], 'pithub.race', true],
    ['mid covers leaf', ['pithub.race'], 'pithub.race.read', true],
    // 실제 카탈로그에 race / race-analyze 형제가 존재 — dot 경계가 없으면 권한 상승.
    ['race grant must not cover race-analyze', ['pithub.race'], 'pithub.race-analyze.read', false],
    ['race-analyze grant must not cover race', ['pithub.race-analyze'], 'pithub.race.read', false],
    ['leaf does not cover ancestor', ['pithub.race.read'], 'pithub.race', false],
    ['leaf does not cover sibling', ['pithub.race.read'], 'pithub.race.create', false],
    ['other service', ['pitwall'], 'sender.setup.read', false],
    ['empty grants', [], 'pithub.race.read', false],
    ['empty-string grant matches nothing', [''], 'pithub.race.read', false],
    ['node shorter than grant', ['pithub.race.read'], 'pithub', false],
    ['admin roots cover everything wired', ['pithub', 'pitwall', 'sender'], 'pithub.rbac.delete', true],
  ];
  it.each(cases)('%s', (_name, grants, node, want) => {
    expect(hasPermission(grants, node)).toBe(want);
  });
});

describe('canViewAnalysis', () => {
  const base: PlatformAccount = {
    id: 'a', steamId64: '7', persona: 'P', avatarUrl: '', kind: 'user',
    verified: false, banned: false, createdAt: '2026-01-01T00:00:00Z',
  };

  it('null account → false', () => {
    expect(canViewAnalysis(null)).toBe(false);
  });

  it('permissions present and covering → true (RBAC 서버)', () => {
    expect(canViewAnalysis({ ...base, permissions: ['pithub'] })).toBe(true);
    expect(canViewAnalysis({ ...base, permissions: ['pithub.race-analyze.read'] })).toBe(true);
  });

  it('permissions present but not covering → false, admin 플래그가 있어도 permissions가 진실', () => {
    expect(canViewAnalysis({ ...base, admin: true, permissions: ['pithub.race.read'] })).toBe(false);
  });

  it('permissions 부재(구서버) → admin 폴백', () => {
    expect(canViewAnalysis({ ...base, admin: true })).toBe(true);
    expect(canViewAnalysis({ ...base, admin: false })).toBe(false);
    expect(canViewAnalysis(base)).toBe(false);
  });
});

describe('race analysis owner/admin permission split', () => {
  const base: PlatformAccount = {
    id: 'a', steamId64: '7', persona: 'P', avatarUrl: '', kind: 'user',
    verified: false, banned: false, createdAt: '2026-01-01T00:00:00Z',
  };

  it('shows structured owner analysis for race.read, not the administrator HTML grant', () => {
    expect(canReadRaceAnalysis({ ...base, permissions: ['pithub.race.read'] })).toBe(true);
    expect(canReadRaceAnalysis({ ...base, permissions: ['pithub.race-analyze.read'] })).toBe(false);
    expect(canReadRaceAnalysis({ ...base, permissions: ['pithub'] })).toBe(true);
    expect(canReadRaceAnalysis({ ...base, admin: true })).toBe(false);
    expect(canReadRaceAnalysis({ ...base, banned: true, permissions: ['pithub.race.read'] })).toBe(false);
  });

  it('keeps HTML report read and delete gates distinct and fail-closed', () => {
    expect(canReadAdminAnalysisReports({ ...base, permissions: ['pithub.race-analyze.read'] })).toBe(true);
    expect(canDeleteAdminAnalysisReports({ ...base, permissions: ['pithub.race-analyze.read'] })).toBe(false);
    expect(canDeleteAdminAnalysisReports({ ...base, permissions: ['pithub.race-analyze.delete'] })).toBe(true);
    expect(canReadAdminAnalysisReports({ ...base, permissions: ['pithub.race.read'] })).toBe(false);
    expect(canReadAdminAnalysisReports({ ...base, admin: true })).toBe(false);
    expect(canDeleteAdminAnalysisReports({ ...base, banned: true, permissions: ['pithub'] })).toBe(false);
  });
});

describe('canManageRBAC', () => {
  const base: PlatformAccount = {
    id: 'a', steamId64: '7', persona: 'P', avatarUrl: '', kind: 'user',
    verified: false, banned: false, createdAt: '2026-01-01T00:00:00Z',
  };

  it('null account → false', () => {
    expect(canManageRBAC(null)).toBe(false);
  });

  it('rbac.read를 덮는 그랜트 → true', () => {
    expect(canManageRBAC({ ...base, permissions: ['pithub'] })).toBe(true);
    expect(canManageRBAC({ ...base, permissions: ['pithub.rbac'] })).toBe(true);
    expect(canManageRBAC({ ...base, permissions: ['pithub.rbac.read'] })).toBe(true);
  });

  it('덮지 않는 그랜트 → false', () => {
    expect(canManageRBAC({ ...base, permissions: ['pithub.race.read'] })).toBe(false);
    expect(canManageRBAC({ ...base, permissions: ['pithub.rbac.update'] })).toBe(false);
    expect(canManageRBAC({ ...base, permissions: [] })).toBe(false);
  });

  // canViewAnalysis와 다른 점: 구서버 폴백이 없다 — /rbac/*가 없는 서버에서
  // admin 불리언만 보고 화면을 열면 전부 404가 되는 빈 화면이 된다.
  it('permissions 부재(구서버) → admin이어도 false', () => {
    expect(canManageRBAC({ ...base, admin: true })).toBe(false);
  });
});

describe('canStartViewAs', () => {
  const base: PlatformAccount = {
    id: 'a', steamId64: '7', persona: 'P', avatarUrl: '', kind: 'user',
    verified: false, banned: false, createdAt: '2026-01-01T00:00:00Z',
  };

  it('requires the create leaf (or an ancestor) and a non-banned actor', () => {
    expect(canStartViewAs({ ...base, permissions: ['pithub.view-as.create'] })).toBe(true);
    expect(canStartViewAs({ ...base, permissions: ['pithub'] })).toBe(true);
    expect(canStartViewAs({ ...base, permissions: ['pithub.rbac.read'] })).toBe(false);
    expect(canStartViewAs({ ...base, banned: true, permissions: ['pithub'] })).toBe(false);
  });
});

describe('canViewFeedbackInbox', () => {
  const base: PlatformAccount = {
    id: 'a', steamId64: '7', persona: 'P', avatarUrl: '', kind: 'user',
    verified: false, banned: false, createdAt: '2026-01-01T00:00:00Z',
  };

  it('requires the explicit feedback-inbox permission', () => {
    expect(canViewFeedbackInbox({ ...base, permissions: ['pithub.feedback-inbox.read'] })).toBe(true);
    expect(canViewFeedbackInbox({ ...base, permissions: ['pithub.feedback-inbox'] })).toBe(true);
    expect(canViewFeedbackInbox({ ...base, permissions: ['pithub'] })).toBe(true);
  });

  it('fails closed for missing permissions, legacy admin, and self-feedback permission', () => {
    expect(canViewFeedbackInbox(base)).toBe(false);
    expect(canViewFeedbackInbox({ ...base, admin: true })).toBe(false);
    expect(canViewFeedbackInbox({ ...base, admin: true, permissions: ['pithub.feedback.read'] })).toBe(false);
  });

  it('denies banned accounts even when an ancestor grant covers the inbox', () => {
    expect(canViewFeedbackInbox({ ...base, banned: true, permissions: ['pithub'] })).toBe(false);
  });
});

describe('My Setups permissions', () => {
  const base: PlatformAccount = {
    id: 'a', steamId64: '7', persona: 'P', avatarUrl: '', kind: 'user',
    verified: false, banned: false, createdAt: '2026-01-01T00:00:00Z',
  };

  it('fails closed when a legacy response omits permissions', () => {
    expect(canReadMySetups(base)).toBe(false);
    expect(canEditMySetups({ ...base, admin: true })).toBe(false);
  });

  it('allows read separately from update', () => {
    expect(canReadMySetups({ ...base, permissions: ['pithub.race.read'] })).toBe(true);
    expect(canEditMySetups({ ...base, permissions: ['pithub.race.read'] })).toBe(false);
    expect(canEditMySetups({ ...base, permissions: ['pithub.race.update'] })).toBe(true);
  });

  it('keeps banned accounts read-only even under an ancestor grant', () => {
    const banned = { ...base, banned: true, permissions: ['pithub'] };
    expect(canReadMySetups(banned)).toBe(true);
    expect(canEditMySetups(banned)).toBe(false);
  });
});
