// FRC Engineer Hub — display formatting + value→color derivation.
// Ported from renderVals() (hub.dc.html:609-648, 662-673). Pure: raw domain
// values in, display strings/colors out. Keeps the data contract free of
// preformatted strings (Fable B1).
import type { HubTheme } from './theme';

/** Fixed reference "now" so mock relative-times render deterministically. */
export const REF_NOW = Date.UTC(2026, 6, 6, 12, 0, 0);

export function msToTime(ms: number): string {
  const m = Math.floor(ms / 60000);
  const s = ((ms % 60000) / 1000).toFixed(3).padStart(6, '0');
  return `${m}:${s}`;
}

export function secFmt(ms: number): string {
  return (ms / 1000).toFixed(3);
}

/** Coarse "M:SS.d" used for strategy avg pace (hub.dc.html shows "1:29.4"). */
export function msToTimeShort(ms: number): string {
  const m = Math.floor(ms / 60000);
  const s = ((ms % 60000) / 1000).toFixed(1).padStart(4, '0');
  return `${m}:${s}`;
}

/** Signed integer label, e.g. 80 → "+80", -120 → "-120". */
export function signed(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

/** Gap to the leader in ms → "—" (leader) or "+1.234". */
export function gapLabel(lapMs: number, leadMs: number): string {
  return lapMs === leadMs ? '—' : `+${((lapMs - leadMs) / 1000).toFixed(3)}`;
}

/** Credit price → number, or "—" when not listed (null). */
export function priceLabel(credits: number | null): string {
  return credits == null ? '—' : String(credits);
}

/** epoch ms → Korean relative time, matching the design's session/review labels. */
export function relativeTime(atMs: number, nowMs: number = REF_NOW): string {
  const diff = Math.max(0, nowMs - atMs);
  if (diff < 60_000) return '방금';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}시간 전`;
  if (diff < 172_800_000) return '어제';
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}일 전`;
  return `${Math.floor(diff / 604_800_000)}주 전`;
}

// ---- sector / lap coloring (hub.dc.html:631-648) ----
export function sectorColor(v: number, min: number, max: number, t: HubTheme): string {
  if (v === min) return t.purple;
  if (v - min < 120) return t.green;
  if (v > min + (max - min) * 0.62) return t.yellow;
  return t.normal;
}

export function lapColor(lapMs: number, leadMs: number, t: HubTheme): string {
  if (lapMs === leadMs) return t.purple;
  if (lapMs - leadMs < 300) return t.green;
  if (lapMs > leadMs + 1400) return t.yellow;
  return t.normal;
}

export type TyreCompound = 'SOFT' | 'MED' | 'HARD';
export function tyreColor(tyre: TyreCompound, t: HubTheme): string {
  if (tyre === 'SOFT') return t.tyreRed;
  if (tyre === 'MED') return t.yellow;
  return t.tyreHard;
}

/** Consistency ratio (0..1) → bar color, using accent for the mid band. */
export function consistencyColor(ratio: number, acc: string, t: HubTheme): string {
  if (ratio >= 0.9) return t.green;
  if (ratio >= 0.85) return acc;
  return t.yellow;
}

/** Condition tag color: WET-ish → wet ink, else warn (hub.dc.html:741,838). */
export function condColor(cond: string, t: HubTheme): string {
  return /WET/.test(cond) ? t.wetInk : t.warn;
}
