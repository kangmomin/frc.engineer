import { describe, expect, it } from 'vitest';
import { canViewAnalysis, hasPermission } from './permissions';
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
