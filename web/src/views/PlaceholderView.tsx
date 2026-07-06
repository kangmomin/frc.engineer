import { useShallow } from 'zustand/react/shallow';
import { NavTabs } from '../shell/NavTabs';
import type { ShellControls } from '../shell/types';
import type { ViewId } from '../shell/viewNav';
import { useTelemetryStore } from '../store/telemetryStore';
import { getConnectionBadgeLabel } from '../utils/connectionStatus';

/**
 * Phase 0 자리표시자 뷰. 아직 구현되지 않은 뷰(Phase 1~3) 슬롯을 채우고,
 * 새 데이터 레이어가 E2E 로 동작함을 라이브 값(드라이버 수/세션/연결)으로 증명한다.
 */

const LABELS: Record<ViewId, string> = {
  pitwall: 'RACE · Pit Wall',
  qualifying: 'QUALI · Qualifying',
  broadcast: 'WORLD FEED · Broadcast',
};

const PHASE: Record<ViewId, string> = {
  pitwall: 'Phase 2',
  qualifying: 'Phase 3',
  broadcast: 'Phase 1',
};

export function PlaceholderView({ controls }: { controls: ShellControls }) {
  const { view, onNavigate, navDisabled } = controls;
  const { connectionState, driverCount, sessionType, trackName } = useTelemetryStore(
    useShallow((s) => ({
      connectionState: s.connectionState,
      driverCount: s.pitwallState?.drivers.length ?? 0,
      sessionType: s.pitwallState?.session?.sessionType ?? '—',
      trackName: s.pitwallState?.session?.trackName ?? '—',
    })),
  );

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', padding: 16, gap: 11 }}>
      <header
        style={{
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          background: 'var(--bg-panel)',
          border: '1px solid var(--bg-panel-border)',
          borderRadius: 'var(--radius-lg)',
          padding: '11px 18px',
          boxShadow: 'var(--shadow-panel)',
        }}
      >
        <NavTabs active={view} onNavigate={onNavigate} disabled={navDisabled} />
        <div style={{ fontFamily: 'var(--font-racing)', fontWeight: 800, fontSize: 16, letterSpacing: '0.02em' }}>
          {LABELS[view]}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <ShellButton label="Rooms" onClick={controls.onOpenRooms} active={controls.roomsActive} />
          <ShellButton label="Races" onClick={controls.onOpenArchive} />
          <ShellButton label="Setup" onClick={controls.onOpenSetup} />
          <ShellButton label="Home" onClick={controls.onGoHome} />
        </div>
      </header>

      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 14,
        }}
      >
        <div style={{ fontFamily: 'var(--font-racing)', fontWeight: 800, fontSize: 30, color: 'var(--text-secondary)' }}>
          {LABELS[view]}
        </div>
        <div style={{ fontSize: 12, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
          {PHASE[view]} — coming soon
        </div>
        <div style={{ display: 'flex', gap: 22, marginTop: 10, fontSize: 12, fontFamily: 'var(--font-racing)', color: 'var(--text-muted)' }}>
          <Stat label="CONN" value={getConnectionBadgeLabel(connectionState)} color="var(--accent)" />
          <Stat label="DRIVERS" value={String(driverCount)} color="var(--accent-lime)" />
          <Stat label="SESSION" value={sessionType} color="var(--text-primary)" />
          <Stat label="TRACK" value={trackName} color="var(--text-primary)" />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'baseline' }}>
      {label} <strong style={{ color }}>{value}</strong>
    </span>
  );
}

function ShellButton({ label, onClick, active }: { label: string; onClick: () => void; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        fontFamily: 'var(--font-racing)',
        fontWeight: 700,
        fontSize: 10.5,
        letterSpacing: '0.06em',
        padding: '6px 11px',
        borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--bg-panel-border)',
        background: active ? 'rgba(0,229,255,.12)' : 'rgba(14,14,15,.5)',
        color: active ? 'var(--accent)' : 'var(--text-muted)',
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}
