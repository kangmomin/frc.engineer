import type { DriverInfo } from '../../../types/telemetry';

const DASH = '—';
const WEAR_HIGH = 60;
const WEAR_MID = 35;

/** Wheel order matches the DTO: [FL, FR, RL, RR] (backend g2d-mapped). */
const WHEEL_LABELS = ['FL', 'FR', 'RL', 'RR'] as const;

export interface TyreWheelVM {
  label: string;
  wearText: string;
  wearColor: string;
  /** Surface / inner temp text, e.g. "98° / 103°". Missing (0) degrades to '—'. */
  tempText: string;
}

export interface TyreDetailVM {
  wheels: TyreWheelVM[];
}

function wearColor(pct: number): string {
  if (pct >= WEAR_HIGH) return 'var(--accent-red)';
  if (pct >= WEAR_MID) return 'var(--accent-soft)';
  return 'var(--text-secondary)';
}

/** A physically-impossible 0° means "not reported yet" (garage/pre-telemetry), so
 * degrade to '—'; wear 0% is a legitimate fresh-tyre value and is shown. */
function tempText(surface: number, inner: number): string {
  const s = surface > 0 ? `${Math.round(surface)}°` : DASH;
  const i = inner > 0 ? `${Math.round(inner)}°` : DASH;
  if (s === DASH && i === DASH) return DASH;
  return `${s} / ${i}`;
}

/**
 * Player-only 4-wheel wear + temperature detail for the strip below the leaderboard.
 * Renders whenever the wear array is present (length 4) — [0,0,0,0] is a valid
 * fresh-tyre state, not "missing", so it is NOT hidden. Returns null only when the
 * player is absent or the arrays are unavailable.
 */
export function deriveTyreDetail(player: DriverInfo | null): TyreDetailVM | null {
  if (!player || !Array.isArray(player.tireWear) || player.tireWear.length < 4) {
    return null;
  }
  const surf = player.tireSurfaceTemp ?? [];
  const inner = player.tireInnerTemp ?? [];
  const wheels = WHEEL_LABELS.map((label, i) => {
    const wear = Math.max(0, Math.round(player.tireWear[i] ?? 0));
    return {
      label,
      wearText: `${wear}%`,
      wearColor: wearColor(wear),
      tempText: tempText(surf[i] ?? 0, inner[i] ?? 0),
    };
  });
  return { wheels };
}
