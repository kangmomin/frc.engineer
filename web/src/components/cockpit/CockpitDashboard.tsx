import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { getTeamColor } from '../../constants/teamColors';
import { getTyreColor, getTyreShortLabel, getWearStatusColor } from '../../constants/tyreCompounds';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import { useTelemetryStore } from '../../store/telemetryStore';
import type {
  ConnectionState,
  DriverInfo,
  RaceControlNotification,
  SessionInfo,
  StrategyGuideResponse,
  StrategyRacePlan,
  TireWearDisplayMode,
  WeatherForecast,
} from '../../types/telemetry';
import { getConnectionDetail, getConnectionLabel } from '../../utils/connectionStatus';
import { clamp, formatDelta, formatLapTime } from '../../utils/formatters';
import styles from './CockpitDashboard.module.css';

const WHEEL_LABELS = ['FL', 'FR', 'RL', 'RR'] as const;
const DEFAULT_PREDICTION_LAPS = 10;
const SECTOR_LABELS = ['S1', 'S2', 'S3'] as const;

interface PitSettings {
  pitRepeatSpeed: number;
  pitStopTime: number;
  optimalTempLow: number;
  optimalTempHigh: number;
}

const DEFAULT_PIT_SETTINGS: PitSettings = {
  pitRepeatSpeed: 80,
  pitStopTime: 25,
  optimalTempLow: 95,
  optimalTempHigh: 110,
};

const LEADERBOARD_COLUMN_ORDER: LeaderboardColumnKey[] = [
  'drs',
  'ers',
  'gap',
  'interval',
  'lastLap',
  'penalty',
  'tyre',
  'pit',
  'vmax',
  'sector',
  'damage',
];

const DEFAULT_LEADERBOARD_COLUMNS: LeaderboardColumnVisibility = {
  drs: true,
  ers: true,
  gap: true,
  interval: true,
  lastLap: true,
  penalty: true,
  tyre: true,
  pit: true,
  vmax: true,
  sector: true,
  damage: true,
};

const DEFAULT_LEADERBOARD_COLUMN_WIDTHS: LeaderboardColumnWidths = {
  position: 52,
  driver: 150,
  drs: 56,
  ers: 72,
  gap: 92,
  interval: 72,
  lastLap: 88,
  penalty: 80,
  tyre: 100,
  pit: 56,
  vmax: 60,
  sector: 200,
  damage: 128,
};

const LEADERBOARD_COLUMN_MIN_WIDTHS: LeaderboardColumnWidths = {
  position: 44,
  driver: 120,
  drs: 44,
  ers: 60,
  gap: 72,
  interval: 60,
  lastLap: 78,
  penalty: 64,
  tyre: 84,
  pit: 48,
  vmax: 52,
  sector: 140,
  damage: 96,
};

function parseLeaderboardColumnVisibility(parsed: unknown): LeaderboardColumnVisibility | null {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  const source = parsed as Record<string, unknown>;
  const next = { ...DEFAULT_LEADERBOARD_COLUMNS };
  for (const key of LEADERBOARD_COLUMN_ORDER) {
    if (typeof source[key] === 'boolean') {
      next[key] = source[key] as boolean;
    }
  }
  return next;
}

function parseLeaderboardColumnWidths(parsed: unknown): LeaderboardColumnWidths | null {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  const source = parsed as Record<string, unknown>;
  const next = { ...DEFAULT_LEADERBOARD_COLUMN_WIDTHS };
  const keys = ['position', 'driver', ...LEADERBOARD_COLUMN_ORDER] as LeaderboardGridColumnKey[];
  for (const key of keys) {
    if (typeof source[key] !== 'number' || !Number.isFinite(source[key])) {
      continue;
    }
    next[key] = Math.round(
      clamp(source[key] as number, LEADERBOARD_COLUMN_MIN_WIDTHS[key], 420),
    );
  }
  return next;
}

function buildLeaderboardGridTemplate(
  visibleColumns: LeaderboardGridColumnKey[],
  widths: LeaderboardColumnWidths,
): string {
  return visibleColumns.map((key) => `${widths[key]}px`).join(' ');
}

function readPitSettingsFromQuery(): PitSettings {
  const params = new URLSearchParams(window.location.search);
  const speed = Number(params.get('pitRepeatSpeed'));
  const time = Number(params.get('pitStopTime'));
  const tempLow = Number(params.get('optimalTempLow'));
  const tempHigh = Number(params.get('optimalTempHigh'));
  return {
    pitRepeatSpeed: speed > 0 ? speed : DEFAULT_PIT_SETTINGS.pitRepeatSpeed,
    pitStopTime: time > 0 ? time : DEFAULT_PIT_SETTINGS.pitStopTime,
    optimalTempLow: tempLow > 0 ? tempLow : DEFAULT_PIT_SETTINGS.optimalTempLow,
    optimalTempHigh: tempHigh > 0 ? tempHigh : DEFAULT_PIT_SETTINGS.optimalTempHigh,
  };
}

function writePitSettingsToQuery(settings: PitSettings) {
  const params = new URLSearchParams(window.location.search);
  params.set('pitRepeatSpeed', String(settings.pitRepeatSpeed));
  params.set('pitStopTime', String(settings.pitStopTime));
  params.set('optimalTempLow', String(settings.optimalTempLow));
  params.set('optimalTempHigh', String(settings.optimalTempHigh));
  const nextQuery = params.toString();
  window.history.replaceState(null, '', `${window.location.pathname}?${nextQuery}`);
}

type SectorTimes = [number, number, number];
type SectorDeltaTone = 'sectorPending' | 'sectorBest' | 'sectorGood' | 'sectorSlow';
type StrategyWindowStatus = 'open' | 'soon' | 'complete';
type LeaderboardColumnKey =
  | 'drs'
  | 'ers'
  | 'gap'
  | 'interval'
  | 'lastLap'
  | 'penalty'
  | 'tyre'
  | 'pit'
  | 'vmax'
  | 'sector'
  | 'damage';
type LeaderboardGridColumnKey = 'position' | 'driver' | LeaderboardColumnKey;
type LeaderboardColumnVisibility = Record<LeaderboardColumnKey, boolean>;
type LeaderboardColumnWidths = Record<LeaderboardGridColumnKey, number>;

interface PrevSectorSnapshot {
  currentLapNum: number;
  lastLapTime: number;
  sector1TimeMs: number;
  sector2TimeMs: number;
}

interface DriverSectorHistory {
  latestLapNum: number;
  latestSectorTimes: SectorTimes;
  previousSectorTimes: SectorTimes;
}

type StrategyPanelData = {
  guideActive: boolean;
  titleDetail?: string;
  targetTyre: string;
  targetTyreReason?: string;
  pitWindowLabel: string;
  pitWindowTone: 'primary' | 'secondary' | 'tertiary' | 'neutral';
  primaryMetric: {
    label: string;
    value: string;
    tone: 'primary' | 'secondary' | 'tertiary' | 'neutral';
  };
  detailLabel: string;
  detailValue: string;
  detailMeta: string;
  meter: number;
  notes?: string;
};

interface CockpitDashboardProps {
  onOpenSettings: () => void;
  showSettingsButton: boolean;
  remoteAction?: {
    label: string;
    onClick: () => void;
    active?: boolean;
  };
  onSwitchToQualifying?: () => void;
  onSwitchToRaces?: () => void;
  onGoHome?: () => void;
}

export function CockpitDashboard({
  onOpenSettings,
  showSettingsButton,
  remoteAction,
  onSwitchToQualifying,
  onSwitchToRaces,
  onGoHome,
}: CockpitDashboardProps) {
  const headerScrollRef = useRef<HTMLDivElement>(null);
  const bodyScrollRef = useRef<HTMLDivElement>(null);
  const syncScrollRef = useRef<'header' | 'body' | null>(null);
  const {
    pitwallState,
    raceControlNotifications,
    connectionState,
    playbackActive,
    featurePermissions,
  } = useTelemetryStore(
    useShallow((state) => ({
      pitwallState: state.pitwallState,
      raceControlNotifications: state.raceControlNotifications,
      connectionState: state.connectionState,
      playbackActive: state.playbackActive,
      featurePermissions: state.featurePermissions,
    })),
  );

  const [pitSettings, setPitSettings] = useState<PitSettings>(readPitSettingsFromQuery);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const applyPitSettings = useCallback((next: PitSettings) => {
    setPitSettings(next);
    writePitSettingsToQuery(next);
    setSettingsOpen(false);
  }, []);

  const session = pitwallState?.session ?? null;
  const playerIndex = pitwallState?.playerIndex ?? -1;
  const ersVisible = featurePermissions.viewERSActual;
  const ersEstimateVisible = pitwallState?.ersEstimateEnabled ?? false;
  const ersComparisonEnabled = ersVisible && ersEstimateVisible && (pitwallState?.ersComparisonEnabled ?? false);
  const pitStatusVisible = featurePermissions.viewPitStatus;
  const topSpeedVisible = featurePermissions.viewTopSpeed;
  const playerDeltaVisible = featurePermissions.viewPlayerDelta;

  const drivers = useMemo(
    () => [...(pitwallState?.drivers ?? [])].sort((a, b) => a.position - b.position),
    [pitwallState?.drivers],
  );

  const player = useMemo(
    () => drivers.find((driver) => driver.index === playerIndex) ?? null,
    [drivers, playerIndex],
  );
  const sectorHistoryMap = useCompletedSectorHistory(drivers, session);

  const carAhead = useMemo(() => {
    if (!player) return null;
    return drivers.find((driver) => driver.position === player.position - 1) ?? null;
  }, [drivers, player]);
  const carBehind = useMemo(() => {
    if (!player) return null;
    return drivers.find((driver) => driver.position === player.position + 1) ?? null;
  }, [drivers, player]);
  const topForecasts = session?.weatherForecast ?? [];
  const recentNotifications = raceControlNotifications.slice(0, 3);
  const raceStatus = getRaceStatus(session, recentNotifications);
  const sessionTrackId = session?.trackId ?? null;
  const sessionTrackName = session?.trackName ?? '';
  const ersActualReady = player?.ersActualReady ?? false;
  const ersPct = clamp(player?.ersActualPct ?? 0, 0, 100);
  const deploySplit = getErsSplit(player);
  const fuelMargin = getFuelMargin(player, session);
  const wheelCoreTemp = normalizeWheelData(player?.tireInnerTemp);
  const wheelWear = normalizeWheelData(player?.tireWear);
  const averageWear = wheelWear.reduce((sum, value) => sum + value, 0) / WHEEL_LABELS.length;
  const averageWearPerLap = player?.tireAge ? averageWear / Math.max(player.tireAge, 1) : 0;
  const [wearDisplayMode] = useLocalStorage<TireWearDisplayMode>(
    'tireWearDisplayMode',
    'absolute',
    (v) => (v === 'absolute' || v === 'relative' ? v : null),
  );
  const [leaderboardColumns, setLeaderboardColumns] = useLocalStorage<LeaderboardColumnVisibility>(
    'pitwallLeaderboardColumns',
    DEFAULT_LEADERBOARD_COLUMNS,
    parseLeaderboardColumnVisibility,
  );
  const [leaderboardColumnWidths, setLeaderboardColumnWidths] = useLocalStorage<LeaderboardColumnWidths>(
    'pitwallLeaderboardColumnWidths',
    DEFAULT_LEADERBOARD_COLUMN_WIDTHS,
    parseLeaderboardColumnWidths,
  );
  const [predictionLaps, setPredictionLaps] = useState(DEFAULT_PREDICTION_LAPS);
  const [strategyGuide, setStrategyGuide] = useState<StrategyGuideResponse | null>(null);
  const [strategyGuideLoading, setStrategyGuideLoading] = useState(false);
  const tireAge = Math.max(player?.tireAge ?? 0, 1);
  const wheelWearPrediction = wheelWear.map((wear) => {
    const wearPerLap = player?.tireAge ? wear / tireAge : 0;
    const delta = wearPerLap * predictionLaps;
    const absolute = Math.min(wear + delta, 100);
    return { delta: Math.round(delta), absolute: Math.round(absolute) };
  });
  const pitWindow = getPitWindow(session, player);
  const recommendedTyre = getRecommendedTyre(player, session);
  const trafficStatus = getTrafficStatus(carBehind);
  const gapColumnLabel = playerDeltaVisible ? 'To You' : 'Gap';
  const tyreColumnLabel = featurePermissions.viewAdvancedStrategy ? 'Tyre / Life' : 'Tyre Age';
  const leaderboardColumnOptions = useMemo(
    () => [
      { key: 'drs' as const, label: 'DRS' },
      { key: 'ers' as const, label: 'ERS' },
      { key: 'gap' as const, label: gapColumnLabel },
      { key: 'interval' as const, label: 'Interval' },
      { key: 'lastLap' as const, label: 'Last Lap' },
      { key: 'penalty' as const, label: 'Pen' },
      { key: 'tyre' as const, label: tyreColumnLabel },
      { key: 'pit' as const, label: 'Pit' },
      { key: 'vmax' as const, label: 'Vmax' },
      { key: 'sector' as const, label: 'Sector' },
      { key: 'damage' as const, label: 'DMG' },
    ],
    [gapColumnLabel, tyreColumnLabel],
  );
  const visibleLeaderboardColumns = useMemo(
    () => LEADERBOARD_COLUMN_ORDER.filter((key) => leaderboardColumns[key]),
    [leaderboardColumns],
  );
  const renderedLeaderboardColumns = useMemo(
    () => [
      { key: 'position' as const, label: 'Pos' },
      { key: 'driver' as const, label: 'Driver' },
      ...visibleLeaderboardColumns.map((key) => ({
        key,
        label:
          key === 'gap'
            ? gapColumnLabel
            : key === 'tyre'
              ? tyreColumnLabel
              : key === 'lastLap'
                ? 'Last Lap'
                : key === 'penalty'
                  ? 'Pen'
                  : key === 'vmax'
                    ? 'Vmax'
                    : key === 'damage'
                      ? 'DMG'
                      : key === 'interval'
                        ? 'Interval'
                        : key === 'sector'
                          ? 'Sector'
                          : key === 'pit'
                            ? 'Pit'
                            : key.toUpperCase(),
      })),
    ],
    [gapColumnLabel, tyreColumnLabel, visibleLeaderboardColumns],
  );
  const visibleLeaderboardGridColumns = useMemo(
    () => renderedLeaderboardColumns.map((column) => column.key),
    [renderedLeaderboardColumns],
  );
  const leaderboardGridStyle = useMemo(
    (): CSSProperties => ({
      ['--leaderboard-columns-desktop' as string]: buildLeaderboardGridTemplate(
        visibleLeaderboardGridColumns,
        leaderboardColumnWidths,
      ),
      ['--leaderboard-columns-wide' as string]: buildLeaderboardGridTemplate(
        visibleLeaderboardGridColumns,
        leaderboardColumnWidths,
      ),
      ['--leaderboard-columns-tablet' as string]: buildLeaderboardGridTemplate(
        visibleLeaderboardGridColumns,
        leaderboardColumnWidths,
      ),
    }),
    [leaderboardColumnWidths, visibleLeaderboardGridColumns],
  );
  const toggleLeaderboardColumn = useCallback((key: LeaderboardColumnKey) => {
    setLeaderboardColumns((prev) => ({ ...prev, [key]: !prev[key] }));
  }, [setLeaderboardColumns]);
  const syncHeaderScroll = useCallback(() => {
    if (!headerScrollRef.current || !bodyScrollRef.current) return;
    if (syncScrollRef.current === 'header') return;
    syncScrollRef.current = 'body';
    bodyScrollRef.current.scrollLeft = headerScrollRef.current.scrollLeft;
    requestAnimationFrame(() => {
      syncScrollRef.current = null;
    });
  }, []);
  const syncBodyScroll = useCallback(() => {
    if (!headerScrollRef.current || !bodyScrollRef.current) return;
    if (syncScrollRef.current === 'body') return;
    syncScrollRef.current = 'header';
    headerScrollRef.current.scrollLeft = bodyScrollRef.current.scrollLeft;
    requestAnimationFrame(() => {
      syncScrollRef.current = null;
    });
  }, []);
  const startColumnResize = useCallback((
    event: React.PointerEvent<HTMLButtonElement>,
    index: number,
  ) => {
    const leftColumn = renderedLeaderboardColumns[index];
    const rightColumn = renderedLeaderboardColumns[index + 1];
    if (!leftColumn || !rightColumn) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const leftKey = leftColumn.key;
    const rightKey = rightColumn.key;
    const startLeftWidth = leaderboardColumnWidths[leftKey];
    const startRightWidth = leaderboardColumnWidths[rightKey];
    const minLeftWidth = LEADERBOARD_COLUMN_MIN_WIDTHS[leftKey];
    const minRightWidth = LEADERBOARD_COLUMN_MIN_WIDTHS[rightKey];
    const combinedWidth = startLeftWidth + startRightWidth;

    const originalUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = 'none';

    const handleMove = (moveEvent: PointerEvent) => {
      const rawNextLeftWidth = startLeftWidth + (moveEvent.clientX - startX);
      const nextLeftWidth = Math.round(clamp(rawNextLeftWidth, minLeftWidth, combinedWidth - minRightWidth));
      const nextRightWidth = combinedWidth - nextLeftWidth;
      setLeaderboardColumnWidths((prev) => {
        if (prev[leftKey] === nextLeftWidth && prev[rightKey] === nextRightWidth) {
          return prev;
        }
        return {
          ...prev,
          [leftKey]: nextLeftWidth,
          [rightKey]: nextRightWidth,
        };
      });
    };

    const clearResize = () => {
      document.body.style.userSelect = originalUserSelect;
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', clearResize);
      window.removeEventListener('pointercancel', clearResize);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', clearResize);
    window.addEventListener('pointercancel', clearResize);
  }, [leaderboardColumnWidths, renderedLeaderboardColumns, setLeaderboardColumnWidths]);
  const trainStatus = useMemo(() => getTrainStatus(drivers, player), [drivers, player]);
  const strategyPanel = useMemo(
    () => buildStrategyPanelData(player, session, strategyGuide, recommendedTyre, pitWindow, trafficStatus),
    [pitWindow, player, recommendedTyre, session, strategyGuide, trafficStatus],
  );
  const damageReadouts = [
    { label: 'Front Left', value: player?.damage?.frontLeftWing ?? 0 },
    { label: 'Front Right', value: player?.damage?.frontRightWing ?? 0 },
    { label: 'Floor', value: player?.damage?.floor ?? 0 },
    { label: 'Diffuser', value: player?.damage?.diffuser ?? 0 },
    { label: 'Sidepod', value: player?.damage?.sidepod ?? 0 },
    { label: 'Rear Wing', value: player?.damage?.rearWing ?? 0 },
  ];

  useEffect(() => {
    if (!featurePermissions.viewAdvancedStrategy || sessionTrackId == null || sessionTrackId < 0) {
      setStrategyGuide(null);
      setStrategyGuideLoading(false);
      return;
    }

    let cancelled = false;
    setStrategyGuideLoading(true);

    const params = new URLSearchParams({ trackId: String(sessionTrackId) });
    if (sessionTrackName.trim()) {
      params.set('trackName', sessionTrackName);
    }

    fetch(`/api/strategy/guide?${params.toString()}`)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`strategy guide request failed: ${response.status}`);
        }
        const ct = response.headers.get('content-type') ?? '';
        if (!ct.includes('application/json')) {
          // Not a JSON endpoint (e.g. SPA fallback on remote deployment)
          throw new Error('not json');
        }
        return response.json() as Promise<StrategyGuideResponse>;
      })
      .then((data) => {
        if (!cancelled) {
          setStrategyGuide(data);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStrategyGuide(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setStrategyGuideLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [featurePermissions.viewAdvancedStrategy, sessionTrackId, sessionTrackName]);

  // Seed optimal temp from strategy guide peak_temps_c when available and no manual override in query
  useEffect(() => {
    if (!strategyGuide?.tyreTemps) return;
    const params = new URLSearchParams(window.location.search);
    if (params.has('optimalTempLow') || params.has('optimalTempHigh')) return;

    const compound = player?.tireCompound?.toLowerCase() ?? null;
    const guideTrack = strategyGuide.track;
    const tempKey = compound ? (guideTrack.tyre_strategy.compounds[compound] ?? compound) : null;
    const peakTemps = tempKey ? strategyGuide.tyreTemps.compounds[tempKey]?.peak_temps_c : undefined;
    if (!peakTemps || peakTemps.length === 0) return;

    const low = peakTemps[0];
    const high = peakTemps[peakTemps.length - 1];
    if (low === pitSettings.optimalTempLow && high === pitSettings.optimalTempHigh) return;

    const next: PitSettings = { ...pitSettings, optimalTempLow: low, optimalTempHigh: high };
    setPitSettings(next);
    writePitSettingsToQuery(next);
  }, [strategyGuide, player?.tireCompound]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!headerScrollRef.current || !bodyScrollRef.current) return;
    headerScrollRef.current.scrollLeft = bodyScrollRef.current.scrollLeft;
  }, [leaderboardGridStyle]);

  return (
    <div className={styles.dashboard}>
      <div className={styles.backdropGlow} />

      <div className={styles.utilityDock}>
        <button
          type="button"
          className={styles.settingsButton}
          onClick={openSettings}
          aria-label="Open pit settings"
        >
          <svg
            className={styles.settingsIcon}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </button>
        {showSettingsButton && (
          <button
            type="button"
            className={styles.settingsButton}
            onClick={onOpenSettings}
            aria-label="Open server settings"
          >
            <svg className={styles.settingsIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
          </button>
        )}
        {onSwitchToQualifying && (
          <button
            type="button"
            className={styles.remoteButton}
            onClick={onSwitchToQualifying}
            aria-label="Switch to qualifying"
          >
            Quali
          </button>
        )}
        {onSwitchToRaces && (
          <button
            type="button"
            className={`${styles.remoteButton} ${playbackActive ? styles.remoteActive : ''}`}
            onClick={onSwitchToRaces}
            aria-label="Open race archive"
          >
            Races
          </button>
        )}
        {remoteAction && (
          <button
            type="button"
            className={`${styles.remoteButton} ${remoteAction.active ? styles.remoteActive : ''}`}
            onClick={remoteAction.onClick}
            aria-label={remoteAction.label}
          >
            {remoteAction.label}
          </button>
        )}
        {playbackActive && <span className={`${styles.remoteButton} ${styles.remoteActive}`}>Replay</span>}
      </div>

      {settingsOpen && (
        <PitSettingsModal
          current={pitSettings}
          onApply={applyPitSettings}
          onClose={closeSettings}
        />
      )}

      <section className={styles.topRow}>
        <div className={styles.leaderboardShell}>
          <div className={styles.ribbonGrid}>
            <StatRibbon
              label="Lap"
              value={`${player?.currentLapNum ?? 0}/${session?.totalLaps ?? '--'}`}
              detail={session?.trackName ?? 'No Session'}
              tone="primary"
              className={styles.lapRibbon}
            />
            <StatRibbon
              label="Track Temp"
              value={session ? `${session.trackTemp.toFixed(1)}°C` : '--'}
              detail={session ? `Air ${session.airTemp.toFixed(1)}°C` : 'Telemetry Idle'}
              tone="tertiary"
            />
            <WeatherRibbon forecasts={topForecasts} />
            <TrackStatusRibbon session={session} connectionState={connectionState} />
          </div>

          <div className={`${styles.panel} ${styles.leaderboardPanel}`}>
            <div className={styles.leaderboardControls}>
              <span className={styles.leaderboardControlsLabel}>Leaderboard Fields</span>
              <div className={styles.leaderboardToggleGroup}>
                {leaderboardColumnOptions.map((option) => (
                  <label key={option.key} className={styles.leaderboardToggle}>
                    <input
                      type="checkbox"
                      checked={leaderboardColumns[option.key]}
                      onChange={() => toggleLeaderboardColumn(option.key)}
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>
            </div>
            <div
              ref={headerScrollRef}
              className={styles.tableHeaderViewport}
              onScroll={syncHeaderScroll}
            >
              <div
                className={styles.tableHeader}
                style={leaderboardGridStyle}
              >
                {renderedLeaderboardColumns.map((column, index) => (
                  <div key={column.key} className={styles.tableHeaderCell}>
                    <span className={styles.tableHeaderLabel}>{column.label}</span>
                    {index < renderedLeaderboardColumns.length - 1 && (
                      <button
                        type="button"
                        className={styles.columnResizeHandle}
                        aria-label={`Resize ${column.label} column`}
                        onPointerDown={(event) => startColumnResize(event, index)}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div ref={bodyScrollRef} className={styles.tableBodyViewport} onScroll={syncBodyScroll}>
              <div className={styles.tableBody}>
                {drivers.length === 0 && (
                  <div className={styles.emptyState}>
                    Waiting for telemetry stream...
                  </div>
                )}

                {drivers.map((driver) => {
                  const rowTone = getDriverRowTone(driver, player);
                  return (
                    <div
                      key={driver.index}
                      className={`${styles.tableRow} ${rowTone ? styles[rowTone] : ''}`}
                      style={leaderboardGridStyle}
                    >
                      <span className={styles.positionCell}>
                        {String(driver.position).padStart(2, '0')}
                      </span>
                      <span className={styles.driverCell}>
                        <span className={styles.teamBar} style={{ background: getTeamColor(driver.teamId) }} />
                        {driver.name.slice(0, 6)}
                        {driver.aiControlled && <span className={styles.driverBadge}>AI</span>}
                      </span>
                      {leaderboardColumns.drs && (
                        <span className={`${styles.drsCell} ${styles.mobileLabeledCell}`} data-mobile-label="DRS">
                          <span className={styles[getDrsTone(driver)]}>
                            DRS
                          </span>
                        </span>
                      )}
                      {leaderboardColumns.ers && (
                        <span
                          className={`${styles.ersCell} ${styles.mobileLabeledCell} ${ersComparisonEnabled ? styles.ersCellCompare : ''}`}
                          data-mobile-label="ERS"
                        >
                          {ersVisible ? (
                            <>
                              <span className={styles[getErsActualTone(driver)]}>{formatErsActual(driver)}</span>
                              {ersComparisonEnabled && (
                                <span className={styles.ersCompareMeta}>
                                  {formatErsCompare(driver)}
                                </span>
                              )}
                            </>
                          ) : (
                            <span className={styles.ersPending}>LOCK</span>
                          )}
                        </span>
                      )}
                      {leaderboardColumns.gap && (
                        <span
                          className={`${styles.referenceCell} ${styles.mobileLabeledCell} ${playerDeltaVisible ? styles.referenceGapPlayer : styles.referenceGapLeader}`}
                          data-mobile-label={gapColumnLabel}
                        >
                          {formatReferenceGap(driver, player, playerDeltaVisible)}
                        </span>
                      )}
                      {leaderboardColumns.interval && (
                        <span className={`${styles.intervalCell} ${styles.mobileLabeledCell}`} data-mobile-label="Interval">
                          {formatInterval(driver)}
                        </span>
                      )}
                      {leaderboardColumns.lastLap && (
                        <span className={`${styles.lastLapCell} ${styles.mobileLabeledCell}`} data-mobile-label="Last Lap">
                          {formatLapTime(driver.lastLapTime)}
                        </span>
                      )}
                      {leaderboardColumns.penalty && (
                        <PenaltyCell driver={driver} className={styles.mobileLabeledCell} mobileLabel="Pen" />
                      )}
                      {leaderboardColumns.tyre && (
                        <span className={`${styles.tyreCell} ${styles.mobileLabeledCell}`} data-mobile-label="Tyre">
                          {(driver.stintHistory ?? []).map((stint, si) => (
                            <span key={si} className={styles.stintDot} style={{ backgroundColor: getTyreColor(stint.compound) }} title={`${stint.compound} ${stint.laps}L`} />
                          ))}
                          <span
                            className={styles.tyreDot}
                            style={{ backgroundColor: getTyreColor(driver.tireCompound) }}
                          />
                          {driver.tireAge}
                          {featurePermissions.viewAdvancedStrategy && (
                            <span
                              className={styles.tyreLifeCell}
                              style={driver.tyreLifeSpan != null && driver.tyreUsableLife != null && driver.tyreUsableLife > 0
                                ? { color: getWearStatusColor(Math.round(((driver.tyreUsableLife - driver.tyreLifeSpan) / driver.tyreUsableLife) * 100)) }
                                : undefined}
                            >
                              {driver.tyreLifeSpan != null && driver.tyreUsableLife != null
                                ? `${driver.tyreLifeSpan}/${driver.tyreUsableLife}`
                                : '--'}
                            </span>
                          )}
                        </span>
                      )}
                      {leaderboardColumns.pit && (
                        <span className={`${styles.pitCell} ${styles.mobileLabeledCell}`} data-mobile-label="Pit">
                          <span className={styles[getPitStatusTone(driver, pitStatusVisible)]}>
                            {formatPitStatus(driver, pitStatusVisible)}
                          </span>
                        </span>
                      )}
                      {leaderboardColumns.vmax && (
                        <span className={`${styles.topSpeedCell} ${styles.mobileLabeledCell}`} data-mobile-label="Vmax">
                          <span className={styles[getTopSpeedTone(driver, topSpeedVisible)]}>
                            {formatTopSpeed(driver, topSpeedVisible)}
                          </span>
                        </span>
                      )}
                      {leaderboardColumns.sector && (
                        <SectorDeltaCell
                          sectorHistory={sectorHistoryMap.get(driver.index)}
                          className={styles.mobileLabeledCell}
                          mobileLabel="Sector"
                        />
                      )}
                      {leaderboardColumns.damage && (
                        <DamageSummaryCell
                          driver={driver}
                          className={styles.mobileLabeledCell}
                          mobileLabel="Damage"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className={styles.sideRail}>
        <div className={`${styles.panel} ${styles.combatPanel}`}>
          <PanelTitle title="Combat Command" tone="secondary" detail={player ? `P${player.position} Attack / Defend` : 'Racecraft Monitor'} />
          <BattleTarget
            label="Target Ahead"
            driver={carAhead}
            gapLabel={formatAheadGap(player)}
            paceLabel={formatBattlePace(player, carAhead, 'ahead')}
            tone="tertiary"
          />
          <div className={styles.progressCard}>
            <div className={styles.progressHeader}>
              <span>DRS Status</span>
              <span className={styles.progressStatus}>
                {getDrsWindowStatus(player)}
              </span>
            </div>
            <div className={styles.progressTrack}>
              <div
                className={styles.progressFill}
                style={{ width: `${getDrsProgress(player)}%` }}
              />
            </div>
            <div className={styles.progressFooter}>
              <span>{getDrsWindowLabel(player)}</span>
              <strong>{formatDrsWindow(player)}</strong>
            </div>
          </div>
          <BattleTarget
            label="Chaser Behind"
            driver={carBehind}
            gapLabel={formatBehindGap(carBehind)}
            paceLabel={formatBattlePace(player, carBehind, 'behind')}
            tone="secondary"
          />
        </div>
        <div className={`${styles.panel} ${styles.strategyPanel}`}>
          <PanelTitle title="Pit Strategy" tone="primary" detail={strategyPanel.titleDetail} />
          <div className={styles.strategyRow}>
            <span>Target Tyre</span>
            <strong style={{ color: getTyreColor(strategyPanel.targetTyre) }}>
              {strategyPanel.targetTyre.toUpperCase()} ({getTyreShortLabel(strategyPanel.targetTyre)})
            </strong>
          </div>
          {strategyPanel.targetTyreReason && (
            <span className={styles.strategySupportText}>{strategyPanel.targetTyreReason}</span>
          )}
          <div className={styles.metricGrid}>
            <MetricTile
              label={strategyPanel.primaryMetric.label}
              value={strategyPanel.primaryMetric.value}
              tone={strategyPanel.primaryMetric.tone}
            />
            <MetricTile
              label="Pit Window"
              value={strategyPanel.pitWindowLabel}
              tone={strategyPanel.pitWindowTone}
            />
            <MetricTile
              label="Pit Speed"
              value={`${pitSettings.pitRepeatSpeed} km/h`}
              tone="neutral"
            />
            <MetricTile
              label="Pit Stop"
              value={`${pitSettings.pitStopTime}s`}
              tone="neutral"
            />
          </div>
          <div className={styles.trafficCard}>
            <span className={styles.trafficLabel}>{strategyPanel.detailLabel}</span>
            <div className={styles.trafficValueRow}>
              <strong className={styles.trafficValue}>{strategyPanel.detailValue}</strong>
              <span>{strategyPanel.detailMeta}</span>
            </div>
            <div className={styles.trafficMeter}>
              <div
                className={styles.trafficMeterFill}
                style={{ width: `${strategyPanel.meter}%` }}
              />
            </div>
          </div>
          {trainStatus.trainSize >= 2 && (
            <div className={styles.trainCard}>
              <span className={styles.trafficLabel}>Train</span>
              <div className={styles.trainValueRow}>
                <strong
                  className={styles.trafficValue}
                  style={{ color: trainStatus.inTrain ? 'var(--accent-red)' : 'var(--text-secondary)' }}
                >
                  {trainStatus.trainSize} cars
                </strong>
                {trainStatus.inTrain && (
                  <span className={styles.trainStuck}>{'\u26A0'} STUCK</span>
                )}
              </div>
            </div>
          )}
          {strategyPanel.notes && (
            <div className={styles.strategyNotes}>{strategyPanel.notes}</div>
          )}
          {!featurePermissions.viewAdvancedStrategy ? (
            <div className={styles.strategyUnlockCard}>
              <span className={styles.strategyUnlockLabel}>Advanced Strategy Locked</span>
              <span className={styles.strategySupportText}>
                Join with a permissions code that grants advanced strategy access to use numeric track data here.
              </span>
            </div>
          ) : (
            <div className={styles.strategyUnlockMeta}>
              <span className={styles.strategyUnlockStatus}>
                {strategyGuideLoading
                  ? 'Loading strategy guide...'
                  : strategyPanel.guideActive
                    ? 'Numeric strategy guide active'
                    : 'Guide unavailable, using heuristic fallback'}
              </span>
              <span className={styles.strategySupportText}>Permission Granted</span>
            </div>
          )}
        </div>
      </div>

      <section className={styles.bottomRow}>
        <div className={`${styles.panel} ${styles.tyrePanel}`}>
          <PanelTitle
            title="Tyre Telemetry"
            tone="tertiary"
            detail={`AVG WEAR/LAP: ${averageWearPerLap.toFixed(1)}%`}
          />
          <div className={styles.tyreGrid}>
            {WHEEL_LABELS.map((label, index) => {
              const tempTone = getTemperatureTone(wheelCoreTemp[index], pitSettings.optimalTempLow, pitSettings.optimalTempHigh);
              const pred = wheelWearPrediction[index];
              const hasPrediction = player?.tireAge && player.tireAge > 0;
              const predLabel = hasPrediction
                ? wearDisplayMode === 'absolute'
                  ? `${pred.absolute}%`
                  : `+${pred.delta}%`
                : '--';
              const predColor = hasPrediction && wearDisplayMode === 'absolute'
                ? getWearStatusColor(pred.absolute)
                : undefined;
              return (
                <div key={label} className={styles.tyreCard}>
                  <span className={styles.tyreCardLabel}>{label}</span>
                  <div className={styles.tyreCardSplit}>
                    <div>
                      <strong>{Math.round(wheelCoreTemp[index])}°C</strong>
                      <span className={`${styles.tyreStatus} ${styles[tempTone]}`}>
                        {getTemperatureStatus(wheelCoreTemp[index], pitSettings.optimalTempLow, pitSettings.optimalTempHigh)}
                      </span>
                    </div>
                    <div className={styles.tyreWearMeta}>
                      <strong>{Math.round(wheelWear[index])}%</strong>
                      <span>Wear</span>
                      <span
                        className={styles.tyrePrediction}
                        style={predColor ? { color: predColor } : undefined}
                      >
                        {predictionLaps}L → {predLabel}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className={styles.footerStrip}>
            <div className={styles.predictionInput}>
              <label htmlFor="pred-laps">Predict after</label>
              <input
                id="pred-laps"
                className={styles.lapInput}
                type="number"
                min={1}
                max={99}
                value={predictionLaps}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (!isNaN(v) && v >= 1 && v <= 99) setPredictionLaps(v);
                }}
              />
              <span>laps</span>
            </div>
            <div className={styles.predictionSummary}>
              {WHEEL_LABELS.map((label, index) => {
                const pred = wheelWearPrediction[index];
                const hasPred = player?.tireAge && player.tireAge > 0;
                const text = hasPred
                  ? wearDisplayMode === 'absolute'
                    ? `${pred.absolute}%`
                    : `+${pred.delta}%`
                  : '--';
                const color = hasPred && wearDisplayMode === 'absolute'
                  ? getWearStatusColor(pred.absolute)
                  : undefined;
                return (
                  <span key={label} className={styles.predictionChip} style={color ? { color } : undefined}>
                    {label} {text}
                  </span>
                );
              })}
            </div>
          </div>
        </div>

        <div className={`${styles.panel} ${styles.energyPanel}`}>
          <PanelTitle title="Hybrid / Fuel Analysis" tone="primary" />
          <div className={styles.energyContent}>
            <div className={styles.energyDialColumn}>
              <div className={styles.ersDial}>
                <div
                  className={styles.ersDialRing}
                  style={{ ['--ring-fill' as string]: `${ersPct}%` }}
                />
                <div className={styles.ersDialCenter}>
                  <strong>{ersActualReady ? `${Math.round(ersPct)}%` : '--'}</strong>
                  <span>{ersActualReady ? getErsModeLabel(player) : '--'}</span>
                </div>
              </div>

              <div className={styles.splitPills}>
                <div className={styles.splitPill}>
                  <span>Deploy</span>
                  <strong>{ersActualReady ? `${deploySplit.deploy}%` : '--'}</strong>
                </div>
                <div className={styles.splitPill}>
                  <span>Harvest</span>
                  <strong>{ersActualReady ? `${deploySplit.harvest}%` : '--'}</strong>
                </div>
              </div>
            </div>

            <div className={styles.energyColumn}>
              <div className={styles.energyCompactGrid}>
                <MetricTile
                  label="Fuel Finish"
                  value={fuelMargin}
                  tone={fuelMargin.startsWith('-') ? 'secondary' : 'tertiary'}
                  className={styles.compactMetricTile}
                />
                <MetricTile
                  label="Brake Bias"
                  value={player?.brakeBias ? `${player.brakeBias.toFixed(1)}%` : '--'}
                  tone="tertiary"
                  className={styles.compactMetricTile}
                />
                <MetricTile
                  label="Diff On Throttle"
                  value={player?.diffOnThrottle ? `${player.diffOnThrottle}%` : '--'}
                  tone="primary"
                  className={styles.compactMetricTile}
                />
              </div>
            </div>
          </div>
        </div>

        <div className={`${styles.panel} ${styles.damagePanel}`}>
          <PanelTitle title="Damage Status" tone="secondary" />
          {damageReadouts.map((damage) => (
            <DamageMetric key={damage.label} label={damage.label} value={damage.value} />
          ))}
        </div>
      </section>

      {connectionState !== 'connected' && !playbackActive && (
        <div className={styles.connectionOverlay}>
          <div className={styles.connectionCard}>
            <div className={`${styles.connectionDot} ${styles[raceStatus.tone]}`} />
            <div>
              <strong>{getConnectionLabel(connectionState)}</strong>
              <span>{getConnectionDetail(connectionState)}</span>
            </div>
            {onGoHome && (
              <button type="button" className={styles.homeButton} onClick={onGoHome}>
                Home
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function PitSettingsModal({
  current,
  onApply,
  onClose,
}: {
  current: PitSettings;
  onApply: (s: PitSettings) => void;
  onClose: () => void;
}) {
  const speedRef = useRef<HTMLInputElement>(null);
  const timeRef = useRef<HTMLInputElement>(null);
  const tempLowRef = useRef<HTMLInputElement>(null);
  const tempHighRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    speedRef.current?.focus();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const speed = Number(speedRef.current?.value);
    const time = Number(timeRef.current?.value);
    const tempLow = Number(tempLowRef.current?.value);
    const tempHigh = Number(tempHighRef.current?.value);
    onApply({
      pitRepeatSpeed: speed > 0 ? speed : current.pitRepeatSpeed,
      pitStopTime: time > 0 ? time : current.pitStopTime,
      optimalTempLow: tempLow > 0 ? tempLow : current.optimalTempLow,
      optimalTempHigh: tempHigh > 0 ? Math.max(tempHigh, tempLow) : current.optimalTempHigh,
    });
  };

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <form
        className={styles.modalPanel}
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <div className={styles.modalHeader}>
          <span className={styles.modalTitle}>Pit &amp; Tyre Settings</span>
          <button type="button" className={styles.modalClose} onClick={onClose}>
            &times;
          </button>
        </div>

        <div className={styles.modalField}>
          <label className={styles.modalFieldLabel} htmlFor="pit-repeat-speed">
            Pit Repeat Speed (km/h)
          </label>
          <input
            id="pit-repeat-speed"
            ref={speedRef}
            className={styles.modalInput}
            type="number"
            min={1}
            max={200}
            step={1}
            defaultValue={current.pitRepeatSpeed}
            placeholder="80"
          />
          <span className={styles.modalFieldHint}>
            Pit lane speed limit for the current track
          </span>
        </div>

        <div className={styles.modalField}>
          <label className={styles.modalFieldLabel} htmlFor="pit-stop-time">
            Pit Stop Time (sec)
          </label>
          <input
            id="pit-stop-time"
            ref={timeRef}
            className={styles.modalInput}
            type="number"
            min={0.1}
            max={120}
            step={0.1}
            defaultValue={current.pitStopTime}
            placeholder="25"
          />
          <span className={styles.modalFieldHint}>
            Expected stationary pit stop duration
          </span>
        </div>

        <div className={styles.modalFieldRow}>
          <div className={styles.modalField}>
            <label className={styles.modalFieldLabel} htmlFor="optimal-temp-low">
              Optimal Temp Low (&deg;C)
            </label>
            <input
              id="optimal-temp-low"
              ref={tempLowRef}
              className={styles.modalInput}
              type="number"
              min={30}
              max={200}
              step={1}
              defaultValue={current.optimalTempLow}
              placeholder="95"
            />
          </div>
          <div className={styles.modalField}>
            <label className={styles.modalFieldLabel} htmlFor="optimal-temp-high">
              Optimal Temp High (&deg;C)
            </label>
            <input
              id="optimal-temp-high"
              ref={tempHighRef}
              className={styles.modalInput}
              type="number"
              min={30}
              max={200}
              step={1}
              defaultValue={current.optimalTempHigh}
              placeholder="110"
            />
          </div>
        </div>
        <span className={styles.modalFieldHint}>
          Core temperature range for &quot;CORE OK&quot; status. Auto-filled from strategy guide when available.
        </span>

        <button type="submit" className={styles.modalApply}>
          Apply
        </button>
      </form>
    </div>
  );
}

function StatRibbon({
  label,
  value,
  detail,
  tone,
  className,
}: {
  label: string;
  value: string;
  detail: string;
  tone: 'primary' | 'tertiary' | 'secondary' | 'neutral';
  className?: string;
}) {
  return (
    <div className={className ? `${styles.ribbonCard} ${styles[tone]} ${className}` : `${styles.ribbonCard} ${styles[tone]}`}>
      <div className={styles.ribbonLabel}>{label}</div>
      <strong>{value}</strong>
      <span>{detail}</span>
    </div>
  );
}

function WeatherRibbon({ forecasts }: { forecasts: WeatherForecast[] }) {
  const receivedAtRef = useRef(Date.now());
  const lastOffsetsRef = useRef('');
  const [, tick] = useState(0);

  // Detect when game updates forecast offsets -> reset timer
  const currentOffsets = forecasts.map((f) => f.timeOffset).join(',');
  if (currentOffsets !== lastOffsetsRef.current) {
    lastOffsetsRef.current = currentOffsets;
    receivedAtRef.current = Date.now();
  }

  // Re-render every second for countdown
  useEffect(() => {
    const id = setInterval(() => tick((c) => c + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const elapsedMin = (Date.now() - receivedAtRef.current) / 60_000;

  return (
    <div className={`${styles.ribbonCard} ${styles.neutral} ${styles.weatherRibbon}`}>
      <div className={styles.weatherRibbonHeader}>
        <div className={styles.ribbonLabel}>Weather</div>
      </div>
      <div className={styles.weatherRibbonSlots}>
        {forecasts.length === 0 ? (
          <div className={styles.weatherRibbonEmpty}>Forecast pending</div>
        ) : (
          forecasts.map((forecast) => (
            <div key={forecast.timeOffset} className={styles.weatherRibbonSlot}>
              <span className={styles.weatherRibbonTime}>
                {formatForecastLabel(forecast.timeOffset - elapsedMin)}
              </span>
              <div className={styles.weatherRibbonIcon}>
                <WeatherIcon weather={forecast.weather} />
              </div>
              <strong>{forecast.rainPercentage}%</strong>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function WeatherIcon({ weather }: { weather: string }) {
  const normalized = weather.replace(/_/g, ' ').toLowerCase();

  if (normalized === 'clear') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="4.5" />
        <path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3M4.6 4.6l2.1 2.1M17.3 17.3l2.1 2.1M19.4 4.6l-2.1 2.1M6.7 17.3l-2.1 2.1" />
      </svg>
    );
  }

  if (normalized === 'light cloud' || normalized === 'overcast') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7.5 18.5h9a4 4 0 0 0 .4-8A5.5 5.5 0 0 0 6.4 9.3 3.8 3.8 0 0 0 7.5 18.5Z" />
      </svg>
    );
  }

  if (normalized === 'storm') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7.5 15.5h9a4 4 0 0 0 .4-8A5.5 5.5 0 0 0 6.4 6.3 3.8 3.8 0 0 0 7.5 15.5Z" />
        <path d="M13 16l-2 4h4l-2 4" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7.5 15.5h9a4 4 0 0 0 .4-8A5.5 5.5 0 0 0 6.4 6.3 3.8 3.8 0 0 0 7.5 15.5Z" />
      <path d="M9 17.5l-1 3M13 17.5l-1 3M17 17.5l-1 3" />
    </svg>
  );
}

function PanelTitle({
  title,
  tone,
  detail,
}: {
  title: string;
  tone: 'primary' | 'tertiary' | 'secondary' | 'neutral';
  detail?: string;
}) {
  return (
    <div className={styles.panelTitle}>
      <div>
        <span className={`${styles.panelEyebrow} ${styles[tone]}`}>{title}</span>
        {detail && <span className={styles.panelDetail}>{detail}</span>}
      </div>
      <span className={`${styles.panelMarker} ${styles[tone]}`} />
    </div>
  );
}

function MetricTile({
  label,
  value,
  tone,
  className,
}: {
  label: string;
  value: string;
  tone: 'primary' | 'tertiary' | 'secondary' | 'neutral';
  className?: string;
}) {
  return (
    <div className={className ? `${styles.metricTile} ${className}` : styles.metricTile}>
      <span>{label}</span>
      <strong className={styles[tone]}>{value}</strong>
    </div>
  );
}

function BattleTarget({
  label,
  driver,
  gapLabel,
  paceLabel,
  tone,
}: {
  label: string;
  driver: DriverInfo | null;
  gapLabel: string;
  paceLabel: string;
  tone: 'tertiary' | 'secondary';
}) {
  return (
    <div className={styles.battleCard}>
      <div className={styles.battleHeader}>
        <span>{label}</span>
        <strong className={styles[tone]}>
          {driver ? abbreviateDriver(driver.name, driver.index) : '--'}
        </strong>
      </div>
      <div className={styles.metricGrid}>
        <MetricTile label="Gap" value={gapLabel} tone={tone} />
        <MetricTile label="Pace Δ" value={paceLabel} tone={tone === 'tertiary' ? 'primary' : 'neutral'} />
      </div>
    </div>
  );
}

function DamageMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className={styles.damageMetric}>
      <span>{label}</span>
      <strong className={styles[getDamageTone(value)]}>{`${Math.round(value)}%`}</strong>
    </div>
  );
}

function DamageSummaryCell({
  driver,
  className,
  mobileLabel,
}: {
  driver: DriverInfo;
  className?: string;
  mobileLabel?: string;
}) {
  const damageItems = [
    { label: 'FL', value: driver.damage?.frontLeftWing ?? 0 },
    { label: 'FR', value: driver.damage?.frontRightWing ?? 0 },
    { label: 'RW', value: driver.damage?.rearWing ?? 0 },
    {
      label: 'OTH',
      value: Math.max(
        driver.damage?.floor ?? 0,
        driver.damage?.diffuser ?? 0,
        driver.damage?.sidepod ?? 0,
      ),
    },
  ];

  return (
    <div
      className={[styles.damageSummaryCell, className].filter(Boolean).join(' ')}
      data-mobile-label={mobileLabel}
    >
      {damageItems.map((item) => (
        <span
          key={item.label}
          className={styles.damageSummaryPill}
          style={getDamageSeverityStyle(item.value)}
        >
          <span className={styles.damageSummaryLabel}>{item.label}</span>
          <strong>{Math.round(item.value)}%</strong>
        </span>
      ))}
    </div>
  );
}

function PenaltyCell({
  driver,
  className,
  mobileLabel,
}: {
  driver: DriverInfo;
  className?: string;
  mobileLabel?: string;
}) {
  const warnings = driver.totalWarnings ?? 0;
  const timePen = driver.penalties ?? 0;
  const dt = driver.numUnservedDriveThroughs ?? 0;
  const sg = driver.numUnservedStopGoPenalties ?? 0;
  const hasPenalty = warnings > 0 || timePen > 0 || dt > 0 || sg > 0;
  const penaltyClassName = [styles.penaltyCell, className].filter(Boolean).join(' ');

  if (!hasPenalty) {
    return <span className={penaltyClassName} data-mobile-label={mobileLabel}>--</span>;
  }

  const badges: string[] = [];
  if (warnings > 0) badges.push(`W${warnings}`);
  if (timePen > 0) badges.push(`+${timePen}s`);
  if (dt > 0) badges.push(`DT${dt}`);
  if (sg > 0) badges.push(`SG${sg}`);

  const details: string[] = [];
  if (warnings > 0) {
    const cc = driver.cornerCuttingWarnings ?? 0;
    const other = warnings - cc;
    if (cc > 0) details.push(`Corner cutting: ${cc}`);
    if (other > 0) details.push(`Other warnings: ${other}`);
  }
  if (timePen > 0) details.push(`Time penalty: +${timePen}s`);
  if (dt > 0) details.push(`Drive-through: ${dt} unserved`);
  if (sg > 0) details.push(`Stop-go: ${sg} unserved`);

  return (
    <span className={penaltyClassName} title={details.join('\n')} data-mobile-label={mobileLabel}>
      {badges.map((badge) => {
        const isWarning = badge.startsWith('W');
        return (
          <span
            key={badge}
            className={isWarning ? styles.penaltyBadgeWarn : styles.penaltyBadgePen}
          >
            {badge}
          </span>
        );
      })}
    </span>
  );
}

function SectorDeltaCell({
  sectorHistory,
  className,
  mobileLabel,
}: {
  sectorHistory?: DriverSectorHistory;
  className?: string;
  mobileLabel?: string;
}) {
  const sectorTimes = sectorHistory?.latestSectorTimes ?? [0, 0, 0];
  const previousSectorTimes = sectorHistory?.previousSectorTimes ?? [0, 0, 0];

  return (
    <span
      className={[styles.sectorCell, className].filter(Boolean).join(' ')}
      data-mobile-label={mobileLabel}
    >
      {SECTOR_LABELS.map((label, index) => {
        const sectorTime = sectorTimes[index];
        const previousSectorTime = previousSectorTimes[index];
        const delta = sectorTime > 0 && previousSectorTime > 0 ? sectorTime - previousSectorTime : null;
        const title = sectorTime > 0
          ? `${label} ${formatLapTime(sectorTime)}${
            previousSectorTime > 0 ? ` (prev ${formatLapTime(previousSectorTime)})` : ''
          }`
          : `${label} pending`;

        return (
          <span
            key={label}
            className={`${styles.sectorChip} ${styles[getSectorDeltaTone(delta)]}`}
            title={title}
          >
            <span className={styles.sectorChipLabel}>{label}</span>
            <span className={styles.sectorChipValue}>{formatSectorTime(sectorTime)}</span>
          </span>
        );
      })}
    </span>
  );
}

function abbreviateDriver(name: string, fallbackIndex?: number): string {
  const trimmed = name?.trim();
  if (!trimmed) return fallbackIndex != null ? `P${fallbackIndex}` : '---';
  const parts = trimmed.split(/\s+/);
  return (parts.length > 1 ? parts[parts.length - 1] : trimmed).slice(0, 3).toUpperCase();
}

function formatAheadGap(player: DriverInfo | null): string {
  if (player?.deltaToCarInFront == null || player.deltaToCarInFront <= 0) return '--';
  return `-${(player.deltaToCarInFront / 1000).toFixed(2)}s`;
}

function formatBehindGap(carBehind: DriverInfo | null): string {
  if (carBehind?.deltaToCarInFront == null || carBehind.deltaToCarInFront <= 0) return '--';
  return `+${(carBehind.deltaToCarInFront / 1000).toFixed(2)}s`;
}

function formatBattlePace(
  player: DriverInfo | null,
  rival: DriverInfo | null,
  side: 'ahead' | 'behind',
): string {
  if (!player || !rival || player.lastLapTime <= 0 || rival.lastLapTime <= 0) return '--';
  const deltaMs = side === 'ahead'
    ? player.lastLapTime - rival.lastLapTime
    : rival.lastLapTime - player.lastLapTime;
  return `${deltaMs > 0 ? '+' : ''}${(deltaMs / 1000).toFixed(2)}s`;
}

function getDrsProgress(player: DriverInfo | null): number {
  if (!player?.deltaToCarInFront || player.deltaToCarInFront <= 0) return 0;
  return clamp(100 - (player.deltaToCarInFront / 1000) * 100, 0, 100);
}

function getDrsWindowStatus(player: DriverInfo | null): string {
  if (!player?.deltaToCarInFront || player.deltaToCarInFront <= 0) return 'NO TARGET';
  if (player.deltaToCarInFront <= 1000) return 'ARMED';
  if (player.deltaToCarInFront <= 1500) return 'PRESSING';
  return 'LOCKED';
}

function getDrsWindowLabel(player: DriverInfo | null): string {
  if (!player?.deltaToCarInFront || player.deltaToCarInFront <= 0) return 'Combat Window';
  return player.deltaToCarInFront <= 1000 ? 'DRS Gap' : 'To DRS';
}

function formatDrsWindow(player: DriverInfo | null): string {
  if (!player?.deltaToCarInFront || player.deltaToCarInFront <= 0) return '--';
  if (player.deltaToCarInFront <= 1000) {
    return `${(player.deltaToCarInFront / 1000).toFixed(2)}s`;
  }
  return `${((player.deltaToCarInFront - 1000) / 1000).toFixed(2)}s`;
}

function formatGap(driver: DriverInfo): string {
  if (driver.position === 1) return 'LEADER';
  if (driver.deltaToRaceLeader == null || driver.deltaToRaceLeader <= 0) return '--';
  return `+${(driver.deltaToRaceLeader / 1000).toFixed(3)}`;
}

function formatReferenceGap(driver: DriverInfo, player: DriverInfo | null, visible: boolean): string {
  if (!visible) return formatGap(driver);
  if (!player) return '--';
  if (player && driver.index === player.index) return 'YOU';
  if (driver.deltaToPlayer == null) return '--';
  return formatDelta(driver.deltaToPlayer);
}

function formatInterval(driver: DriverInfo): string {
  if (driver.position === 1) return '---';
  if (driver.deltaToCarInFront == null || driver.deltaToCarInFront <= 0) return '--';
  return `+${(driver.deltaToCarInFront / 1000).toFixed(3)}`;
}

function formatTopSpeed(driver: DriverInfo, visible: boolean): string {
  if (!visible) return 'LOCK';
  if (!driver.topSpeed || driver.topSpeed <= 0) return '--';
  return `${driver.topSpeed}`;
}

function getTopSpeedTone(driver: DriverInfo, visible: boolean): 'topSpeedLocked' | 'topSpeedHigh' | 'topSpeedBase' {
  if (!visible) return 'topSpeedLocked';
  if ((driver.topSpeed ?? 0) >= 320) return 'topSpeedHigh';
  return 'topSpeedBase';
}

function getSectorDeltaTone(deltaMs: number | null): SectorDeltaTone {
  if (deltaMs == null) return 'sectorPending';
  if (deltaMs < -50) return 'sectorBest';
  if (deltaMs <= 50) return 'sectorGood';
  return 'sectorSlow';
}

function normalizeSectorTime(value: number | undefined): number {
  if (!value || value <= 0) return 0;
  return Math.round(value);
}

function formatSectorTime(ms: number): string {
  if (ms <= 0) return '--';
  return (ms / 1000).toFixed(3);
}

function buildCompletedSectorTimes(lastLapTime: number, sector1TimeMs: number, sector2TimeMs: number): SectorTimes | null {
  const lapTime = normalizeSectorTime(lastLapTime);
  const sector1 = normalizeSectorTime(sector1TimeMs);
  const sector2 = normalizeSectorTime(sector2TimeMs);
  if (lapTime <= 0 || sector1 <= 0 || sector2 <= 0) return null;

  const sector3 = lapTime - sector1 - sector2;
  if (sector3 <= 0 || sector3 >= lapTime) return null;

  return [sector1, sector2, sector3];
}

function useCompletedSectorHistory(drivers: DriverInfo[], session: SessionInfo | null) {
  const [historyMap, setHistoryMap] = useState<Map<number, DriverSectorHistory>>(() => new Map());
  const prevRef = useRef<Map<number, PrevSectorSnapshot>>(new Map());
  const sessionKeyRef = useRef('');
  const sessionKey = `${session?.trackId ?? ''}|${session?.sessionType ?? ''}`;

  useEffect(() => {
    if (sessionKeyRef.current && sessionKeyRef.current !== sessionKey) {
      setHistoryMap(new Map());
      prevRef.current = new Map();
    }
    sessionKeyRef.current = sessionKey;
  }, [sessionKey]);

  useEffect(() => {
    if (drivers.length === 0) return;

    const capturedPrev = prevRef.current;
    let changed = false;

    setHistoryMap((prev) => {
      const next = new Map(prev);

      for (const driver of drivers) {
        const current = next.get(driver.index) ?? {
          latestLapNum: 0,
          latestSectorTimes: [0, 0, 0] as SectorTimes,
          previousSectorTimes: [0, 0, 0] as SectorTimes,
        };
        const snap = capturedPrev.get(driver.index);

        if (!snap || driver.currentLapNum <= snap.currentLapNum) {
          if (!next.has(driver.index)) {
            next.set(driver.index, current);
            changed = true;
          }
          continue;
        }

        const latestSectorTimes = buildCompletedSectorTimes(
          snap.lastLapTime,
          snap.sector1TimeMs,
          snap.sector2TimeMs,
        );
        if (!latestSectorTimes) {
          if (!next.has(driver.index)) {
            next.set(driver.index, current);
            changed = true;
          }
          continue;
        }

        const previousSectorTimes = current.latestLapNum > 0
          ? current.latestSectorTimes
          : current.previousSectorTimes;
        next.set(driver.index, {
          latestLapNum: snap.currentLapNum,
          latestSectorTimes,
          previousSectorTimes,
        });
        changed = true;
      }

      return changed ? next : prev;
    });

    const nextPrev = new Map<number, PrevSectorSnapshot>();
    for (const driver of drivers) {
      nextPrev.set(driver.index, {
        currentLapNum: driver.currentLapNum,
        lastLapTime: driver.lastLapTime,
        sector1TimeMs: driver.sector1TimeMs,
        sector2TimeMs: driver.sector2TimeMs,
      });
    }
    prevRef.current = nextPrev;
  }, [drivers]);

  return historyMap;
}

function driverCanArmDrs(driver: DriverInfo | null): boolean {
  return (driver?.deltaToCarInFront ?? 0) > 0 && (driver?.deltaToCarInFront ?? 0) <= 1000;
}

function driverHasDrs(driver: DriverInfo): boolean {
  if (driver.drsActivated !== undefined) {
    return driver.drsActivated;
  }
  return driverCanArmDrs(driver);
}

function getDrsTone(driver: DriverInfo): 'drsActive' | 'drsArmed' | 'drsInactive' {
  if (driverHasDrs(driver)) return 'drsActive';
  if (driverCanArmDrs(driver)) return 'drsArmed';
  return 'drsInactive';
}

function formatPitStatus(driver: DriverInfo, visible: boolean): string {
  if (!visible) return 'LOCK';
  return driver.pitStatus > 0 ? 'PIT' : '--';
}

function getPitStatusTone(driver: DriverInfo, visible: boolean): 'pitLocked' | 'pitActive' | 'pitInactive' {
  if (!visible) return 'pitLocked';
  return driver.pitStatus > 0 ? 'pitActive' : 'pitInactive';
}

function getDriverRowTone(driver: DriverInfo, player: DriverInfo | null): 'playerRow' | 'leaderRow' | 'teamRow' | '' {
  if (player && driver.index === player.index) return 'playerRow';
  if (driver.position === 1) return 'leaderRow';
  if (player && driver.teamId === player.teamId) return 'teamRow';
  return '';
}

function getTrackCondition(weather?: string): { label: string; tone: 'tertiary' | 'secondary' | 'primary' } {
  const normalized = weather?.toLowerCase().replace(/_/g, ' ') ?? '';
  if (normalized.includes('rain') || normalized.includes('storm')) {
    return { label: 'WET', tone: 'secondary' };
  }
  if (normalized.includes('cloud')) {
    return { label: 'MIXED', tone: 'primary' };
  }
  return { label: 'DRY', tone: 'tertiary' };
}

const FLAG_COLORS: Record<number, string> = {
  1: '#22c55e', // GREEN
  2: '#3b82f6', // BLUE
  3: '#eab308', // YELLOW
  4: '#ef4444', // RED
};

function getSectorFlag(zones: { start: number; flag: number }[] | undefined, sector: number): number {
  if (!zones) return 0;
  const lo = (sector - 1) / 3;
  const hi = sector / 3;
  for (const z of zones) {
    if (z.start >= lo && z.start < hi && z.flag >= 1) return z.flag;
  }
  return 0;
}

function formatSafetyCarShort(sc: string | undefined): string {
  if (!sc || sc === 'none') return '';
  if (sc === 'full') return 'SC';
  if (sc === 'virtual') return 'VSC';
  if (sc === 'virtual_ending' || sc === 'virtual_standing') return 'VSCE';
  if (sc === 'formation') return 'SCI';
  return sc.toUpperCase();
}

function TrackStatusRibbon({ session, connectionState }: {
  session: SessionInfo | null;
  connectionState: ConnectionState;
}) {
  const s1Flag = getSectorFlag(session?.marshalZones, 1);
  const s2Flag = getSectorFlag(session?.marshalZones, 2);
  const s3Flag = getSectorFlag(session?.marshalZones, 3);
  const scLabel = formatSafetyCarShort(session?.safetyCar);

  return (
    <div className={styles.trackStatusRibbon}>
      <span className={styles.trackStatusLabel}>Status</span>
      <div className={styles.trackStatusRow}>
        <span className={styles.sectorFlag} style={s1Flag ? { color: FLAG_COLORS[s1Flag] } : undefined}>
          S1
        </span>
        <span className={styles.sectorFlag} style={s2Flag ? { color: FLAG_COLORS[s2Flag] } : undefined}>
          S2
        </span>
        <span className={styles.sectorFlag} style={s3Flag ? { color: FLAG_COLORS[s3Flag] } : undefined}>
          S3
        </span>
        <span className={styles.scBadge}>
          {scLabel || (connectionState === 'connected' ? 'CLR' : '---')}
        </span>
      </div>
    </div>
  );
}

function getRaceStatus(
  session: SessionInfo | null,
  notifications: RaceControlNotification[],
): { label: string; tone: 'primary' | 'tertiary' | 'secondary' | 'neutral' } {
  if (session?.safetyCar === 'full') return { label: 'SAFETY CAR', tone: 'secondary' };
  if (session?.safetyCar === 'virtual') return { label: 'VSC', tone: 'secondary' };
  const recent = notifications[0];
  if (recent?.severity === 'critical') return { label: 'CRITICAL', tone: 'secondary' };
  if (recent?.severity === 'warning') return { label: 'WARNING', tone: 'secondary' };
  if (recent?.category === 'info') return { label: 'INFO', tone: 'primary' };
  return { label: 'GREEN', tone: 'tertiary' };
}

function getErsSplit(player: DriverInfo | null): { deploy: number; harvest: number } {
  const deploy = Math.max(player?.ersDeployedThisLap ?? 0, 0);
  const harvest = Math.max(player?.ersHarvestedThisLap ?? 0, 0);
  const total = deploy + harvest;
  if (total <= 0) return { deploy: 0, harvest: 0 };
  return {
    deploy: Math.round((deploy / total) * 100),
    harvest: Math.round((harvest / total) * 100),
  };
}

function getErsModeLabel(player: DriverInfo | null): string {
  const ERS_MODE_LABELS: Record<number, string> = {
    0: 'NONE',
    1: 'MEDIUM',
    2: 'HOTLAP',
    3: 'OVERTAKE',
  };
  const mode = player?.ersDeployMode ?? 0;
  return ERS_MODE_LABELS[mode] ?? ERS_MODE_LABELS[0];
}

function formatErsActual(driver: DriverInfo): string {
  if (!driver.ersActualReady) return '--';
  return `${driver.ersActualPct}%`;
}

function formatErsCompare(driver: DriverInfo): string {
  if (!driver.ersActualReady) return 'A--';
  const delta = driver.ersEstimateReady ? driver.ersEstimatePct - driver.ersActualPct : null;
  if (delta == null) return `A${driver.ersActualPct}%`;
  const sign = delta > 0 ? '+' : '';
  return `A${driver.ersActualPct}% Δ${sign}${delta}`;
}

function getErsActualTone(driver: DriverInfo): 'ersHigh' | 'ersMedium' | 'ersLow' | 'ersPending' {
  if (!driver.ersActualReady) return 'ersPending';
  if (driver.ersActualPct >= 65) return 'ersHigh';
  if (driver.ersActualPct >= 35) return 'ersMedium';
  return 'ersLow';
}

function getFuelMargin(player: DriverInfo | null, session: SessionInfo | null): string {
  if (!player || !session) return '--';
  const lapsRemaining = Math.max((session.totalLaps ?? 0) - player.currentLapNum, 0);
  const margin = player.fuelRemainingLaps - lapsRemaining;
  const sign = margin >= 0 ? '+' : '';
  return `${sign}${margin.toFixed(2)} LAPS`;
}

function normalizeWheelData(data?: number[]): number[] {
  return WHEEL_LABELS.map((_, index) => data?.[index] ?? 0);
}

function getTemperatureTone(temp: number, low: number, high: number): 'tertiary' | 'primary' | 'secondary' {
  if (temp >= high) return 'secondary';
  if (temp >= low) return 'tertiary';
  return 'primary';
}

function getTemperatureStatus(temp: number, low: number, high: number): string {
  if (temp >= high) return 'HIGH TEMP';
  if (temp >= low) return 'CORE OK';
  return 'COLD';
}

function getRecommendedTyre(player: DriverInfo | null, session: SessionInfo | null): string {
  const condition = getTrackCondition(session?.weather).label;
  if (condition === 'WET') return 'inter';
  if (!player) return 'medium';
  if (player.tireCompound.toLowerCase() === 'soft') return 'medium';
  if ((player.tireWear?.reduce((sum, value) => sum + value, 0) ?? 0) / 4 > 55) return 'hard';
  return player.tireCompound.toLowerCase();
}

function getPitWindow(
  session: SessionInfo | null,
  player: DriverInfo | null,
): { label: string; tone: 'tertiary' | 'secondary' | 'primary' } {
  if (!session || !player || !session.pitStopWindowIdealLap || !session.pitStopWindowLatestLap) {
    return { label: 'STANDBY', tone: 'primary' };
  }
  if (player.currentLapNum < session.pitStopWindowIdealLap) {
    return { label: 'SOON', tone: 'primary' };
  }
  if (player.currentLapNum <= session.pitStopWindowLatestLap) {
    return { label: 'OPEN', tone: 'tertiary' };
  }
  return { label: 'LATE', tone: 'secondary' };
}

function buildStrategyPanelData(
  player: DriverInfo | null,
  session: SessionInfo | null,
  strategyGuide: StrategyGuideResponse | null,
  recommendedTyre: string,
  pitWindow: { label: string; tone: 'tertiary' | 'secondary' | 'primary' },
  trafficStatus: { label: string; detail: string; meter: number },
): StrategyPanelData {
  const guideTrack = strategyGuide?.track;
  const raceStrategy = guideTrack?.race_strategy;
  const primaryPlan = guideTrack ? getPrimaryStrategyPlan(guideTrack, session?.totalLaps ?? 0) : null;
  const nextPit = primaryPlan && player ? getNextPitWindow(primaryPlan, player.currentLapNum) : null;
  const targetTyre = getStrategyTargetTyre(primaryPlan, nextPit, recommendedTyre);

  if (guideTrack && raceStrategy?.available) {
    const pitWindowLabel = nextPit
      ? `${nextPit.status === 'open' ? 'OPEN ' : ''}${formatLapRange(nextPit.range)}`
      : 'COMPLETE';
    const pitWindowTone = nextPit ? getStrategyWindowTone(nextPit.status) : 'neutral';
    const currentOrTargetCompound = normalizeStrategyCompound(player?.tireCompound) ?? normalizeStrategyCompound(targetTyre);
    const compoundSummary = buildCompoundSummary(guideTrack, strategyGuide?.tyreTemps, currentOrTargetCompound);

    return {
      guideActive: true,
      titleDetail: 'Numeric guide active',
      targetTyre,
      targetTyreReason: primaryPlan ? `${primaryPlan.tyres.map((tyre) => getTyreShortLabel(tyre)).join(' - ')}` : undefined,
      pitWindowLabel,
      pitWindowTone,
      primaryMetric: {
        label: session && guideTrack.track_info.lap_count && session.totalLaps > guideTrack.track_info.laps_50pct ? '100% Plan' : 'Primary Plan',
        value: primaryPlan ? primaryPlan.tyres.map((tyre) => getTyreShortLabel(tyre)).join(' - ') : '--',
        tone: 'primary',
      },
      detailLabel: 'Data Guide',
      detailValue: formatStrategyGuideHeadline(raceStrategy),
      detailMeta: compoundSummary,
      meter: nextPit ? getPitWindowMeter(player?.currentLapNum ?? 0, nextPit.range, nextPit.status) : 100,
      notes: raceStrategy.notes,
    };
  }

  if (guideTrack) {
    const compoundSummary = buildCompoundSummary(
      guideTrack,
      strategyGuide?.tyreTemps,
      normalizeStrategyCompound(player?.tireCompound) ?? normalizeStrategyCompound(recommendedTyre),
    );

    return {
      guideActive: false,
      titleDetail: 'Track data only',
      targetTyre: recommendedTyre,
      targetTyreReason: `${guideTrack.track_info.circuit_length_km.toFixed(3)}km · ${guideTrack.track_info.drs_zones} DRS`,
      pitWindowLabel: pitWindow.label,
      pitWindowTone: pitWindow.tone,
      primaryMetric: {
        label: 'Fuel 50%',
        value: raceStrategy?.starting_fuel_50pct_kg ? `${raceStrategy.starting_fuel_50pct_kg.toFixed(1)}kg` : '--',
        tone: 'primary',
      },
      detailLabel: 'Tyre Data',
      detailValue: compoundSummary.split(' · ')[0] ?? '--',
      detailMeta: compoundSummary.split(' · ').slice(1).join(' · ') || 'Race plan unavailable for this track.',
      meter: 0,
      notes: 'Race strategy plan is missing, heuristic recommendations remain active.',
    };
  }

  return {
    guideActive: false,
    targetTyre: recommendedTyre,
    pitWindowLabel: pitWindow.label,
    pitWindowTone: pitWindow.tone,
    primaryMetric: {
      label: 'Est. Exit Pos',
      value: session?.pitStopRejoinPosition ? `P${session.pitStopRejoinPosition}` : '--',
      tone: 'primary',
    },
    detailLabel: 'Traffic Status',
    detailValue: trafficStatus.label,
    detailMeta: trafficStatus.detail,
    meter: trafficStatus.meter,
  };
}

function getPrimaryStrategyPlan(track: StrategyGuideResponse['track'], totalLaps: number): StrategyRacePlan | null {
  const raceStrategy = track.race_strategy;
  if (!raceStrategy?.available) return null;
  if (track.track_info.lap_count && totalLaps >= track.track_info.lap_count && raceStrategy.plan_100pct) {
    return raceStrategy.plan_100pct;
  }
  if (totalLaps > track.track_info.laps_50pct && raceStrategy.plan_100pct) {
    return raceStrategy.plan_100pct;
  }
  return raceStrategy.plan_a ?? raceStrategy.plan_b ?? raceStrategy.plan_100pct ?? null;
}

function getNextPitWindow(
  plan: StrategyRacePlan,
  currentLap: number,
): { range: StrategyRacePlan['pit_windows'][number]; index: number; status: StrategyWindowStatus } | null {
  for (let index = 0; index < plan.pit_windows.length; index += 1) {
    const range = plan.pit_windows[index];
    if (currentLap < range.start_lap) {
      return { range, index, status: 'soon' };
    }
    if (currentLap <= range.end_lap) {
      return { range, index, status: 'open' };
    }
  }
  return null;
}

function getStrategyTargetTyre(
  plan: StrategyRacePlan | null,
  nextPit: { index: number } | null,
  fallback: string,
): string {
  if (!plan || nextPit == null) return fallback;
  return plan.tyres[nextPit.index + 1] ?? fallback;
}

function getStrategyWindowTone(status: StrategyWindowStatus): 'primary' | 'secondary' | 'tertiary' | 'neutral' {
  if (status === 'open') return 'tertiary';
  if (status === 'soon') return 'primary';
  return 'neutral';
}

function getPitWindowMeter(currentLap: number, range: StrategyRacePlan['pit_windows'][number], status: StrategyWindowStatus): number {
  if (status === 'complete') return 100;
  if (currentLap < range.start_lap) {
    return clamp((currentLap / Math.max(range.start_lap, 1)) * 100, 0, 100);
  }
  const span = Math.max(range.end_lap - range.start_lap + 1, 1);
  return clamp(((currentLap - range.start_lap + 1) / span) * 100, 0, 100);
}

function formatLapRange(range: StrategyRacePlan['pit_windows'][number]): string {
  if (range.start_lap === range.end_lap) return `L${range.start_lap}`;
  return `L${range.start_lap}-${range.end_lap}`;
}

function formatStrategyGuideHeadline(raceStrategy: NonNullable<StrategyGuideResponse['track']['race_strategy']>): string {
  const parts: string[] = [];
  if (raceStrategy.starting_fuel_50pct_kg) {
    parts.push(`Fuel ${raceStrategy.starting_fuel_50pct_kg.toFixed(1)}kg`);
  }
  if (raceStrategy.pit_stop_time_lost_s) {
    parts.push(`Pit Loss ${raceStrategy.pit_stop_time_lost_s.toFixed(1)}s`);
  }
  return parts.join(' · ') || 'Guide ready';
}

function buildCompoundSummary(
  track: StrategyGuideResponse['track'],
  tyreTemps: StrategyGuideResponse['tyreTemps'] | undefined,
  compoundKey: string | null,
): string {
  if (!compoundKey) return 'Compound data unavailable';
  const wear = track.tyre_strategy.wear_per_lap[compoundKey];
  const life = track.tyre_strategy.tyre_life_50pct[compoundKey];
  const peakTemps = tyreTemps?.compounds[compoundToStrategyTempKey(track, compoundKey)]?.peak_temps_c ?? [];

  const parts: string[] = [];
  if (peakTemps.length > 0) {
    parts.push(`Peak ${formatPeakTemps(peakTemps)}`);
  }
  if (wear) {
    parts.push(`Wear ${wear.display}/lap`);
  }
  if (life) {
    parts.push(`Life ${life.laps}L@50%`);
  }
  return parts.join(' · ') || 'Compound data unavailable';
}

function compoundToStrategyTempKey(track: StrategyGuideResponse['track'], compoundKey: string): string {
  return track.tyre_strategy.compounds[compoundKey] ?? compoundKey;
}

function formatPeakTemps(peakTemps: number[]): string {
  if (peakTemps.length === 1) return `${peakTemps[0]}°C`;
  return `${peakTemps[0]}-${peakTemps[peakTemps.length - 1]}°C`;
}

function normalizeStrategyCompound(compound?: string | null): string | null {
  if (!compound) return null;
  const normalized = compound.trim().toLowerCase();
  if (normalized === 'soft' || normalized === 'medium' || normalized === 'hard' || normalized === 'inter' || normalized === 'wet') {
    return normalized;
  }
  return null;
}

function getTrafficStatus(carBehind: DriverInfo | null): { label: string; detail: string; meter: number } {
  const gapMs = carBehind?.deltaToCarInFront ?? 0;
  if (gapMs <= 0) {
    return { label: 'UNKNOWN', detail: 'No chase car delta', meter: 20 };
  }
  if (gapMs >= 3500) {
    return { label: 'CLEAN AIR', detail: `+${(gapMs / 1000).toFixed(1)}s`, meter: 78 };
  }
  if (gapMs >= 1800) {
    return { label: 'TIGHT EXIT', detail: `+${(gapMs / 1000).toFixed(1)}s`, meter: 48 };
  }
  return { label: 'TRAFFIC RISK', detail: `+${(gapMs / 1000).toFixed(1)}s`, meter: 22 };
}

function getTrainStatus(
  drivers: DriverInfo[],
  player: DriverInfo | null,
): { trainSize: number; inTrain: boolean } {
  if (!player || drivers.length < 2) return { trainSize: 0, inTrain: false };

  const TRAIN_THRESHOLD = 1500;
  let playerIdx = -1;
  for (let i = 0; i < drivers.length; i++) {
    if (drivers[i].index === player.index) {
      playerIdx = i;
      break;
    }
  }
  if (playerIdx === -1) return { trainSize: 0, inTrain: false };

  const chains: { start: number; end: number }[] = [];
  let chainStart = 0;
  for (let i = 1; i < drivers.length; i++) {
    const gap = drivers[i].deltaToCarInFront ?? 0;
    if (gap <= 0 || gap > TRAIN_THRESHOLD || drivers[i].pitStatus !== 0) {
      if (i - chainStart >= 2) chains.push({ start: chainStart, end: i - 1 });
      chainStart = i;
    }
  }
  if (drivers.length - chainStart >= 2) {
    chains.push({ start: chainStart, end: drivers.length - 1 });
  }

  for (const ch of chains) {
    if (playerIdx >= ch.start && playerIdx <= ch.end) {
      const size = ch.end - ch.start + 1;
      return { trainSize: size, inTrain: size >= 3 };
    }
  }
  return { trainSize: 0, inTrain: false };
}

function formatForecastLabel(remainingMinutes: number): string {
  if (remainingMinutes <= 0.5) return 'NOW';
  const rounded = Math.ceil(remainingMinutes);
  return `+${rounded}M`;
}


function getDamageTone(value: number): 'tertiary' | 'primary' | 'secondary' {
  if (value >= 20) return 'secondary';
  if (value >= 5) return 'primary';
  return 'tertiary';
}

function getDamageSeverityStyle(value: number) {
  const severity = clamp(value, 0, 100) / 100;
  const hue = 120 - severity * 120;

  return {
    color: `hsl(${hue} 82% 58%)`,
    borderColor: `hsla(${hue} 82% 58% / 0.36)`,
    backgroundColor: `hsla(${hue} 82% 58% / 0.12)`,
  };
}

