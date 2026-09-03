import { describe, expect, it } from 'vitest';
import { isF126OnlyTrack, trackContextFor } from './tracks';

describe('track format constraints', () => {
  it('limits 2026 season-pack tracks to F1 26', () => {
    expect(isF126OnlyTrack(39)).toBe(true);
    expect(isF126OnlyTrack(42)).toBe(true);
    expect(isF126OnlyTrack(7)).toBe(false);
    expect(trackContextFor(39, 'F1 25')).toEqual({ trackId: 39, format: 'F1 26' });
  });
});
