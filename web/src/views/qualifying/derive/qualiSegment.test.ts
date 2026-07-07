import { describe, expect, it } from 'vitest';
import { deriveQualiSegment } from './qualiSegment';

describe('deriveQualiSegment — Q1/Q2 cutoffs', () => {
  it('Q1: safeCount=15, has cutoff, out label describes P16-20', () => {
    const vm = deriveQualiSegment('Q1');
    expect(vm.segment).toBe('Q1');
    expect(vm.safeCount).toBe(15);
    expect(vm.noCutoff).toBe(false);
    expect(vm.outLabel).toBe('P16–20 out · Top 15 advance');
  });

  it('Q2: safeCount=10, has cutoff, out label describes P11-15', () => {
    const vm = deriveQualiSegment('Q2');
    expect(vm.safeCount).toBe(10);
    expect(vm.noCutoff).toBe(false);
    expect(vm.outLabel).toBe('P11–15 out · Top 10 advance');
  });

  it('SS1/SS2 (sprint shootout) mirror Q1/Q2 cutoffs', () => {
    expect(deriveQualiSegment('SS1').safeCount).toBe(15);
    expect(deriveQualiSegment('SS2').safeCount).toBe(10);
  });

  it('normalizes case and whitespace', () => {
    const vm = deriveQualiSegment('  q1 ');
    expect(vm.segment).toBe('Q1');
    expect(vm.safeCount).toBe(15);
  });
});

describe('deriveQualiSegment — Q3 (no cutoff, pole shootout)', () => {
  it('Q3: no cutoff, "Pole Shootout" label', () => {
    const vm = deriveQualiSegment('Q3');
    expect(vm.safeCount).toBeNull();
    expect(vm.noCutoff).toBe(true);
    expect(vm.outLabel).toBe('Pole Shootout');
  });

  it('SS3 mirrors Q3', () => {
    const vm = deriveQualiSegment('SS3');
    expect(vm.noCutoff).toBe(true);
    expect(vm.outLabel).toBe('Pole Shootout');
  });
});

describe('deriveQualiSegment — non-standard formats (honest degrade, no fabrication)', () => {
  it('Short Q / OSQ: unknown segment structure, safeCount null, outLabel dash', () => {
    const vm = deriveQualiSegment('Short Q');
    expect(vm.safeCount).toBeNull();
    expect(vm.noCutoff).toBe(true);
    expect(vm.outLabel).toBe('—');
  });

  it('null/undefined/empty sessionType degrades to dash segment', () => {
    expect(deriveQualiSegment(null).segment).toBe('—');
    expect(deriveQualiSegment(undefined).segment).toBe('—');
    expect(deriveQualiSegment('').segment).toBe('—');
  });
});
