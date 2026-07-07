import { NavTabs } from '../../shell/NavTabs';
import type { ShellControls } from '../../shell/types';
import type { StatusTone } from '../../utils/raceDisplay';
import styles from './BroadcastView.module.css';

const STATUS_COLOR: Record<StatusTone, string> = {
  green: 'var(--accent-lime)',
  formation: 'var(--accent)',
  safety: '#eab308',
  vsc: '#eab308',
  red: 'var(--accent-red)',
  info: 'var(--text-muted)',
};

export interface BroadcastHeaderProps {
  controls: ShellControls;
  gpTitle: string;
  gpSubtitle: string;
  lap: { displayLap: number; totalLaps: number; toGo: number; progressPct: number };
  fastest: { code: string; time: string } | null;
  activeVersion: 25 | 26;
  status: { label: string; tone: StatusTone };
}

export function BroadcastHeader({ controls, gpTitle, gpSubtitle, lap, fastest, activeVersion, status }: BroadcastHeaderProps) {
  const statusColor = STATUS_COLOR[status.tone];
  return (
    <header
      style={{
        flex: 'none',
        display: 'grid',
        gridTemplateColumns: '1fr auto 1fr',
        alignItems: 'center',
        gap: 22,
        background: 'var(--bg-panel)',
        border: '1px solid var(--bg-panel-border)',
        borderRadius: 'var(--radius-lg)',
        padding: '11px 18px',
        boxShadow: 'var(--shadow-panel)',
      }}
    >
      {/* LEFT: nav + GP title */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 13, minWidth: 0 }}>
        <NavTabs active={controls.view} onNavigate={controls.onNavigate} disabled={controls.navDisabled} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--font-racing)', fontWeight: 800, fontSize: 16, letterSpacing: '0.02em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {gpTitle}
          </div>
          <div style={{ fontSize: 10.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
            {gpSubtitle}
          </div>
        </div>
      </div>

      {/* CENTER: lap counter + progress */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, minWidth: 280 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 9 }}>
          <span style={{ fontSize: 10.5, letterSpacing: '0.18em', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Lap</span>
          <span style={{ fontFamily: 'var(--font-racing)', fontWeight: 800, fontStyle: 'italic', fontSize: 30, lineHeight: 1, color: 'var(--accent)' }}>{lap.displayLap}</span>
          <span style={{ fontFamily: 'var(--font-racing)', fontWeight: 700, fontSize: 16, color: 'var(--text-muted)' }}>/ {lap.totalLaps}</span>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)', marginLeft: 6 }}>{lap.toGo} to go</span>
        </div>
        <div style={{ width: '100%', height: 5, background: 'rgba(132,147,150,.18)', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ height: '100%', background: 'linear-gradient(90deg,var(--accent),var(--accent-lime))', width: `${lap.progressPct}%`, boxShadow: 'var(--shadow-glow)' }} />
        </div>
      </div>

      {/* RIGHT: fastest lap + version + status */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12 }}>
        <div style={{ textAlign: 'right', lineHeight: 1.2 }}>
          <div style={{ fontSize: 9.5, letterSpacing: '0.14em', color: 'var(--sector-purple)', textTransform: 'uppercase' }}>Fastest Lap</div>
          <div style={{ fontFamily: 'var(--font-racing)', fontWeight: 800, fontSize: 14, color: 'var(--sector-purple)' }}>
            {fastest ? `${fastest.code} · ${fastest.time}` : '—'}
          </div>
        </div>
        <div style={{ width: 1, height: 30, background: 'var(--bg-panel-border)' }} />
        <div style={{ display: 'flex', gap: 3, background: 'rgba(14,14,15,.6)', border: '1px solid var(--bg-panel-border)', borderRadius: 'var(--radius-md)', padding: 3 }}>
          {([25, 26] as const).map((v) => (
            <span
              key={v}
              style={{
                fontFamily: 'var(--font-racing)',
                fontWeight: 700,
                fontSize: 10.5,
                letterSpacing: '0.05em',
                padding: '5px 9px',
                borderRadius: 'var(--radius-sm)',
                background: activeVersion === v ? 'var(--accent)' : 'transparent',
                color: activeVersion === v ? '#0c0c0d' : 'var(--text-muted)',
              }}
            >
              F1 {v}
            </span>
          ))}
        </div>
        {/* pill 배경은 tone 무관 중립 다크로 고정 — tone 색을 배경 틴트로 쓰면 red/info 텍스트
            대비가 WCAG AA(4.5:1) 미달. tone 은 dot·텍스트·보더로 전달한다. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', borderRadius: 'var(--radius-md)', background: 'rgba(14,14,15,.55)', border: `1px solid color-mix(in srgb, ${statusColor} 38%, transparent)` }}>
          <span className={styles.pulse} style={{ width: 9, height: 9, borderRadius: '50%', background: statusColor, boxShadow: `0 0 12px ${statusColor}` }} />
          <span style={{ fontFamily: 'var(--font-racing)', fontWeight: 700, fontSize: 12.5, letterSpacing: '0.1em', color: statusColor }}>{status.label}</span>
        </div>
      </div>
    </header>
  );
}
