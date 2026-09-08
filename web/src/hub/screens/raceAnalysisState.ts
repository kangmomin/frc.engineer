import type { RaceAnalysisListOptions } from '../data/platform';
import type { RaceAnalysisListResponse, SectionCompleteness } from '../data/raceAnalysisTypes';

export type RaceAnalysisFailureReason = 'unauthorized' | 'forbidden' | 'not-found' | 'bad-input' | 'network';

export function isCurrentRaceAnalysisGeneration(responseGeneration: number, currentGeneration: number): boolean {
  return responseGeneration === currentGeneration;
}

export function incidentFailureTransition(reason: RaceAnalysisFailureReason): { kind: 'not-found' | 'error'; refreshList: boolean } {
  return reason === 'not-found'
    ? { kind: 'not-found', refreshList: true }
    : { kind: 'error', refreshList: false };
}

export function appendAnalysisPage(previous: RaceAnalysisListResponse, incoming: RaceAnalysisListResponse): RaceAnalysisListResponse {
  const seen = new Set<string>();
  const items = [...previous.items, ...incoming.items].filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
  return { items, nextOffset: incoming.nextOffset };
}

export interface SectionPresentation {
  kind: 'complete' | 'confirmed-zero' | 'partial' | 'unavailable' | 'unknown';
  reasons: readonly string[];
}

export function sectionPresentation(completeness: Pick<SectionCompleteness, 'status' | 'reasons'>, dataCount: number): SectionPresentation {
  switch (completeness.status) {
    case 'complete':
      return { kind: dataCount === 0 ? 'confirmed-zero' : 'complete', reasons: completeness.reasons };
    case 'partial':
      return { kind: 'partial', reasons: completeness.reasons };
    case 'unavailable':
      return { kind: 'unavailable', reasons: completeness.reasons };
    case 'unknown':
      return { kind: 'unknown', reasons: completeness.reasons };
  }
}

export function completenessReasonText(reasons: readonly string[]): string {
  if (reasons.length === 0) return '';
  const labels: Record<string, string> = {
    'legacy-metadata-missing': 'legacy metadata is unavailable',
    'schema-unsupported': 'this schema is not supported',
    'source-missing': 'the source was not captured',
    'late-capture': 'capture began late',
    'checkpoint-finalize': 'checkpoint finalization was used',
    'event-buffer-limit': 'event buffer limit reached',
    'event-upload-limit': 'event upload limit reached',
    'incident-window-truncated': 'incident window was truncated',
    'incident-participant-limit': 'incident participant limit reached',
    'incident-collision-limit': 'incident collision limit reached',
    'incident-frame-limit': 'incident frame limit reached',
    'incident-clip-limit': 'incident clip limit reached',
    'incident-merge-limit': 'incident merge limit reached',
    'upload-participants-trimmed': 'participants were trimmed for upload',
    'upload-clips-dropped': 'clips were dropped for upload',
    'request-budget-dropped': 'clips were dropped for the request budget',
    'track-outline-unavailable': 'recorded track outline is unavailable',
    'track-outline-downsampled': 'recorded track outline was downsampled',
    'pit-measurement-unavailable': 'measured pit time is unavailable',
  };
  return reasons.map((reason) => labels[reason] ?? reason).join('; ');
}

export interface AnalysisFilterValues {
  search: string;
  gameFormat: string;
  sessionType: string;
  dateFrom: string;
  dateTo: string;
}

export const EMPTY_ANALYSIS_FILTERS: AnalysisFilterValues = { search: '', gameFormat: '', sessionType: '', dateFrom: '', dateTo: '' };

export function analysisFilterQuery(values: AnalysisFilterValues): RaceAnalysisListOptions {
  // Date inputs use the viewer's local day. The API receives explicit instants
  // with an exclusive next-day end, including the entire selected last day.
  const from = values.dateFrom ? new Date(`${values.dateFrom}T00:00:00`) : null;
  const before = values.dateTo ? new Date(`${values.dateTo}T00:00:00`) : null;
  if (before) before.setDate(before.getDate() + 1);
  return {
    search: values.search.trim(), gameFormat: values.gameFormat, sessionType: values.sessionType.trim(),
    from: from?.toISOString(), before: before?.toISOString(),
  };
}
