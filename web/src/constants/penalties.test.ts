import { describe, expect, it } from 'vitest';
import { formatPenaltyEntry, infringementTypeLabel, penaltyTypeLabel } from './penalties';

describe('penalties constants', () => {
  it('maps known penalty/infringement codes to the Go labels', () => {
    expect(penaltyTypeLabel(4)).toBe('Time Penalty');
    expect(penaltyTypeLabel(0)).toBe('Drive Through');
    expect(infringementTypeLabel(7)).toBe('Corner cutting gained time');
  });

  it('falls back for unknown codes without throwing', () => {
    expect(penaltyTypeLabel(99)).toBe('Penalty 99');
    expect(infringementTypeLabel(99)).toBe('Infringement 99');
  });

  it('formats a full entry with lap, type, seconds, and infringement', () => {
    expect(formatPenaltyEntry({ lap: 12, pen: 4, inf: 7, sec: 5 })).toBe(
      'L12 · Time Penalty (5s) · Corner cutting gained time',
    );
  });

  it('omits the seconds suffix when absent/zero', () => {
    expect(formatPenaltyEntry({ lap: 3, pen: 5, inf: 12 })).toBe(
      'L3 · Warning · Ignoring yellow flags',
    );
  });
});
