// Performance radar geometry helpers (pure).
// Ported from renderVals() mkGeo/mkPoly/avgPerf (hub.dc.html:702-706).
import type { HubPerf, HubReview } from '../data/types';

export const RKEYS: (keyof HubPerf)[] = ['downforce', 'topSpeed', 'cornering', 'tyre', 'response'];
export const RLABELS = ['다운포스', '최고속도', '코너링', '타이어 관리', '반응성'];

export interface RadarAxis {
  x2: string; y2: string; labelX: string; labelY: string; label: string;
  anchor: 'start' | 'end' | 'middle'; dy: string;
}
export interface RadarGeo {
  rings: { pts: string }[];
  axes: RadarAxis[];
}
export interface RadarPoly {
  data: string;
  dots: { x: string; y: string }[];
}

const angle = (i: number) => ((-90 + 72 * i) * Math.PI) / 180;

export function mkGeo(cx: number, cy: number, R: number, LR: number): RadarGeo {
  const rings = [0.34, 0.67, 1].map((r) => ({
    pts: RKEYS.map((_, i) => {
      const a = angle(i);
      return `${(cx + R * r * Math.cos(a)).toFixed(1)},${(cy + R * r * Math.sin(a)).toFixed(1)}`;
    }).join(' '),
  }));
  const axes: RadarAxis[] = RKEYS.map((_, i) => {
    const a = angle(i);
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    return {
      x2: (cx + R * cos).toFixed(1),
      y2: (cy + R * sin).toFixed(1),
      labelX: (cx + LR * cos).toFixed(1),
      labelY: (cy + LR * sin).toFixed(1),
      label: RLABELS[i],
      anchor: cos > 0.2 ? 'start' : cos < -0.2 ? 'end' : 'middle',
      dy: sin > 0.25 ? '0.7em' : sin < -0.25 ? '-0.25em' : '0.32em',
    };
  });
  return { rings, axes };
}

export function mkPoly(perf: Partial<HubPerf>, cx: number, cy: number, R: number): RadarPoly {
  const dots = RKEYS.map((k, i) => {
    const a = angle(i);
    const v = (perf[k] ?? 0) / 100;
    return { x: (cx + R * v * Math.cos(a)).toFixed(1), y: (cy + R * v * Math.sin(a)).toFixed(1) };
  });
  return { data: dots.map((d) => `${d.x},${d.y}`).join(' '), dots };
}

/** Average of the reviews that carry a perf rating (hub.dc.html:704). */
export function avgPerf(reviews: HubReview[]): HubPerf | null {
  const w = reviews.filter((r) => r.perf);
  if (!w.length) return null;
  const out = {} as HubPerf;
  RKEYS.forEach((k) => {
    out[k] = Math.round(w.reduce((s, r) => s + (r.perf![k] ?? 0), 0) / w.length);
  });
  return out;
}
