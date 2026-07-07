// Hub top bar — context label, search, format toggle, credit balance
// (hub.dc.html:54-68). Search + format toggle are visual-only in Phase 1.
import type { HubTheme } from '../theme';

const MONO = "'JetBrains Mono',monospace";

interface Props {
  t: HubTheme;
  ctx: string;
  // Logged-in account's real spendable balance; null when logged out (chip hidden).
  credits: number | null;
}

export function TopBar({ t, ctx, credits }: Props) {
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
      {credits != null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '6px 13px', background: t.panel2, border: `1px solid ${t.line}`, borderRadius: 9 }}>
          <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 13, color: t.accInk, letterSpacing: '.01em' }}>⬢ {credits.toLocaleString('en-US')}</span>
          <span style={{ fontFamily: MONO, fontSize: 10, color: t.t3, fontWeight: 500, letterSpacing: '.05em' }}>CREDITS</span>
        </div>
      )}
    </header>
  );
}
