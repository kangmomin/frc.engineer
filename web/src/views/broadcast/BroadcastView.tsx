import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { getTeamColor, getTeamName } from '../../constants/teamColors';
import { getTyreColor, getTyreShortLabel } from '../../constants/tyreCompounds';
import { NavTabs } from '../../shell/NavTabs';
import type { ShellControls } from '../../shell/types';
import { moveVsStart, useRaceMetaStore } from '../../store/raceMetaStore';
import { useTelemetryStore } from '../../store/telemetryStore';
import { formatLapTime } from '../../utils/formatters';
import { formatGapToLeader, formatInterval, getRaceStatus, getTrackCondition } from '../../utils/raceDisplay';
import { BroadcastHeader } from './BroadcastHeader';
import { FieldStatusPanel } from './FieldStatusPanel';
import { IssueFeedPanel, type IssueItem } from './IssueFeedPanel';
import { LiveBattlesPanel, type BattleCard } from './LiveBattlesPanel';
import { RunningOrderPanel, type OrderRow } from './RunningOrderPanel';
import { StrategyPanel } from './StrategyPanel';
import { WeatherPanel, type WeatherVM } from './WeatherPanel';
import { deriveDriverCodes } from './derive/driverCodes';
import {
  classifyIssue,
  deriveDriverIssue,
  deriveFastestLap,
  deriveFieldStatus,
  deriveLapCounter,
  deriveRainRisk,
} from './derive/fieldDerivations';
import { deriveStrategyBoard } from './derive/strategyBoard';
import { useBattleEngine } from './useBattleEngine';

function timeTag(ts: number): string {
  try {
    return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ts));
  } catch {
    return '·';
  }
}

function shortCode(name: string): string {
  const parts = name.trim().split(/\s+/);
  const base = (parts[parts.length - 1] || name).replace(/[^\p{L}\p{N}]/gu, '');
  return base.slice(0, 3).toUpperCase() || '—';
}

export function BroadcastView({ controls }: { controls: ShellControls }) {
  const { pitwallState, notifications } = useTelemetryStore(
    useShallow((s) => ({ pitwallState: s.pitwallState, notifications: s.raceControlNotifications })),
  );
  const { grid, gridStatus, epoch, firstSeenLap, notificationLaps } = useRaceMetaStore(
    useShallow((s) => ({
      grid: s.grid,
      gridStatus: s.gridStatus,
      epoch: s.epoch,
      firstSeenLap: s.firstSeenLap,
      notificationLaps: s.notificationLaps,
    })),
  );

  const session = pitwallState?.session ?? null;
  const sessionType = session?.sessionType ?? '';
  const is2026 = pitwallState?.gameFormat === 2026;
  const drivers = useMemo(
    () => [...(pitwallState?.drivers ?? [])].sort((a, b) => a.position - b.position),
    [pitwallState?.drivers],
  );
  const sessionKey = `${session?.trackId ?? ''}|${sessionType}|${session?.totalLaps ?? ''}`;

  const codes = useMemo(() => deriveDriverCodes(drivers), [drivers]);
  const battles = useBattleEngine(drivers, sessionKey, epoch, is2026, session?.safetyCar);

  // ── 게이트 (모든 hook 이후) ──
  if (!pitwallState || drivers.length === 0) {
    return <BroadcastEmpty controls={controls} message="Waiting for telemetry stream…" />;
  }
  if (!/^Race/i.test(sessionType)) {
    return <BroadcastEmpty controls={controls} message="World Feed is available during race sessions" sub={sessionType || undefined} />;
  }

  // ── 순수 파생 ──
  const fieldStatus = deriveFieldStatus(drivers);
  const lapCounter = deriveLapCounter(drivers, session);
  const raceStatus = getRaceStatus(session);
  const strategy = deriveStrategyBoard(pitwallState);
  const rainRisk = deriveRainRisk(session);
  const fl = deriveFastestLap(drivers);
  const fastest = fl ? { code: codes.get(fl.driverIndex) ?? '—', time: formatLapTime(fl.timeMs) } : null;

  // ── VM 조립 ──
  const leader = drivers[0];
  const runningOrderDetail =
    gridStatus === 'unavailable'
      ? `grid unknown · joined lap ${firstSeenLap}`
      : leader
        ? `${codes.get(leader.index) ?? ''} leads`
        : '';

  const orderRows: OrderRow[] = drivers.map((d, i) => {
    const isLeader = d.position === 1;
    return {
      index: d.index,
      pos: String(d.position).padStart(2, '0'),
      posColor: isLeader ? 'var(--accent-lime)' : 'var(--text-muted)',
      move: moveVsStart(d.index, d.position, grid, gridStatus),
      code: codes.get(d.index) ?? `C${d.index}`,
      team: getTeamName(d.teamId),
      teamColor: getTeamColor(d.teamId),
      gapL: formatGapToLeader(d, isLeader),
      intv: formatInterval(d, isLeader),
      tyre: getTyreShortLabel(d.tireCompound),
      tyreColor: getTyreColor(d.tireCompound),
      age: d.tireAge,
      issue: deriveDriverIssue(d),
      rowBg: i % 2 ? 'rgba(255,255,255,.015)' : 'transparent',
    };
  });

  const driverByIndex = new Map(drivers.map((d) => [d.index, d]));
  const battleCards: BattleCard[] = battles.map((b) => {
    const atk = driverByIndex.get(b.attackerIndex);
    const def = driverByIndex.get(b.defenderIndex);
    const trendText =
      b.trend === 'closing' && b.ratePerLapMs != null
        ? `Closing ${(b.ratePerLapMs / 1000).toFixed(2)}s/lap`
        : b.trend === 'opening' && b.ratePerLapMs != null
          ? `Opening ${(Math.abs(b.ratePerLapMs) / 1000).toFixed(2)}s/lap`
          : b.trend === 'stable'
            ? 'Gap stable'
            : 'Building read';
    return {
      key: b.key,
      posLabel: `P${b.forPosition}`,
      closing: b.trend === 'closing',
      trendText,
      atkCode: codes.get(b.attackerIndex) ?? '',
      atkTyre: getTyreShortLabel(atk?.tireCompound ?? ''),
      atkTyreColor: getTyreColor(atk?.tireCompound ?? ''),
      atkAge: atk?.tireAge ?? 0,
      atkColor: getTeamColor(atk?.teamId ?? 255),
      defCode: codes.get(b.defenderIndex) ?? '',
      defTyre: getTyreShortLabel(def?.tireCompound ?? ''),
      defTyreColor: getTyreColor(def?.tireCompound ?? ''),
      defAge: def?.tireAge ?? 0,
      defColor: getTeamColor(def?.teamId ?? 255),
      gap: `+${(b.gapMs / 1000).toFixed(2)}`,
      inRange: b.range.kind !== 'CHASE',
      rangeText: b.range.text,
      predict: b.predictionText,
      confidence: b.confidencePct,
    };
  });

  const nameToCode = new Map<string, string>();
  for (const d of drivers) {
    const c = codes.get(d.index);
    if (c && d.name) nameToCode.set(d.name, c);
  }
  const issues: IssueItem[] = notifications.slice(0, 10).map((n, idx) => ({
    id: n.id,
    lapTag: notificationLaps[n.id] != null ? `L${notificationLaps[n.id]}` : timeTag(n.timestamp),
    code: n.driverName ? nameToCode.get(n.driverName) ?? shortCode(n.driverName) : '—',
    text: n.message,
    colorKey: classifyIssue(n.message, n.severity),
    highlight: idx === 0,
  }));

  const cond = getTrackCondition(session?.weather ?? '');
  const weatherVM: WeatherVM = {
    weather: session?.weather ?? 'clear',
    condLabel: cond.label,
    trackTemp: session?.trackTemp ?? 0,
    airTemp: session?.airTemp ?? 0,
    rain: rainRisk,
    iconColor: cond.tone === 'mixed' ? 'var(--accent-soft)' : 'var(--accent)',
  };

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', padding: 16, gap: 11 }}>
      <BroadcastHeader
        controls={controls}
        gpTitle={(session?.trackName ?? '').toUpperCase() || 'GRAND PRIX'}
        gpSubtitle={`Broadcast Feed · ${sessionType}`}
        lap={lapCounter}
        fastest={fastest}
        activeVersion={is2026 ? 26 : 25}
        status={raceStatus}
      />
      <main style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '376px minmax(0,1fr) 366px', gap: 11 }}>
        <RunningOrderPanel rows={orderRows} detail={runningOrderDetail} />
        <section style={{ minHeight: 0, display: 'flex', flexDirection: 'column', gap: 11 }}>
          <LiveBattlesPanel cards={battleCards} detail={`${battleCards.length} on track`} />
          <StrategyPanel strategy={strategy} />
        </section>
        <aside style={{ minHeight: 0, display: 'flex', flexDirection: 'column', gap: 11 }}>
          <IssueFeedPanel items={issues} />
          <FieldStatusPanel field={fieldStatus} />
          <WeatherPanel weather={weatherVM} />
        </aside>
      </main>
    </div>
  );
}

function BroadcastEmpty({ controls, message, sub }: { controls: ShellControls; message: string; sub?: string }) {
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', padding: 16, gap: 11 }}>
      <header style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 14, background: 'var(--bg-panel)', border: '1px solid var(--bg-panel-border)', borderRadius: 'var(--radius-lg)', padding: '11px 18px', boxShadow: 'var(--shadow-panel)' }}>
        <NavTabs active={controls.view} onNavigate={controls.onNavigate} disabled={controls.navDisabled} />
        <div style={{ fontFamily: 'var(--font-racing)', fontWeight: 800, fontSize: 16 }}>WORLD FEED</div>
      </header>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'var(--text-muted)' }}>
        <div style={{ fontFamily: 'var(--font-racing)', fontWeight: 700, fontSize: 18, color: 'var(--text-secondary)' }}>{message}</div>
        {sub ? <div style={{ fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase' }}>Current session · {sub}</div> : null}
      </div>
    </div>
  );
}
