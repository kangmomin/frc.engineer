import { describe, expect, it } from 'vitest';
import { getTeamKey, getTeamShort, TEAM_NAMES, TEAM_SHORT } from './teamColors';

describe('teamColors', () => {
  it('TEAM_SHORT covers exactly the same team IDs as TEAM_NAMES', () => {
    const shortKeys = Object.keys(TEAM_SHORT).sort();
    const nameKeys = Object.keys(TEAM_NAMES).sort();
    expect(shortKeys).toEqual(nameKeys);
  });

  it('every TEAM_SHORT badge is a non-empty 2-3 char code (255 is the em-dash placeholder)', () => {
    for (const [id, badge] of Object.entries(TEAM_SHORT)) {
      if (id === '255') {
        expect(badge).toBe('—');
        continue;
      }
      expect(badge.length).toBeGreaterThanOrEqual(2);
      expect(badge.length).toBeLessThanOrEqual(3);
    }
  });

  it('surfaces unknown team IDs as T{id} instead of hiding them behind an em dash', () => {
    // 게임이 새 팀 ID 대역을 보내면 '—'가 값을 삼켜 원인 파악이 막힌다.
    expect(getTeamShort(9999)).toBe('T9999');
  });

  it('keeps the em dash for the no-team sentinel and for missing values', () => {
    expect(getTeamShort(255)).toBe('—');
    expect(getTeamShort(undefined as unknown as number)).toBe('—');
    expect(getTeamShort(NaN)).toBe('—');
  });

  it('does not discard team ID 0 (Mercedes) as a falsy value', () => {
    expect(getTeamShort(0)).toBe('MER');
    expect(getTeamKey(0)).toBe('mercedes');
  });

  it('normalizes the F1 25 and 2026 Season Pack IDs of a team to one mark key', () => {
    expect(getTeamKey(476)).toBe(getTeamKey(0));   // Mercedes
    expect(getTeamKey(484)).toBe(getTeamKey(8));   // McLaren
    expect(getTeamKey(485)).toBe(getTeamKey(10));  // Audi
  });

  it('has no mark key for the no-team sentinel or unmapped IDs', () => {
    expect(getTeamKey(255)).toBeNull();
    expect(getTeamKey(9999)).toBeNull();
  });

  it('gives every TEAM_SHORT id except the sentinel a mark key', () => {
    for (const id of Object.keys(TEAM_SHORT)) {
      if (id === '255') continue;
      expect(getTeamKey(Number(id))).not.toBeNull();
    }
  });
});
