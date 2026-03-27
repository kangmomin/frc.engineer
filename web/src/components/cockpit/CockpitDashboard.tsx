import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { getTeamColor, getTeamName } from '../../constants/teamColors';
import { getTyreColor, getTyreShortLabel, getWearStatusColor } from '../../constants/tyreCompounds';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import { useTelemetryStore } from '../../store/telemetryStore';
import type {
  DriverInfo,
  RaceControlNotification,
  SessionInfo,
  TireWearDisplayMode,
  WeatherForecast,
} from '../../types/telemetry';
import { clamp, formatLapTime } from '../../utils/formatters';
import styles from './CockpitDashboard.module.css';

const MAX_ERS_ENERGY = 4_000_000;
const WHEEL_LABELS = ['FL', 'FR', 'RL', 'RR'] as const;
const DEFAULT_PREDICTION_LAPS = 10;

interface CockpitDashboardProps {
  onOpenSettings: () => void;
  showSettingsButton: boolean;
  remoteAction?: {
    label: string;
    onClick: () => void;
    active?: boolean;
  };
}

export function CockpitDashboard({
  onOpenSettings,
  showSettingsButton,
  remoteAction,
}: CockpitDashboardProps) {
  const {
    pitwallState,
    battleAlerts,
    raceControlNotifications,
    connectionState,
    playbackActive,
  } = useTelemetryStore(
    useShallow((state) => ({
      pitwallState: state.pitwallState,
      battleAlerts: state.battleAlerts,
      raceControlNotifications: state.raceControlNotifications,
      connectionState: state.connectionState,
      playbackActive: state.playbackActive,
    })),
  );

  const session = pitwallState?.session ?? null;
  const playerIndex = pitwallState?.playerIndex ?? -1;

  const drivers = useMemo(
    () => [...(pitwallState?.drivers ?? [])].sort((a, b) => a.position - b.position),
    [pitwallState?.drivers],
  );

  const player = useMemo(
    () => drivers.find((driver) => driver.index === playerIndex) ?? null,
    [drivers, playerIndex],
  );

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
  const damageReadouts = [
    { label: 'Front Left', value: player?.damage?.frontLeftWing ?? 0 },
    { label: 'Front Right', value: player?.damage?.frontRightWing ?? 0 },
    { label: 'Floor', value: player?.damage?.floor ?? 0 },
    { label: 'Diffuser', value: player?.damage?.diffuser ?? 0 },
    { label: 'Sidepod', value: player?.damage?.sidepod ?? 0 },
    { label: 'Rear Wing', value: player?.damage?.rearWing ?? 0 },
  ];

  return (
    <div className={styles.dashboard}>
      <div className={styles.backdropGlow} />

      {(showSettingsButton || remoteAction) && (
        <div className={styles.utilityDock}>
          {showSettingsButton && (
            <button
              type="button"
              className={styles.settingsButton}
              onClick={onOpenSettings}
              aria-label="Open settings"
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
              <span>Gap</span>
              <span>Interval</span>
              <span>Last Lap</span>
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
                    <span>{formatGap(driver)}</span>
                    <span>{formatInterval(driver)}</span>
                    <span>{formatLapTime(driver.lastLapTime)}</span>
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
          <PanelTitle title="Pit Strategy" tone="primary" />
          <div className={styles.strategyRow}>
            <span>Target Tyre</span>
            <strong style={{ color: getTyreColor(recommendedTyre) }}>
              {recommendedTyre.toUpperCase()} ({getTyreShortLabel(recommendedTyre)})
            </strong>
          </div>
          <div className={styles.metricGrid}>
            <MetricTile
              label="Est. Exit Pos"
              value={session?.pitStopRejoinPosition ? `P${session.pitStopRejoinPosition}` : '--'}
              tone="primary"
            />
            <MetricTile
              label="Pit Window"
              value={pitWindow.label}
              tone={pitWindow.tone}
            />
          </div>
          <div className={styles.trafficCard}>
            <span className={styles.trafficLabel}>Traffic Status</span>
            <div className={styles.trafficValueRow}>
              <strong className={styles.trafficValue}>{trafficStatus.label}</strong>
              <span>{trafficStatus.detail}</span>
            </div>
            <div className={styles.trafficMeter}>
              <div
                className={styles.trafficMeterFill}
                style={{ width: `${trafficStatus.meter}%` }}
              />
            </div>
          </div>
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
              const tempTone = getTemperatureTone(wheelCoreTemp[index]);
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
                        {getTemperatureStatus(wheelCoreTemp[index])}
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
          </div>
        </div>
      )}
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

function formatInterval(driver: DriverInfo): string {
  if (driver.position === 1) return '---';
  if (driver.deltaToCarInFront == null || driver.deltaToCarInFront <= 0) return '--';
  return `+${(driver.deltaToCarInFront / 1000).toFixed(3)}`;
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

function driverHasDrs(driver: DriverInfo): boolean {
  return (driver.deltaToCarInFront ?? 0) > 0 && (driver.deltaToCarInFront ?? 0) <= 1000;
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

function getTemperatureTone(temp: number): 'tertiary' | 'primary' | 'secondary' {
  if (temp >= 110) return 'secondary';
  if (temp >= 95) return 'tertiary';
  return 'primary';
}

function getTemperatureStatus(temp: number): string {
  if (temp >= 110) return 'HIGH TEMP';
  if (temp >= 95) return 'CORE OK';
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
