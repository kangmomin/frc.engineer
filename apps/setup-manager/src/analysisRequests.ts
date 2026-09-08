import { fetchJsonWithSenderDebug } from './senderDebug';
import { normalizeAnalysisServerUrl } from './sessionAnalysis';
import type { SelectedLapTrace, TraceRange, TraceState } from './analysisTrace';

export function traceRequestKey(url: string, generation: number, dir: string, lap: number, range: TraceRange | null): string {
  return JSON.stringify([normalizeAnalysisServerUrl(url), generation, dir, lap, range?.fromM ?? null, range?.toM ?? null]);
}
export async function fetchTrace(url: string, dir: string, lap: number, range: TraceRange | null, signal: AbortSignal): Promise<TraceState> {
  const query = new URLSearchParams({ lap: String(lap) });
  if (range) { query.set('fromM', String(range.fromM)); query.set('toM', String(range.toM)); }
  const { status, data } = await fetchJsonWithSenderDebug<SelectedLapTrace | { error: { code: string; message: string; extent?: TraceRange } }>(
    normalizeAnalysisServerUrl(url), `/api/sessions/${encodeURIComponent(dir)}/trace?${query}`, 'session-trace',
    { init: { signal }, allowStatuses: [400, 404, 405, 413, 422, 500], allowNonJsonStatuses: [404] },
  );
  if (data && 'error' in data) return { error: data.error };
  if (status === 404) return { error: { code: 'unsupported', message: 'This server does not expose native traces. The five coarse traces below remain available; update the sender for native samples.' } };
  if (status !== 200 || !data || !('timing' in data)) return { error: { code: 'invalid_response', message: 'The trace response could not be read.' } };
  return { data };
}
