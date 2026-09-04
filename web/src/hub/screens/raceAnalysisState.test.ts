import { describe, expect, it } from 'vitest';
import type { RaceAnalysisListResponse, SectionCompleteness } from '../data/raceAnalysisTypes';
import {
  appendAnalysisPage,
  incidentFailureTransition,
  isCurrentRaceAnalysisGeneration,
  sectionPresentation,
} from './raceAnalysisState';

const complete: SectionCompleteness = { status: 'complete', reasons: [], capturedCount: 0, storedCount: 0 };
const partial: SectionCompleteness = { status: 'partial', reasons: ['late-capture'], capturedCount: 10, storedCount: 5 };
const unavailable: SectionCompleteness = { status: 'unavailable', reasons: ['request-budget-dropped'], capturedCount: 5, storedCount: 0 };
const unknown: SectionCompleteness = { status: 'unknown', reasons: ['legacy-metadata-missing'], capturedCount: null, storedCount: null };

function page(ids: string[], nextOffset: number | null): RaceAnalysisListResponse {
  return {
    items: ids.map((id) => ({
      id, track: { id: 1, name: 'Bahrain' }, sessionType: 'Race', gameFormat: 'F1 26', recordedAt: null,
      uploadedAt: '2026-09-01T00:00:00Z', finishPosition: null, completedLaps: null, bestLapMs: null,
      schemaVersion: 2, incidentCount: 0, completeness: { analysis: complete, incidents: complete },
    })), nextOffset,
  };
}

describe('race analysis async state helpers', () => {
  it('dedupes appended pages by id without losing the latest nextOffset', () => {
    const merged = appendAnalysisPage(page(['a', 'b'], 2), page(['b', 'c'], 4));
    expect(merged.items.map((item) => item.id)).toEqual(['a', 'b', 'c']);
    expect(merged.nextOffset).toBe(4);
  });

  it('accepts only the latest response generation and keeps incident 404 scoped while refreshing the owner list', () => {
    expect(isCurrentRaceAnalysisGeneration(3, 3)).toBe(true);
    expect(isCurrentRaceAnalysisGeneration(2, 3)).toBe(false);
    expect(incidentFailureTransition('not-found')).toEqual({ kind: 'not-found', refreshList: true });
    expect(incidentFailureTransition('network')).toEqual({ kind: 'error', refreshList: false });
  });

  it('expresses confirmed zero, partial data, unavailable drop and legacy unknown independently', () => {
    expect(sectionPresentation(complete, 0).kind).toBe('confirmed-zero');
    expect(sectionPresentation(partial, 5).kind).toBe('partial');
    expect(sectionPresentation(unavailable, 0).kind).toBe('unavailable');
    expect(sectionPresentation(unknown, 0).kind).toBe('unknown');
  });
});
