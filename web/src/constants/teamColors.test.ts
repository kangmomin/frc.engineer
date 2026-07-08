import { describe, expect, it } from 'vitest';
import { getTeamShort, TEAM_NAMES, TEAM_SHORT } from './teamColors';

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

  it('falls back to an em dash for unknown team IDs', () => {
    expect(getTeamShort(9999)).toBe('—');
  });
});
