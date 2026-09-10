import type { IncidentParticipant } from '../data/raceAnalysisTypes';
import type { HubTheme } from '../theme';

// Fixed by the platform contract; tyres keep the game's RL, RR, FL, FR order.
export const INCIDENT_DAMAGE_VALUES = 12;

export type IncidentDamagePart =
  | 'wing-fl' | 'wing-fr' | 'wing-rear' | 'floor' | 'diffuser' | 'sidepod'
  | 'engine' | 'gearbox' | 'tyre-rl' | 'tyre-rr' | 'tyre-fl' | 'tyre-fr';

// Listed front to rear for reading; `slot` is the wire index.
export const INCIDENT_DAMAGE_PARTS: ReadonlyArray<{ part: IncidentDamagePart; slot: number; label: string }> = [
  { part: 'wing-fl', slot: 0, label: '앞 왼쪽 윙' },
  { part: 'wing-fr', slot: 1, label: '앞 오른쪽 윙' },
  { part: 'tyre-fl', slot: 10, label: '앞 왼쪽 타이어' },
  { part: 'tyre-fr', slot: 11, label: '앞 오른쪽 타이어' },
  { part: 'sidepod', slot: 5, label: '사이드포드' },
  { part: 'floor', slot: 3, label: '플로어' },
  { part: 'engine', slot: 6, label: '엔진' },
  { part: 'gearbox', slot: 7, label: '기어박스' },
  { part: 'diffuser', slot: 4, label: '디퓨저' },
  { part: 'tyre-rl', slot: 8, label: '뒤 왼쪽 타이어' },
  { part: 'tyre-rr', slot: 9, label: '뒤 오른쪽 타이어' },
  { part: 'wing-rear', slot: 2, label: '리어 윙' },
];

export const INCIDENT_DAMAGE_STEP_LABELS = ['0–24%', '25–49%', '50–74%', '75–100%'] as const;

export function incidentDamageStep(percent: number): 0 | 1 | 2 | 3 {
  if (percent >= 75) return 3;
  if (percent >= 50) return 2;
  if (percent >= 25) return 1;
  return 0;
}

export function incidentDamageColor(t: HubTheme, percent: number): string {
  return t.damageScale[incidentDamageStep(percent)];
}

export interface IncidentDamageView {
  // 'before' is used only when the clip-end snapshot is missing.
  basis: 'after' | 'before';
  // True when a first-collision snapshot exists to compare the clip end against.
  baseline: boolean;
  values: number[];
  increases: Array<number | null>;
}

// Picks the painted snapshot by presence, never by value: a part repaired to 0
// at clip end must not fall back to its first-collision damage.
export function incidentDamageView({ damageBefore, damageAfter }: Pick<IncidentParticipant, 'damageBefore' | 'damageAfter'>): IncidentDamageView | null {
  const before = damageBefore?.length === INCIDENT_DAMAGE_VALUES ? damageBefore : null;
  const after = damageAfter?.length === INCIDENT_DAMAGE_VALUES ? damageAfter : null;
  if (![before, after].some((snapshot) => snapshot?.some((value) => value > 0))) return null;
  if (!after) return before && { basis: 'before', baseline: false, values: before, increases: before.map(() => null) };
  return {
    basis: 'after',
    baseline: before !== null,
    values: after,
    increases: after.map((value, slot) => (before && value > before[slot] ? value - before[slot] : null)),
  };
}
