import { q1AdvancingCount, type QualifyingFormat } from '../../../components/qualifying/format';

export interface QualiSegmentVM {
  segment: string;
  safeCount: number | null;
  noCutoff: boolean;
  outLabel: string;
}

export function deriveQualiSegment(sessionType: string | null | undefined, format?: QualifyingFormat | null): QualiSegmentVM {
  const segment = (sessionType ?? '').trim().toUpperCase() || '—';
  const q1Count = q1AdvancingCount(format);
  let safeCount: number | null = null;
  let outLabel = '—';
  if (q1Count != null) {
    if (segment === 'Q1' || segment === 'SS1') {
      safeCount = q1Count;
      outLabel = `P${q1Count + 1}–${format!.qualifyingGridSize} out · Top ${q1Count} advance`;
    } else if (segment === 'Q2' || segment === 'SS2') {
      safeCount = 10;
      outLabel = `P11–${q1Count} out · Top 10 advance`;
    }
  }
  if (segment === 'Q3' || segment === 'SS3') outLabel = 'Pole Shootout';
  return { segment, safeCount, noCutoff: safeCount === null, outLabel };
}
