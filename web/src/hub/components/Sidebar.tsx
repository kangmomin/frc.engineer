// Hub sidebar — logo, nav, user footer (hub.dc.html:29-48).
import type { HubTheme } from '../theme';

export type HubScreen = 'overview' | 'rankings' | 'market' | 'setups' | 'analysis' | 'profile';

const MONO = "'JetBrains Mono',monospace";

const NAV: { id: HubScreen; label: string; idx: string }[] = [
  { id: 'overview', label: 'OVERVIEW', idx: '01' },
  { id: 'rankings', label: 'RANKINGS', idx: '02' },
  { id: 'market', label: 'MARKET', idx: '03' },
  { id: 'setups', label: 'MY SETUPS', idx: '04' },
  { id: 'analysis', label: 'ANALYSIS', idx: '05' },
  { id: 'profile', label: 'PROFILE', idx: '06' },
];

interface Props {
  t: HubTheme;
  active: HubScreen;
  onNav: (id: HubScreen) => void;
  onLaunchLive: () => void;
}

export function Sidebar({ t, active, onNav, onLaunchLive }: Props) {
  return (
    <aside
      style={{
        width: 224, flex: 'none', background: t.rail, borderRight: `1px solid ${t.line}`,
        display: 'flex', flexDirection: 'column', height: '100%',
      }}
    >
      <div style={{ height: 60, display: 'flex', alignItems: 'center', gap: 11, padding: '0 20px', borderBottom: `1px solid ${t.line}`, flex: 'none' }}>
        <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
          <span style={{ width: 4, height: 22, background: t.acc, borderRadius: 1 }} />
          <span style={{ width: 4, height: 22, background: t.line2, borderRadius: 1 }} />
        </div>
        <div style={{ lineHeight: 1 }}>
          <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 15, letterSpacing: '-.02em', color: t.t1 }}>frc</span>
          <span style={{ fontFamily: MONO, fontWeight: 500, fontSize: 15, color: t.t3 }}>.engineer</span>
          <div style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: '.32em', color: t.accInk, marginTop: 3 }}>PITWALL CLOUD</div>
        </div>
      </div>

      <nav style={{ padding: '14px 0', flex: 1, overflowY: 'auto' }}>
        {NAV.map((item) => {
          const on = active === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onNav(item.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 13, width: '100%', textAlign: 'left',
                background: on ? t.navHoverBg : 'transparent', border: 0,
                borderLeft: `2px solid ${on ? t.acc : 'transparent'}`, padding: '11px 20px 11px 18px',
                cursor: 'pointer', color: on ? t.t1 : t.t2, fontFamily: MONO, fontSize: 11.5, letterSpacing: '.13em', fontWeight: 600,
              }}
            >
              <span style={{ color: on ? t.accInk : t.navMuted, fontSize: 9.5, letterSpacing: 0 }}>{item.idx}</span>
              <span>{item.label}</span>
            </button>
          );
        })}
        <button
          onClick={onLaunchLive}
          style={{
            display: 'flex', alignItems: 'center', gap: 13, width: '100%', textAlign: 'left',
            background: 'transparent', border: 0, borderLeft: '2px solid transparent',
            padding: '11px 20px 11px 18px', marginTop: 8, cursor: 'pointer',
            color: t.t2, fontFamily: MONO, fontSize: 11.5, letterSpacing: '.13em', fontWeight: 600,
          }}
        >
          <span style={{ color: t.ok, fontSize: 9.5, letterSpacing: 0, animation: 'escpulse 1.6s ease-in-out infinite' }}>◆</span>
          <span>LIVE · 피트월</span>
        </button>
      </nav>

      <div style={{ padding: '16px 20px', borderTop: `1px solid ${t.line}`, display: 'flex', alignItems: 'center', gap: 11, flex: 'none' }}>
        <div style={{ width: 36, height: 36, borderRadius: 9, background: 'linear-gradient(135deg,#00cfb8,#0c7a6e)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: MONO, fontWeight: 700, fontSize: 12, color: '#04110f' }}>KM</div>
        <div style={{ minWidth: 0, lineHeight: 1.3 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: t.t1, overflow: 'hidden', textOverflow: 'ellipsis' }}>kangmomin</div>
          <div style={{ fontFamily: MONO, fontSize: 9.5, color: t.ok, display: 'flex', alignItems: 'center', gap: 4 }}>◆ STEAM · OWNED</div>
        </div>
      </div>
    </aside>
  );
}
