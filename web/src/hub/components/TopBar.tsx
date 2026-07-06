// Hub top bar — context label, search, format toggle, credit balance
// (hub.dc.html:54-68). Search + format toggle are visual-only in Phase 1.
import type { HubTheme } from '../theme';

const MONO = "'JetBrains Mono',monospace";

interface Props {
  t: HubTheme;
  ctx: string;
  spendableCredits: number;
  escrowCredits: number;
}

export function TopBar({ t, ctx, spendableCredits, escrowCredits }: Props) {
  return (
    <header
      style={{
        height: 60, flex: 'none', borderBottom: `1px solid ${t.line}`, display: 'flex',
        alignItems: 'center', gap: 18, padding: '0 24px', background: t.rail,
      }}
    >
      <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '.13em', color: t.t2, fontWeight: 600, whiteSpace: 'nowrap' }}>{ctx}</div>
      <div style={{ flex: 1, maxWidth: 400, display: 'flex', alignItems: 'center', gap: 9, background: t.panel2, border: `1px solid ${t.line}`, borderRadius: 8, padding: '8px 12px', color: t.t3, fontSize: 13 }}>
        <span style={{ fontSize: 15, lineHeight: 1 }}>⌕</span>
        <span>셋업 · 드라이버 · 트랙 검색</span>
      </div>
      <div style={{ display: 'flex', border: `1px solid ${t.line2}`, borderRadius: 7, overflow: 'hidden', fontFamily: MONO, fontSize: 10.5, fontWeight: 600 }}>
        <span style={{ padding: '6px 12px', background: t.acc, color: t.onAcc }}>F1 25</span>
        <span style={{ padding: '6px 12px', color: t.t2 }}>F1 26</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '6px 13px', background: t.panel2, border: `1px solid ${t.line}`, borderRadius: 9 }}>
        <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 13, color: t.accInk, letterSpacing: '.01em' }}>⬢ {spendableCredits.toLocaleString('en-US')}</span>
        <span style={{ width: 1, height: 16, background: t.line2 }} />
        <span style={{ fontFamily: MONO, fontSize: 11, color: t.warn, display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ animation: 'escpulse 1.6s ease-in-out infinite' }}>◷</span>
          {escrowCredits} <span style={{ color: t.t3, fontWeight: 500, letterSpacing: '.05em' }}>ESCROW</span>
        </span>
      </div>
    </header>
  );
}
