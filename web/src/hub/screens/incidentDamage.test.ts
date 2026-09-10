import { describe, expect, it } from 'vitest';
import { buildTheme } from '../theme';
import { INCIDENT_DAMAGE_PARTS, INCIDENT_DAMAGE_VALUES, incidentDamageColor, incidentDamageStep, incidentDamageView } from './incidentDamage';

const zeros = () => Array.from({ length: INCIDENT_DAMAGE_VALUES }, () => 0);
const snapshot = (entries: Record<number, number>) => zeros().map((value, slot) => entries[slot] ?? value);

describe('incident damage', () => {
  it('maps every wire slot exactly once, keeping the RL, RR, FL, FR tyre order', () => {
    expect(INCIDENT_DAMAGE_PARTS.map(({ slot }) => slot).sort((a, b) => a - b)).toEqual(zeros().map((_, slot) => slot));
    expect(Object.fromEntries(INCIDENT_DAMAGE_PARTS.map(({ part, slot }) => [part, slot]))).toMatchObject({ 'wing-rear': 2, 'tyre-rl': 8, 'tyre-rr': 9, 'tyre-fl': 10, 'tyre-fr': 11 });
  });

  it('uses four equal-width steps from green to red in both themes', () => {
    expect([0, 24, 25, 49, 50, 74, 75, 100].map(incidentDamageStep)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
    for (const mode of ['light', 'dark'] as const) {
      const t = buildTheme('#e0a83d', mode);
      expect(new Set(t.damageScale).size).toBe(4);
      expect(incidentDamageColor(t, 100)).toBe(t.damageScale[3]);
    }
  });

  it('selects the painted snapshot by presence, never by value', () => {
    expect(incidentDamageView({ damageBefore: snapshot({ 3: 40 }), damageAfter: zeros() })).toEqual({ basis: 'after', baseline: true, values: zeros(), increases: zeros().map(() => null) });
    expect(incidentDamageView({ damageBefore: snapshot({ 0: 10 }), damageAfter: snapshot({ 0: 42, 8: 100 }) })?.increases).toEqual(snapshot({ 0: 32, 8: 100 }).map((value) => value || null));
    expect(incidentDamageView({ damageBefore: snapshot({ 1: 12 }), damageAfter: null })).toMatchObject({ basis: 'before', baseline: false, values: snapshot({ 1: 12 }) });
    expect(incidentDamageView({ damageBefore: null, damageAfter: snapshot({ 5: 8 }) })).toMatchObject({ basis: 'after', baseline: false, increases: zeros().map(() => null) });
  });

  it('shows nothing when no captured part is damaged or a snapshot is malformed', () => {
    expect(incidentDamageView({ damageBefore: zeros(), damageAfter: zeros() })).toBeNull();
    expect(incidentDamageView({ damageBefore: null, damageAfter: null })).toBeNull();
    expect(incidentDamageView({ damageBefore: null, damageAfter: [100] })).toBeNull();
  });
});
