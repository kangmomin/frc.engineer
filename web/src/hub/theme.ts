// FRC Engineer Hub — theme palette + accent derivation.
// Ported from the design's renderVals() color layer (hub.dc.html:573-608).
// Pure functions only: given accent + mode, produce the token palette `t`.

export type ThemeMode = 'light' | 'dark';
export type Density = 'comfortable' | 'compact';

// ---- color helpers (hub.dc.html:573-576) ----
function hx(h: string): [number, number, number] {
  let s = h.replace('#', '');
  if (s.length === 3) s = s.split('').map((x) => x + x).join('');
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}
export function darken(h: string, f: number): string {
  return '#' + hx(h).map((x) => Math.round(x * f).toString(16).padStart(2, '0')).join('');
}
export function rgba(h: string, a: number): string {
  const c = hx(h);
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}
function lum(h: string): number {
  const c = hx(h).map((x) => {
    const v = x / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

export interface HubTheme {
  bg: string; rail: string; panel: string; panel2: string; inset: string;
  line: string; linesoft: string; line2: string;
  t1: string; t2: string; t3: string;
  ok: string; warn: string; warnSoft: string; warnBorder: string;
  sbest: string; purple: string; green: string; yellow: string; normal: string;
  banner: string;
  barbase: string; tyreRed: string; tyreHard: string; navMuted: string; navHoverBg: string;
  // accent-derived
  acc: string; onAcc: string; accInk: string; accSoft: string; accBorder: string;
  // added vs. design (Fable C2): design never injects these as CSS vars, so
  // dark mode silently fell back to light values. We compute them properly.
  okSoft: string; negRed: string;
  // ink for top-3 leaderboard positions (hub.dc.html:648).
  topInk: string;
  // wet-condition accent + hard-compound fill (hub.dc.html:741,820).
  wetInk: string; compHard: string;
  // incident damage 0–24 / 25–49 / 50–74 / 75–100%, green to red.
  damageScale: [string, string, string, string];
}

export const ACCENT_OPTIONS = ['#e0a83d', '#3fb6c9', '#e0533d', '#9a7cff'] as const;

export function buildTheme(accent: string, mode: ThemeMode = 'light'): HubTheme {
  const dark = mode === 'dark';
  const ACC = accent || '#e0a83d';

  const base = dark
    ? {
        bg: '#0b0d12', rail: '#0e1016', panel: '#12141b', panel2: '#171c25', inset: '#0f1219',
        line: '#232935', linesoft: '#171c25', line2: '#2a313d',
        t1: '#e6e8ee', t2: '#8a91a0', t3: '#5c6473',
        ok: '#5fd08a', warn: '#d0a748', warnSoft: 'rgba(208,167,72,.10)', warnBorder: '#4a4029',
        sbest: '#b98bff', purple: '#b98bff', green: '#5fd08a', yellow: '#e8c760', normal: '#e6e8ee',
        banner: 'linear-gradient(100deg,#14171f 0%,#101319 60%,#0e1016 100%)',
        barbase: '#333b48', tyreRed: '#e0533d', tyreHard: '#d6dae2', navMuted: '#464d5a', navHoverBg: 'rgba(255,255,255,.035)',
      }
    : {
        bg: '#edeff2', rail: '#ffffff', panel: '#ffffff', panel2: '#f4f5f7', inset: '#f7f8fa',
        line: '#e4e7eb', linesoft: '#eef0f3', line2: '#d3d7dd',
        t1: '#1a1d24', t2: '#565b66', t3: '#878d97',
        ok: '#1a9e57', warn: '#b7791f', warnSoft: 'rgba(183,121,31,.10)', warnBorder: '#e0cfa2',
        sbest: '#7c3aed', purple: '#7c3aed', green: '#1a9e57', yellow: '#b7791f', normal: '#1a1d24',
        banner: 'linear-gradient(100deg,#ffffff 0%,#f7f8fa 60%,#f3f4f6 100%)',
        barbase: '#d8dbe1', tyreRed: '#c8392b', tyreHard: '#4a4f59', navMuted: '#aeb4bd', navHoverBg: 'rgba(0,0,0,.04)',
      };

  const acc = ACC;
  const onAcc = lum(ACC) > 0.42 ? '#17130a' : '#ffffff';
  const accInk = dark ? ACC : darken(ACC, 0.66);
  const accSoft = rgba(ACC, dark ? 0.11 : 0.13);
  const accBorder = rgba(ACC, dark ? 0.34 : 0.42);

  return {
    ...base,
    acc, onAcc, accInk, accSoft, accBorder,
    okSoft: rgba(base.ok, 0.12),
    negRed: dark ? '#c98a7a' : '#b5533f',
    topInk: dark ? '#cdd2db' : '#3a3f49',
    wetInk: dark ? '#3fb6c9' : '#2f8aa0',
    compHard: dark ? '#d6dae2' : '#c8ccd4',
    // Lightness is monotone so the order survives colour-vision deficiency, and
    // the worst step has the most contrast against the panel in either mode.
    damageScale: dark ? ['#00581f', '#7e6f00', '#df7b0c', '#ffaaa7'] : ['#00d47f', '#889c00', '#976400', '#9b0020'],
  };
}

/**
 * CSS custom properties injected on the Hub root. All colors are passed to
 * components as the typed `HubTheme` object and read as `t.x` (no missing-var
 * bug — Fable C2). The only genuinely CSS-only case is the card `:hover` rule,
 * which needs `--accBorder`. Spec-ref badges and row density are passed as props.
 */
export function hubCssVars(t: HubTheme): Record<string, string> {
  return { '--accBorder': t.accBorder };
}

export function rowPadFor(density: Density): string {
  return density === 'compact' ? '7px' : '11px';
}
