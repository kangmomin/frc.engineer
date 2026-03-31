import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { getTeamColor, getTeamName } from '../../constants/teamColors';
import { getTyreColor, getTyreShortLabel, getWearStatusColor } from '../../constants/tyreCompounds';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import { useTelemetryStore } from '../../store/telemetryStore';
import type {
  DriverInfo,
  RaceControlNotification,
  SessionInfo,
  StrategyGuideResponse,
  StrategyRacePlan,
  TireWearDisplayMode,
  WeatherForecast,
} from '../../types/telemetry';
import { clamp, formatDelta, formatLapTime } from '../../utils/formatters';
import styles from './CockpitDashboard.module.css';

const MAX_ERS_ENERGY = 4_000_000;
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

type SectorBestTimes = [number, number, number];
type SectorDeltaTone = 'sectorPending' | 'sectorBest' | 'sectorGood' | 'sectorSlow';
type StrategyWindowStatus = 'open' | 'soon' | 'complete';

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
  onSwitchToCommentary?: () => void;
  onGoHome?: () => void;
}

export function CockpitDashboard({
  onOpenSettings,
  showSettingsButton,
  remoteAction,
  onSwitchToCommentary,
  onGoHome,
}: CockpitDashboardProps) {
  const {
    pitwallState,
    battleAlerts,
    raceControlNotifications,
    connectionState,
    playbackActive,
    featurePermissions,
  } = useTelemetryStore(
    useShallow((state) => ({
      pitwallState: state.pitwallState,
      battleAlerts: state.battleAlerts,
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
  const ersComparisonEnabled = (pitwallState?.ersComparisonEnabled ?? false) && featurePermissions.viewERSActual;
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
  const sectorBestTimes = useMemo(() => getSectorBestTimes(drivers), [drivers]);

  const carAhead = useMemo(() => {
    if (!player) return null;
    return drivers.find((driver) => driver.position === player.position - 1) ?? null;
  }, [drivers, player]);

  const carBehind = useMemo(() => {
    if (!player) return null;
    return drivers.find((driver) => driver.position === player.position + 1) ?? null;
  }, [drivers, player]);

  const aheadAlert = battleAlerts.find((alert) => alert.side === 'ahead');
  const behindAlert = battleAlerts.find((alert) => alert.side === 'behind');
  const topForecasts = session?.weatherForecast ?? [];
  const recentNotifications = raceControlNotifications.slice(0, 3);
  const raceStatus = getRaceStatus(session, recentNotifications);
  const sessionTrackId = session?.trackId ?? null;
  const sessionTrackName = session?.trackName ?? '';
  const ersPct = clamp(player ? (player.ersStoreEnergy / MAX_ERS_ENERGY) * 100 : 0, 0, 100);
  const deploySplit = getErsSplit(player);
  const fuelMargin = getFuelMargin(player, session);
  const wheelSurfaceTemp = normalizeWheelData(player?.tireSurfaceTemp);
  const wheelCoreTemp = normalizeWheelData(player?.tireInnerTemp);
  const wheelWear = normalizeWheelData(player?.tireWear);
  const averageWear = wheelWear.reduce((sum, value) => sum + value, 0) / WHEEL_LABELS.length;
  const averageWearPerLap = player?.tireAge ? averageWear / Math.max(player.tireAge, 1) : 0;
  const [wearDisplayMode] = useLocalStorage<TireWearDisplayMode>(
    'tireWearDisplayMode',
    'absolute',
    (v) => (v === 'absolute' || v === 'relative' ? v : null),
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
    if (!featurePermissions.viewAdvancedStrategy || sessionTrackId == null) {
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
        return response.json() as Promise<StrategyGuideResponse>;
      })
      .then((data) => {
        if (!cancelled) {
          setStrategyGuide(data);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.error('Failed to fetch strategy guide:', error);
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
        {onSwitchToCommentary && (
          <button
            type="button"
            className={styles.remoteButton}
            onClick={onSwitchToCommentary}
            aria-label="Switch to commentary"
          >
            Live
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
            <StatRibbon
              label="Status"
              value={raceStatus.label}
              detail={getConnectionLabel(connectionState)}
              tone={raceStatus.tone}
            />
          </div>

          <div className={`${styles.panel} ${styles.leaderboardPanel}`}>
            <div className={styles.tableHeader}>
              <span>Pos</span>
              <span>Driver</span>
              <span>DRS</span>
              <span>{pitStatusVisible ? 'Pit' : 'Pit Locked'}</span>
              <span>{ersComparisonEnabled ? 'ERS Est/Act' : 'ERS Est.'}</span>
              <span>{topSpeedVisible ? 'Vmax' : 'Vmax Locked'}</span>
              <span>{playerDeltaVisible ? 'To You' : 'Gap'}</span>
              <span>Interval</span>
              <span>Sector Δ</span>
              <span>Last Lap</span>
              <span>Pen</span>
              <span>Tyre Age</span>
            </div>

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
                  >
                    <span className={styles.positionCell}>
                      {String(driver.position).padStart(2, '0')}
                    </span>
                    <span className={styles.driverCell}>
                      <span
                        className={styles.teamStripe}
                        style={{ backgroundColor: getTeamColor(driver.teamId) }}
                      />
                      <span className={styles.driverCode}>{abbreviateDriver(driver.name, driver.index)}</span>
                      <span className={styles.driverMeta}>
                        {getTeamName(driver.teamId)}
                        {player && driver.index === player.index && ' / YOU'}
                        {player && driver.index !== player.index && driver.teamId === player.teamId && ' / TEAM'}
                      </span>
                    </span>
                    <span className={styles.drsCell}>
                      <span className={driverHasDrs(driver) ? styles.drsActive : styles.drsInactive}>
                        DRS
                      </span>
                    </span>
                    <span className={styles.pitCell}>
                      <span className={styles[getPitStatusTone(driver, pitStatusVisible)]}>
                        {formatPitStatus(driver, pitStatusVisible)}
                      </span>
                    </span>
                    <span className={`${styles.ersCell} ${ersComparisonEnabled ? styles.ersCellCompare : ''}`}>
                      <span className={styles[getErsEstimateTone(driver)]}>{formatErsEstimate(driver)}</span>
                      {ersComparisonEnabled && (
                        <span className={styles.ersCompareMeta}>
                          {formatErsCompare(driver)}
                        </span>
                      )}
                    </span>
                    <span className={styles.topSpeedCell}>
                      <span className={styles[getTopSpeedTone(driver, topSpeedVisible)]}>
                        {formatTopSpeed(driver, topSpeedVisible)}
                      </span>
                    </span>
                    <span className={playerDeltaVisible ? styles.referenceGapPlayer : styles.referenceGapLeader}>
                      {formatReferenceGap(driver, player, playerDeltaVisible)}
                    </span>
                    <span>{formatInterval(driver)}</span>
                    <SectorDeltaCell driver={driver} sectorBestTimes={sectorBestTimes} />
                    <span>{formatLapTime(driver.lastLapTime)}</span>
                    <PenaltyCell driver={driver} />
                    <span className={styles.tyreCell}>
                      <span
                        className={styles.tyreDot}
                        style={{ backgroundColor: getTyreColor(driver.tireCompound) }}
                      />
                      {`${getTyreShortLabel(driver.tireCompound)} [${String(driver.tireAge).padStart(2, '0')}]`}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <div className={styles.sideRail}>
        <div className={`${styles.panel} ${styles.combatPanel}`}>
          <PanelTitle title="Combat Command" tone="secondary" />
          <BattleTarget
            label="Target Ahead"
            driver={carAhead}
            gapLabel={formatAheadGap(player)}
            paceLabel={formatPaceDelta(aheadAlert)}
            tone="tertiary"
          />
          <div className={styles.progressCard}>
            <div className={styles.progressHeader}>
              <span>DRS Status</span>
              <span className={styles.progressStatus}>
                {player && player.deltaToCarInFront != null && player.deltaToCarInFront <= 1000 ? 'ARMED' : 'LOCKED'}
              </span>
            </div>
            <div className={styles.progressTrack}>
              <div
                className={styles.progressFill}
                style={{ width: `${getDrsProgress(player)}%` }}
              />
            </div>
            <div className={styles.progressFooter}>
              <span>Laps to Combat</span>
              <strong>{formatCombatWindow(aheadAlert, player)}</strong>
            </div>
          </div>
          <BattleTarget
            label="Chaser Behind"
            driver={carBehind}
            gapLabel={formatBehindGap(carBehind)}
            paceLabel={formatPaceDelta(behindAlert)}
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
                      <strong>{Math.round(wheelSurfaceTemp[index])}°C</strong>
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
            <div className={styles.ersDial}>
              <div
                className={styles.ersDialRing}
                style={{ ['--ring-fill' as string]: `${ersPct}%` }}
              />
              <div className={styles.ersDialCenter}>
                <strong>{Math.round(ersPct)}%</strong>
                <span>{getErsModeLabel(player)}</span>
              </div>
            </div>

            <div className={styles.energyColumn}>
              <div className={styles.setupMetrics}>
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

              <div className={styles.splitPills}>
                <div className={styles.splitPill}>
                  <span>Deploy</span>
                  <strong>{deploySplit.deploy}%</strong>
                </div>
                <div className={styles.splitPill}>
                  <span>Harvest</span>
                  <strong>{deploySplit.harvest}%</strong>
                </div>
              </div>

              <div className={styles.energyMetrics}>
                <MetricTile
                  label="Fuel at Finish"
                  value={fuelMargin}
                  tone={fuelMargin.startsWith('-') ? 'secondary' : 'tertiary'}
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
              <span>Telemetry feed will populate this cockpit automatically.</span>
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
              <span className={styles.weatherRibbonTime}>{formatForecastLabel(forecast.timeOffset)}</span>
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

function PenaltyCell({ driver }: { driver: DriverInfo }) {
  const warnings = driver.totalWarnings ?? 0;
  const timePen = driver.penalties ?? 0;
  const dt = driver.numUnservedDriveThroughs ?? 0;
  const sg = driver.numUnservedStopGoPenalties ?? 0;
  const hasPenalty = warnings > 0 || timePen > 0 || dt > 0 || sg > 0;

  if (!hasPenalty) {
    return <span className={styles.penaltyCell}>--</span>;
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
    <span className={styles.penaltyCell} title={details.join('\n')}>
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
  driver,
  sectorBestTimes,
}: {
  driver: DriverInfo;
  sectorBestTimes: SectorBestTimes;
}) {
  const sectorTimes = getDriverSectorTimes(driver);

  return (
    <span className={styles.sectorCell}>
      {SECTOR_LABELS.map((label, index) => {
        const sectorTime = sectorTimes[index];
        const bestTime = sectorBestTimes[index];
        const delta = sectorTime > 0 && bestTime > 0 ? sectorTime - bestTime : null;
        const title = sectorTime > 0 ? `${label} ${formatLapTime(sectorTime)}` : `${label} pending`;

        return (
          <span
            key={label}
            className={`${styles.sectorChip} ${styles[getSectorDeltaTone(delta)]}`}
            title={title}
          >
            <span className={styles.sectorChipLabel}>{label}</span>
            <span className={styles.sectorChipValue}>{formatSectorDelta(delta)}</span>
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

function formatAheadGap(player: DriverInfo | null): string {
  if (player?.deltaToCarInFront == null || player.deltaToCarInFront <= 0) return '--';
  return `-${(player.deltaToCarInFront / 1000).toFixed(2)}s`;
}

function formatBehindGap(carBehind: DriverInfo | null): string {
  if (carBehind?.deltaToCarInFront == null || carBehind.deltaToCarInFront <= 0) return '--';
  return `+${(carBehind.deltaToCarInFront / 1000).toFixed(2)}s`;
}

function formatPaceDelta(value?: { closingRatePerLap: number } | null): string {
  if (!value || value.closingRatePerLap === 0) return '0.00s';
  return `${value.closingRatePerLap > 0 ? '-' : '+'}${Math.abs(value.closingRatePerLap).toFixed(2)}s`;
}

function formatCombatWindow(alert: { gapSeconds: number; closingRatePerLap: number } | undefined, player: DriverInfo | null): string {
  if (!alert || alert.closingRatePerLap <= 0 || !player) return '--';
  const laps = alert.gapSeconds / Math.max(alert.closingRatePerLap, 0.1);
  return laps.toFixed(1);
}

function formatSectorDelta(deltaMs: number | null): string {
  if (deltaMs == null) return '--';
  return formatDelta(deltaMs);
}

function getSectorDeltaTone(deltaMs: number | null): SectorDeltaTone {
  if (deltaMs == null) return 'sectorPending';
  if (deltaMs <= 0) return 'sectorBest';
  if (deltaMs <= 250) return 'sectorGood';
  return 'sectorSlow';
}

function getSectorBestTimes(drivers: DriverInfo[]): SectorBestTimes {
  const bestTimes: SectorBestTimes = [0, 0, 0];

  drivers.forEach((driver) => {
    const sectorTimes = getDriverSectorTimes(driver);
    sectorTimes.forEach((sectorTime, index) => {
      if (sectorTime <= 0) return;
      if (bestTimes[index] === 0 || sectorTime < bestTimes[index]) {
        bestTimes[index] = sectorTime;
      }
    });
  });

  return bestTimes;
}

function getDriverSectorTimes(driver: DriverInfo): SectorBestTimes {
  return [
    normalizeSectorTime(driver.sector1TimeMs),
    normalizeSectorTime(driver.sector2TimeMs),
    getDriverSector3TimeMs(driver),
  ];
}

function getDriverSector3TimeMs(driver: DriverInfo): number {
  const lapTime = Math.round(driver.lastLapTime ?? 0);
  const sector1 = normalizeSectorTime(driver.sector1TimeMs);
  const sector2 = normalizeSectorTime(driver.sector2TimeMs);

  if (lapTime <= 0 || sector1 <= 0 || sector2 <= 0) {
    return 0;
  }

  const sector3 = lapTime - sector1 - sector2;
  if (sector3 <= 0 || sector3 >= lapTime) {
    return 0;
  }

  return sector3;
}

function normalizeSectorTime(value: number | undefined): number {
  if (!value || value <= 0) return 0;
  return Math.round(value);
}

function driverHasDrs(driver: DriverInfo): boolean {
  return (driver.deltaToCarInFront ?? 0) > 0 && (driver.deltaToCarInFront ?? 0) <= 1000;
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

function getConnectionLabel(state: 'connecting' | 'connected' | 'disconnected' | 'error'): string {
  if (state === 'connected') return 'Live feed connected';
  if (state === 'connecting') return 'Connecting telemetry';
  if (state === 'error') return 'Telemetry error';
  return 'Feed offline';
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
  const mode = player?.ersDeployMode ?? 0;
  if (mode >= 3) return 'Overtake';
  if (mode === 2) return 'Balanced';
  if (mode === 1) return 'Build';
  return 'Standby';
}

function formatErsEstimate(driver: DriverInfo): string {
  if (!driver.ersEstimateReady) return '--';
  return `${driver.ersEstimatePct}%`;
}

function formatErsCompare(driver: DriverInfo): string {
  if (!driver.ersActualReady) return 'A--';
  const delta = driver.ersEstimateReady ? driver.ersEstimatePct - driver.ersActualPct : null;
  if (delta == null) return `A${driver.ersActualPct}%`;
  const sign = delta > 0 ? '+' : '';
  return `A${driver.ersActualPct}% Δ${sign}${delta}`;
}

function getErsEstimateTone(driver: DriverInfo): 'ersHigh' | 'ersMedium' | 'ersLow' | 'ersPending' {
  if (!driver.ersEstimateReady) return 'ersPending';
  if (driver.ersEstimatePct >= 65) return 'ersHigh';
  if (driver.ersEstimatePct >= 35) return 'ersMedium';
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

function getDrsProgress(player: DriverInfo | null): number {
  if (!player?.deltaToCarInFront || player.deltaToCarInFront <= 0) return 0;
  return clamp(100 - (player.deltaToCarInFront / 1000) * 100, 0, 100);
}

function formatForecastLabel(offsetMinutes: number): string {
  if (offsetMinutes <= 0) return 'NOW';
  return `+${offsetMinutes}M`;
}


function getDamageTone(value: number): 'tertiary' | 'primary' | 'secondary' {
  if (value >= 20) return 'secondary';
  if (value >= 5) return 'primary';
  return 'tertiary';
}
