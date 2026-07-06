import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { NavTabs } from '../../shell/NavTabs';
import type { ShellControls } from '../../shell/types';
import { useTelemetryStore } from '../../store/telemetryStore';
import { getRaceStatus, getTrackCondition } from '../../utils/raceDisplay';
import { deriveLapCounter } from '../broadcast/derive/fieldDerivations';
import { COL_ORDER } from './columns';
import { deriveLeaderboardRows } from './derive/leaderboardRows';
import { deriveMyCar } from './derive/myCar';
import { DisplaySettings } from './DisplaySettings';
import { LeaderboardPanel } from './LeaderboardPanel';
import { MyCarPanel } from './MyCarPanel';
import { PitWallHeader } from './PitWallHeader';
import { StrategyGuidePanel } from './StrategyGuidePanel';
import { TyrePredictorPanel } from './TyrePredictorPanel';
import { useDisplayPrefs } from './useDisplayPrefs';
import { type RequestFn, useStrategyGuide } from './useStrategyGuide';
import { WeatherPanel } from './WeatherPanel';

export interface PitWallViewProps {
  controls: ShellControls;
  request: RequestFn;
}

/**
 * Pit Wall(RACE) 뷰 유일 stateful 컨테이너. Broadcast(Phase 1) BroadcastView와 동일 패턴 —
 * positions(60Hz)는 구독하지 않고 drivers/session/playerIndex/gameFormat 슬라이스만
 * useShallow로 구독한다(Phase 1 comp-H1 교훈).
 */
export function PitWallView({ controls, request }: PitWallViewProps) {
  const { driversRaw, session, playerIndex, gameFormat } = useTelemetryStore(
    useShallow((s) => ({
      driversRaw: s.pitwallState?.drivers,
      session: s.pitwallState?.session ?? null,
      playerIndex: s.pitwallState?.playerIndex ?? -1,
      gameFormat: s.pitwallState?.gameFormat,
    })),
  );

  const drivers = useMemo(() => [...(driversRaw ?? [])].sort((a, b) => a.position - b.position), [driversRaw]);
  const player = useMemo(() => drivers.find((d) => d.index === playerIndex) ?? null, [drivers, playerIndex]);
  const is2026 = gameFormat === 2026;

  const prefs = useDisplayPrefs();
  const strategyGuide = useStrategyGuide(request, session, gameFormat);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // ── 게이트(모든 hook 이후) ── Broadcast와 달리 비-Race 세션 게이트는 두지 않는다
  // (cockpit은 practice/race 모두 유효; quali는 QUALI 탭이 별도, Spec §1).
  if (!session || drivers.length === 0) {
    return <PitWallEmpty controls={controls} />;
  }

  // ── 순수 파생 ──
  const rows = deriveLeaderboardRows(drivers, player, is2026, session);
  const myCar = deriveMyCar(player, drivers, session);
  const lapCounter = deriveLapCounter(drivers, session);
  const raceStatus = getRaceStatus(session);
  const cond = getTrackCondition(session.weather);
  const activeColCount = COL_ORDER.filter((k) => prefs.cols[k]).length;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', flexDirection: 'column', padding: 16, gap: 11 }}>
      <PitWallHeader
        controls={controls}
        gpTitle={(session.trackName ?? '').toUpperCase() || 'GRAND PRIX'}
        gpSubtitle={`Cockpit · ${session.sessionType}`}
        lap={lapCounter}
        weather={{
          weather: session.weather,
          condLabel: cond.label,
          trackTemp: session.trackTemp,
          airTemp: session.airTemp,
          iconColor: cond.tone === 'wet' ? 'var(--accent-soft)' : 'var(--accent)',
        }}
        status={raceStatus}
        is2026={is2026}
        settingsOpen={settingsOpen}
        onToggleSettings={() => setSettingsOpen((v) => !v)}
      />
      {settingsOpen && (
        <DisplaySettings
          cols={prefs.cols}
          onToggleCol={prefs.toggleCol}
          panels={prefs.panels}
          onTogglePanel={prefs.togglePanel}
          onResetWidths={prefs.resetWidths}
          is2026={is2026}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      <main style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 306px', gap: 11 }}>
        <LeaderboardPanel
          rows={rows}
          cols={prefs.cols}
          colW={prefs.colW}
          is2026={is2026}
          detail={`${drivers.length} Cars · ${activeColCount} fields · ${is2026 ? 'F1 26' : 'F1 25'}`}
          onResizeStart={prefs.startResize}
        />
        <aside style={{ minHeight: 0, display: 'flex', flexDirection: 'column', gap: 9, overflowY: 'auto' }}>
          {prefs.panels.myCar && <MyCarPanel car={myCar} detail={player ? player.name : '—'} />}
          {prefs.panels.predictor && <TyrePredictorPanel player={player} />}
          {prefs.panels.weather && (
            <WeatherPanel session={session} weatherStep={prefs.weatherStep} onStepChange={prefs.setWeatherStep} />
          )}
          {prefs.panels.strategy && <StrategyGuidePanel state={strategyGuide} />}
        </aside>
      </main>
    </div>
  );
}

function PitWallEmpty({ controls }: { controls: ShellControls }) {
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', padding: 16, gap: 11 }}>
      <header style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 14, background: 'var(--bg-panel)', border: '1px solid var(--bg-panel-border)', borderRadius: 'var(--radius-lg)', padding: '11px 18px', boxShadow: 'var(--shadow-panel)' }}>
        <NavTabs active={controls.view} onNavigate={controls.onNavigate} disabled={controls.navDisabled} />
        <div style={{ fontFamily: 'var(--font-racing)', fontWeight: 800, fontSize: 16 }}>RACE</div>
      </header>
      <div role="status" aria-live="polite" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'var(--text-muted)' }}>
        <div style={{ fontFamily: 'var(--font-racing)', fontWeight: 700, fontSize: 18, color: 'var(--text-secondary)' }}>Waiting for telemetry stream…</div>
      </div>
    </div>
  );
}
