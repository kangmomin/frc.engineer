import { NavTabs } from '../../shell/NavTabs';
import type { ShellControls } from '../../shell/types';
import type { StatusTone } from '../../utils/raceDisplay';
import { WeatherIcon } from '../../ui';
import styles from './PitWallView.module.css';

export const DISPLAY_SETTINGS_ID = 'pitwall-display-settings';

const STATUS_COLOR: Record<StatusTone, string> = {
  green: 'var(--accent-lime)',
  formation: 'var(--accent)',
  safety: '#eab308',
  vsc: '#eab308',
  red: 'var(--accent-red)',
  info: 'var(--text-muted)',
};

export interface PitWallHeaderProps {
  controls: ShellControls;
  gpTitle: string;
  gpSubtitle: string;
  lap: { displayLap: number; totalLaps: number; toGo: number; progressPct: number };
  weather: { weather: string; condLabel: string; trackTemp: number; airTemp: number; iconColor: string };
  status: { label: string; tone: StatusTone };
  is2026: boolean;
  settingsOpen: boolean;
  onToggleSettings: () => void;
  /** Display Settings 팝오버를 닫을 때(Escape/× 클릭) 포커스를 되돌릴 트리거 버튼 참조(FIX-6). */
  settingsButtonRef: React.RefObject<HTMLButtonElement>;
}

/** Broadcast BroadcastHeader 패턴 확장 — weather summary 추가, 버전칩은 read-only(Spec §5). */
export function PitWallHeader({ controls, gpTitle, gpSubtitle, lap, weather, status, is2026, settingsOpen, onToggleSettings, settingsButtonRef }: PitWallHeaderProps) {
  const statusColor = STATUS_COLOR[status.tone];
  return (
    <header
      style={{
        position: 'relative',
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

      {/* RIGHT: weather + status + version(read-only) + display settings */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <div style={{ lineHeight: 1.2, textAlign: 'right' }}>
            <div style={{ fontFamily: 'var(--font-racing)', fontWeight: 700, fontSize: 13.5 }}>
              TRK {Math.round(weather.trackTemp)}° · AIR {Math.round(weather.airTemp)}°
            </div>
            <div style={{ fontSize: 10, letterSpacing: '.1em', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{weather.condLabel}</div>
          </div>
          <div style={{ flex: 'none', width: 22, height: 22, color: weather.iconColor }}>
            <WeatherIcon weather={weather.weather} />
          </div>
        </div>
        <div style={{ width: 1, height: 32, background: 'var(--bg-panel-border)' }} />
        {/* pill 배경은 tone 무관 중립 다크(Broadcast와 동일 WCAG AA 대비 처리). */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', borderRadius: 'var(--radius-md)', background: 'rgba(14,14,15,.55)', border: `1px solid color-mix(in srgb, ${statusColor} 38%, transparent)` }}>
          <span className={styles.pulse} style={{ width: 9, height: 9, borderRadius: '50%', background: statusColor, boxShadow: `0 0 12px ${statusColor}` }} />
          <span style={{ fontFamily: 'var(--font-racing)', fontWeight: 700, fontSize: 12.5, letterSpacing: '0.1em', color: statusColor }}>{status.label}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', padding: '6px 11px', borderRadius: 'var(--radius-md)', background: 'rgba(0,229,255,.1)', border: '1px solid rgba(0,229,255,.3)' }}>
          <span style={{ fontFamily: 'var(--font-racing)', fontWeight: 800, fontSize: 12, letterSpacing: '.04em', color: 'var(--accent)' }}>{is2026 ? 'F1 26' : 'F1 25'}</span>
        </div>
        <button
          ref={settingsButtonRef}
          onClick={onToggleSettings}
          title="Settings"
          aria-expanded={settingsOpen}
          aria-controls={DISPLAY_SETTINGS_ID}
          style={{
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            padding: '7px 12px',
            borderRadius: 'var(--radius-md)',
            background: settingsOpen ? 'var(--accent)' : 'rgba(14,14,15,.5)',
            border: `1px solid ${settingsOpen ? 'var(--accent)' : 'var(--bg-panel-border)'}`,
            color: settingsOpen ? '#0c0c0d' : 'var(--text-secondary)',
            fontFamily: 'var(--font-body)',
            fontWeight: 600,
            fontSize: 11,
            letterSpacing: '.08em',
            textTransform: 'uppercase',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="4" y1="8" x2="20" y2="8" />
            <line x1="4" y1="16" x2="20" y2="16" />
            <circle cx="9" cy="8" r="2.6" fill="var(--bg-panel)" />
            <circle cx="15" cy="16" r="2.6" fill="var(--bg-panel)" />
          </svg>
          Settings
        </button>
      </div>
    </header>
  );
}
