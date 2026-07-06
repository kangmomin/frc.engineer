import { describe, expect, it } from 'vitest';
import { battleConfidence, ratePerLapMs, rangeLabel, trendFromSlope } from './battleMath';

describe('trendFromSlope', () => {
  it('closing at and beyond the -40 threshold', () => {
    expect(trendFromSlope(-40)).toBe('closing');
    expect(trendFromSlope(-100)).toBe('closing');
  });

  it('opening at and beyond the +40 threshold', () => {
    expect(trendFromSlope(40)).toBe('opening');
    expect(trendFromSlope(100)).toBe('opening');
  });

  it('stable strictly between -40 and 40', () => {
    expect(trendFromSlope(-39)).toBe('stable');
    expect(trendFromSlope(0)).toBe('stable');
    expect(trendFromSlope(39)).toBe('stable');
  });
});

describe('ratePerLapMs', () => {
  it('flips sign so a negative (closing) slope yields a positive rate', () => {
    expect(ratePerLapMs(-40, 90)).toBe(3600);
  });

  it('flips sign so a positive (opening) slope yields a negative rate', () => {
    expect(ratePerLapMs(40, 90)).toBe(-3600);
  });

  it('zero slope yields zero rate', () => {
    // -0 * lapSec === -0 in JS; toBeCloseTo treats it as equal to 0 (sign is irrelevant here).
    expect(ratePerLapMs(0, 90)).toBeCloseTo(0);
  });
});

describe('battleConfidence', () => {
  it('combines gap/rate/DRS-boost per the weighted formula (rate known)', () => {
    // gapScore=0.5, rateScore=1.0, boost=1 -> round(100*0.775) = 78
    expect(battleConfidence(750, 400, true)).toBe(78);
  });

  it('clamps to the 5% floor when everything is unfavourable (rate known)', () => {
    expect(battleConfidence(1500, -400, false)).toBe(5);
  });

  it('clamps to the 95% ceiling when everything is maximally favourable (rate known)', () => {
    expect(battleConfidence(0, 800, true)).toBe(95);
  });

  it('uses the reduced-scale formula when rate is null (insufficient history)', () => {
    // gapScore=0.5, boost=1 -> round(100*0.4) = 40
    expect(battleConfidence(750, null, true)).toBe(40);
    // gapScore=1, boost=0 -> round(100*0.5) = 50
    expect(battleConfidence(0, null, false)).toBe(50);
  });

  it('clamps the null-rate formula to [5, 60]', () => {
    expect(battleConfidence(1500, null, false)).toBe(5);
    expect(battleConfidence(0, null, true)).toBe(60);
  });
});

describe('rangeLabel', () => {
  it('2025: OVT range at and below 500ms', () => {
    expect(rangeLabel(500, false, undefined)).toEqual({ kind: 'OVT', text: 'OVT range' });
  });

  it('2025: DRS range between 501ms and 1000ms', () => {
    expect(rangeLabel(501, false, undefined)).toEqual({ kind: 'DRS', text: 'DRS range' });
    expect(rangeLabel(1000, false, undefined)).toEqual({ kind: 'DRS', text: 'DRS range' });
  });

  it('2025: chasing beyond 1000ms', () => {
    expect(rangeLabel(1001, false, undefined)).toEqual({ kind: 'CHASE', text: 'chasing' });
  });

  it('2026: OVT ready when overtakeAvailable is true, regardless of gap', () => {
    expect(rangeLabel(5000, true, true)).toEqual({ kind: 'OVT', text: 'OVT ready' });
  });

  it('2026: never reports DRS, even at a gap that would be DRS range in 2025', () => {
    const result = rangeLabel(700, true, false);
    expect(result.kind).not.toBe('DRS');
    expect(result).toEqual({ kind: 'CHASE', text: 'in range' });
  });

  it('2026: chasing beyond 1000ms when overtake is unavailable', () => {
    expect(rangeLabel(1001, true, undefined)).toEqual({ kind: 'CHASE', text: 'chasing' });
  });
});
