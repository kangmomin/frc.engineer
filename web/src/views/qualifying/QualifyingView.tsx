import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { getQualifyingBestLapTime, sortQualifyingDrivers } from '../../components/qualifying/leaderboardOrder';
import { evaluateDriverTryState, type DriverTryState } from '../../components/qualifying/tryStatus';
import { useQualifyingState } from '../../hooks/useQualifyingState';
import { useTrackGaps } from '../../hooks/useTrackGaps';
import { NavTabs } from '../../shell/NavTabs';
import type { ShellControls } from '../../shell/types';
import { useRaceMetaStore } from '../../store/raceMetaStore';
import { useTelemetryStore } from '../../store/telemetryStore';
import { deriveDriverCodes } from '../../utils/driverCodes';
import { getRaceStatus } from '../../utils/raceDisplay';
import { deriveWeather } from '../pitwall/derive/weather';
import { WeatherPanel } from '../pitwall/WeatherPanel';
import { ClassificationPanel } from './ClassificationPanel';
import { CutoffWatchPanel } from './CutoffWatchPanel';
import { deriveClassificationRows } from './derive/classificationRows';
import { deriveCutoffWatch } from './derive/cutoffWatch';
import { deriveMyLap } from './derive/myLap';
import { deriveQualiSegment } from './derive/qualiSegment';
import { MyLapPanel } from './MyLapPanel';
import { QualifyingHeader } from './QualifyingHeader';
import { buildTryBaseline, computeOverallBestSectors, useSectorAccumulator } from './useSectorAccumulator';

const QUALI_SESSION_RE = /^(Q[1-3]|Short Q|OSQ|SS[1-3]|Short SS|OSS)$/i;
const DEFAULT_WEATHER_STEP = 5;

export interface QualifyingViewProps {
  controls: ShellControls;
}

/**
 * Qualifying 뷰 유일 stateful 컨테이너(Phase3 Spec §1/§7). Broadcast/PitWall과 동일 패턴 —
 * positions(60Hz)는 구독하지 않고 drivers/session/playerIndex/gameFormat 슬라이스만
 * useShallow로 구독한다. 재사용 도메인 모듈(leaderboardOrder/tryStatus/hooks)과 lift한
 * useSectorAccumulator를 조합해 각 패널의 VM을 조립한다.
 */
export function QualifyingView({ controls }: QualifyingViewProps) {
  const { driversRaw, session, playerIndex, gameFormat } = useTelemetryStore(
    useShallow((s) => ({
      driversRaw: s.pitwallState?.drivers,
      session: s.pitwallState?.session ?? null,
      playerIndex: s.pitwallState?.playerIndex ?? -1,
      gameFormat: s.pitwallState?.gameFormat,
    })),
  );

  const allDrivers = useMemo(() => driversRaw ?? [], [driversRaw]);
  const player = useMemo(() => allDrivers.find((d) => d.index === playerIndex) ?? null, [allDrivers, playerIndex]);
  const is2026 = gameFormat === 2026;
  const sessionType = session?.sessionType ?? '';
  const isQualifying = QUALI_SESSION_RE.test(sessionType);
  const trackLength = session?.trackLength ?? 0;

  const [weatherStep, setWeatherStep] = useState(DEFAULT_WEATHER_STEP);

  // ── 재사용 도메인 모듈 + lift 누적기(모두 게이트 이전 — session=null/drivers=[]에 안전) ──
  const sortedDrivers = useMemo(() => sortQualifyingDrivers(allDrivers, sessionType), [allDrivers, sessionType]);
  // 세션 리스타트/리플레이 rewind 시 누적기 리셋 키로 쓰이는 epoch (raceMetaStore).
  const epoch = useRaceMetaStore((s) => s.epoch);
  const accMap = useSectorAccumulator(allDrivers, session, epoch);
  const qualiState = useQualifyingState(player, player?.lapInvalid ?? false, isQualifying);
  const trackGap = useTrackGaps(allDrivers, trackLength, playerIndex);

  const overallBest = useMemo(() => computeOverallBestSectors(accMap), [accMap]);
  const tryMap = useMemo(() => {
    const next = new Map<number, DriverTryState>();
    for (const driver of allDrivers) {
      next.set(driver.index, evaluateDriverTryState(driver, buildTryBaseline(driver, accMap.get(driver.index))));
    }
    return next;
  }, [accMap, allDrivers]);
  const codes = useMemo(() => deriveDriverCodes(allDrivers), [allDrivers]);
  const segment = useMemo(() => deriveQualiSegment(sessionType), [sessionType]);
  const playerAcc = player ? accMap.get(player.index) : undefined;
  const leaderBest = getQualifyingBestLapTime(sortedDrivers[0]);

  const rows = useMemo(
    () => deriveClassificationRows(sortedDrivers, accMap, tryMap, overallBest, segment, player, leaderBest, codes),
    [sortedDrivers, accMap, tryMap, overallBest, segment, player, leaderBest, codes],
  );
  const myLap = useMemo(
    () => deriveMyLap(player, playerAcc, tryMap, trackGap, session, codes, qualiState),
    [player, playerAcc, tryMap, trackGap, session, codes, qualiState],
  );
  const cutoffWatch = useMemo(
    () => deriveCutoffWatch(player, sortedDrivers, segment, session?.sessionTimeLeft, codes),
    [player, sortedDrivers, segment, session?.sessionTimeLeft, codes],
  );
  const weather = useMemo(() => deriveWeather(session, weatherStep), [session, weatherStep]);

  // ── 게이트(모든 hook 이후, Broadcast/PitWall과 동일 원칙) ──
  if (!session || allDrivers.length === 0) {
    return <QualifyingEmpty controls={controls} message="Waiting for telemetry stream…" />;
  }
  if (!isQualifying) {
    return (
      <QualifyingEmpty
        controls={controls}
        message="Qualifying view is available during qualifying sessions"
        sub={sessionType || undefined}
      />
    );
  }

  // ── 순수 파생(메모이즈 대상 아님 — 저비용) ──
  const raceStatus = getRaceStatus(session);
  const cutoffLabel = `${segment.segment} CUTOFF`;

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', padding: 16, gap: 11 }}>
      <QualifyingHeader
        controls={controls}
        gpTitle={(session.trackName ?? '').toUpperCase() || 'GRAND PRIX'}
        sessionType={sessionType}
        segment={segment}
        sessionTimeLeft={session.sessionTimeLeft}
        weather={{
          weather: weather.weather,
          condLabel: weather.condLabel,
          trackTemp: weather.trackTemp,
          airTemp: weather.airTemp,
          iconColor: weather.iconColor,
        }}
        status={raceStatus}
        is2026={is2026}
      />
      <main style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 312px', gap: 11 }}>
        <ClassificationPanel rows={rows} detail={`${segment.segment} · ${allDrivers.length} cars`} cutoffLabel={cutoffLabel} />
        <aside style={{ minHeight: 0, display: 'flex', flexDirection: 'column', gap: 9, overflowY: 'auto' }}>
          <MyLapPanel lap={myLap} detail={player ? player.name : '—'} />
          <CutoffWatchPanel cutoff={cutoffWatch} detail={segment.segment} />
          <WeatherPanel weather={weather} weatherStep={weatherStep} onStepChange={setWeatherStep} />
        </aside>
      </main>
    </div>
  );
}

function QualifyingEmpty({ controls, message, sub }: { controls: ShellControls; message: string; sub?: string }) {
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', padding: 16, gap: 11 }}>
      <header style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 14, background: 'var(--bg-panel)', border: '1px solid var(--bg-panel-border)', borderRadius: 'var(--radius-lg)', padding: '11px 18px', boxShadow: 'var(--shadow-panel)' }}>
        <NavTabs active={controls.view} onNavigate={controls.onNavigate} disabled={controls.navDisabled} />
        <div style={{ fontFamily: 'var(--font-racing)', fontWeight: 800, fontSize: 16 }}>QUALI</div>
      </header>
      <div role="status" aria-live="polite" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'var(--text-muted)' }}>
        <div style={{ fontFamily: 'var(--font-racing)', fontWeight: 700, fontSize: 18, color: 'var(--text-secondary)' }}>{message}</div>
        {sub ? <div style={{ fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase' }}>Current session · {sub}</div> : null}
      </div>
    </div>
  );
}
