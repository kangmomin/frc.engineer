import { useEffect, useMemo, useState } from 'react';
import type { CarDamage, DriverInfo, SessionInfo } from '../../../types/telemetry';
import { formatLapTime, formatPosition } from '../../../utils/formatters';
import { SectionHeader } from '../shared/SectionHeader';
import { useTelemetryStore } from '../../../store/telemetryStore';
import styles from './StrategyHealthSection.module.css';

const STANDARD_PIT_LOSS_SECONDS = 22;
const REDUCED_PIT_LOSS_SECONDS = 13;
const DEFAULT_GAP_SECONDS = 1.5;
const CLEAN_AIR_MIN_GAP = 1.8;
const DAMAGE_SMOOTHING_FACTOR = 0.35;

type DamageValueKey =
  | 'frontLeftWing'
  | 'frontRightWing'
  | 'rearWing'
  | 'floor'
  | 'diffuser'
  | 'sidepod'
  | 'engine'
  | 'gearbox';

type SafetyCarMode = 'green' | 'sc' | 'vsc' | 'formation' | 'unknown';

interface StableHealthSnapshot extends Record<DamageValueKey, number> {
  drsFault: boolean;
  ersFault: boolean;
  tyreWear: number[];
}

interface RejoinTargetCar {
  name: string;
  position: number;
  gapSeconds: number | null;
}

interface PitRejoinRadarState {
  currentPosition: number;
  predictedPosition: number;
  positionsLost: number;
  pitLossSeconds: number;
  trafficState: 'clean' | 'traffic';
  frontCar: RejoinTargetCar | null;
  rearCar: RejoinTargetCar | null;
  pitWindowText: string | null;
}

interface RivalMonitor {
  name: string;
  position: number;
  gapSeconds: number | null;
}

interface UndercutAlertState {
  active: boolean;
  label: string;
  statusText: string;
  action: 'COVER NOW (Box)' | 'STAY OUT';
  side: 'ahead' | 'behind' | null;
  rival: DriverInfo | null;
  gapSeconds: number | null;
  rivalProjectedPace: number;
  playerProjectedPace: number;
  paceDeltaMs: number;
  aheadMonitor: RivalMonitor | null;
  behindMonitor: RivalMonitor | null;
}

interface InterpolatedForecast {
  weather: string;
  rainPercentage: number;
  timeOffset: number;
}

interface CrossoverProjectionState {
  currentDeltaMs: number;
  predictedDeltaMs: number;
  effectiveTrendMsPerLap: number;
  weatherBiasMsPerLap: number;
  lapsAhead: number;
  minutesAhead: number;
  forecastWeather: string;
  forecastRainPercentage: number;
  action: string;
  actionTone: 'go' | 'watch' | 'hold';
  rationale: string;
  paybackLaps: number | null;
}

const DAMAGE_COMPONENTS: Array<{
  key: DamageValueKey;
  label: string;
  shortLabel: string;
}> = [
  { key: 'frontLeftWing', label: 'Front Left Wing', shortLabel: 'FL Wing' },
  { key: 'frontRightWing', label: 'Front Right Wing', shortLabel: 'FR Wing' },
  { key: 'rearWing', label: 'Rear Wing', shortLabel: 'Rear Wing' },
  { key: 'floor', label: 'Floor', shortLabel: 'Floor' },
  { key: 'diffuser', label: 'Diffuser', shortLabel: 'Diffuser' },
  { key: 'sidepod', label: 'Sidepod', shortLabel: 'Sidepod' },
  { key: 'engine', label: 'Engine', shortLabel: 'Engine' },
  { key: 'gearbox', label: 'Gearbox', shortLabel: 'Gearbox' },
];

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function average(values: number[] | undefined): number {
  if (!values || values.length === 0) return 0;
  return values.reduce((sum, value) => sum + clampPercent(value), 0) / values.length;
}

function smoothValue(previous: number, next: number): number {
  const delta = next - previous;
  if (Math.abs(delta) < 0.5) {
    return next;
  }
  return previous + delta * DAMAGE_SMOOTHING_FACTOR;
}

function sanitizeTyreWear(values: number[] | undefined): number[] {
  const next: number[] = [];
  for (let i = 0; i < 4; i++) {
    next.push(clampPercent(values?.[i] ?? 0));
  }
  return next;
}

function useStableHealthSnapshot(damage: CarDamage | undefined, tyreWear: number[] | undefined) {
  const [snapshot, setSnapshot] = useState<StableHealthSnapshot | null>(null);

  useEffect(() => {
    if (!damage) {
      setSnapshot(null);
      return;
    }

    const next: StableHealthSnapshot = {
      frontLeftWing: clampPercent(damage.frontLeftWing),
      frontRightWing: clampPercent(damage.frontRightWing),
      rearWing: clampPercent(damage.rearWing),
      floor: clampPercent(damage.floor),
      diffuser: clampPercent(damage.diffuser),
      sidepod: clampPercent(damage.sidepod),
      engine: clampPercent(damage.engine),
      gearbox: clampPercent(damage.gearbox),
      drsFault: damage.drsFault,
      ersFault: damage.ersFault,
      tyreWear: sanitizeTyreWear(tyreWear),
    };

    setSnapshot((previous) => {
      if (!previous) return next;

      return {
        frontLeftWing: smoothValue(previous.frontLeftWing, next.frontLeftWing),
        frontRightWing: smoothValue(previous.frontRightWing, next.frontRightWing),
        rearWing: smoothValue(previous.rearWing, next.rearWing),
        floor: smoothValue(previous.floor, next.floor),
        diffuser: smoothValue(previous.diffuser, next.diffuser),
        sidepod: smoothValue(previous.sidepod, next.sidepod),
        engine: smoothValue(previous.engine, next.engine),
        gearbox: smoothValue(previous.gearbox, next.gearbox),
        drsFault: next.drsFault,
        ersFault: next.ersFault,
        tyreWear: next.tyreWear.map((value, index) => smoothValue(previous.tyreWear[index] ?? value, value)),
      };
    });
  }, [damage, tyreWear]);

  return snapshot;
}

function getSafetyCarMode(safetyCar: string | undefined): SafetyCarMode {
  switch (safetyCar) {
    case 'full':
      return 'sc';
    case 'virtual':
      return 'vsc';
    case 'formation':
      return 'formation';
    case 'none':
      return 'green';
    default:
      return safetyCar ? 'unknown' : 'green';
  }
}

function isReducedPitLossMode(mode: SafetyCarMode): boolean {
  return mode === 'sc' || mode === 'vsc';
}

function getPitLossSeconds(mode: SafetyCarMode): number {
  return isReducedPitLossMode(mode) ? REDUCED_PIT_LOSS_SECONDS : STANDARD_PIT_LOSS_SECONDS;
}

function getGapSeconds(ms: number | undefined): number | null {
  if (!Number.isFinite(ms) || ms === undefined || ms <= 0) return null;
  return ms / 1000;
}

function buildGapLookup(driver: DriverInfo, sortedDrivers: DriverInfo[]): Map<number, number> {
  const lookup = new Map<number, number>();
  let cumulativeGap = 0;

  for (const other of sortedDrivers) {
    if (other.position <= driver.position) continue;
    const gapSeconds = getGapSeconds(other.deltaToCarInFront) ?? DEFAULT_GAP_SECONDS;
    cumulativeGap += gapSeconds;
    lookup.set(other.position, cumulativeGap);
  }

  return lookup;
}

function calculatePitRejoinRadar(
  driver: DriverInfo,
  drivers: DriverInfo[],
  session: SessionInfo | null,
): PitRejoinRadarState | null {
  if (driver.position <= 0 || drivers.length === 0) return null;

  const sortedDrivers = [...drivers]
    .filter((item) => item.position > 0)
    .sort((a, b) => a.position - b.position);
  const mode = getSafetyCarMode(session?.safetyCar);
  const pitLossSeconds = getPitLossSeconds(mode);
  const gapLookup = buildGapLookup(driver, sortedDrivers);
  let estimatedPosition = driver.position;

  for (const other of sortedDrivers) {
    if (other.position <= driver.position) continue;
    const cumulativeGap = gapLookup.get(other.position);
    if (cumulativeGap !== undefined && cumulativeGap < pitLossSeconds) {
      estimatedPosition++;
    }
  }

  if (session?.pitStopRejoinPosition && session.pitStopRejoinPosition > 0) {
    estimatedPosition = session.pitStopRejoinPosition;
  }

  estimatedPosition = Math.min(sortedDrivers.length, Math.max(1, estimatedPosition));

  const frontCandidate =
    estimatedPosition <= 1
      ? null
      : sortedDrivers.find((item) =>
          estimatedPosition > driver.position
            ? item.position === estimatedPosition
            : item.position === estimatedPosition - 1,
        ) ?? null;
  const rearCandidate =
    estimatedPosition >= sortedDrivers.length
      ? null
      : sortedDrivers.find((item) => item.position === estimatedPosition + 1) ?? null;

  let frontGap: number | null = null;
  if (frontCandidate) {
    if (frontCandidate.position > driver.position) {
      const targetGap = gapLookup.get(frontCandidate.position);
      frontGap = targetGap != null ? Math.max(0, pitLossSeconds - targetGap) : null;
    } else {
      frontGap = getGapSeconds(driver.deltaToCarInFront);
    }
  }

  let rearGap: number | null = null;
  if (rearCandidate && rearCandidate.position > driver.position) {
    const targetGap = gapLookup.get(rearCandidate.position);
    rearGap = targetGap != null ? Math.max(0, targetGap - pitLossSeconds) : null;
  }

  const availableGaps = [frontGap, rearGap].filter((value): value is number => value != null);
  const trafficState = availableGaps.length === 0 || Math.min(...availableGaps) >= CLEAN_AIR_MIN_GAP
    ? 'clean'
    : 'traffic';

  let pitWindowText: string | null = null;
  if (
    session?.pitStopWindowIdealLap &&
    session?.pitStopWindowLatestLap &&
    session.pitStopWindowLatestLap >= session.pitStopWindowIdealLap
  ) {
    pitWindowText = `WINDOW L${session.pitStopWindowIdealLap}-${session.pitStopWindowLatestLap}`;
  }

  return {
    currentPosition: driver.position,
    predictedPosition: estimatedPosition,
    positionsLost: Math.max(0, estimatedPosition - driver.position),
    pitLossSeconds,
    trafficState,
    frontCar: frontCandidate
      ? {
          name: frontCandidate.name,
          position: frontCandidate.position,
          gapSeconds: frontGap,
        }
      : null,
    rearCar: rearCandidate
      ? {
          name: rearCandidate.name,
          position: rearCandidate.position,
          gapSeconds: rearGap,
        }
      : null,
    pitWindowText,
  };
}

function isPitCycleRival(driver: DriverInfo | null): driver is DriverInfo {
  if (!driver) return false;
  if (driver.pitStatus > 0) return true;
  return driver.numPitStops > 0 && driver.tireAge <= 1;
}

function selectBaselineLap(driver: DriverInfo): number {
  if (driver.lastLapTime > 0) return driver.lastLapTime;
  if (driver.bestLapTime > 0) return driver.bestLapTime;
  return 90_000;
}

function getFreshTyreGain(compound: string): number {
  switch (compound) {
    case 'soft':
      return 700;
    case 'medium':
      return 550;
    case 'hard':
      return 350;
    case 'inter':
      return 500;
    case 'wet':
      return 400;
    default:
      return 450;
  }
}

function estimateCurrentPace(driver: DriverInfo): number {
  const baseline = selectBaselineLap(driver);
  const avgWear = average(driver.tireWear);
  const wearPenalty = Math.max(0, avgWear - 25) * 22;
  const agePenalty = Math.max(0, driver.tireAge - 8) * 45;
  return Math.round(baseline + wearPenalty + agePenalty);
}

function estimateFreshPace(driver: DriverInfo): number {
  const baseline = driver.bestLapTime > 0 ? driver.bestLapTime : selectBaselineLap(driver);
  return Math.max(0, Math.round(baseline - getFreshTyreGain(driver.tireCompound)));
}

function buildRivalMonitor(name: DriverInfo | null, gapSeconds: number | null): RivalMonitor | null {
  if (!name) return null;
  return {
    name: name.name,
    position: name.position,
    gapSeconds,
  };
}

function buildUndercutAlert(player: DriverInfo, drivers: DriverInfo[]): UndercutAlertState {
  const sortedDrivers = [...drivers]
    .filter((item) => item.position > 0)
    .sort((a, b) => a.position - b.position);
  const driverAhead = sortedDrivers.find((item) => item.position === player.position - 1) ?? null;
  const driverBehind = sortedDrivers.find((item) => item.position === player.position + 1) ?? null;
  const aheadGap = getGapSeconds(player.deltaToCarInFront);
  const behindGap = getGapSeconds(driverBehind?.deltaToCarInFront);
  const activeRival = isPitCycleRival(driverBehind)
    ? driverBehind
    : isPitCycleRival(driverAhead)
      ? driverAhead
      : null;

  if (!activeRival) {
    return {
      active: false,
      label: 'RIVALS STABLE',
      statusText: 'No immediate pit-cycle threat on adjacent positions.',
      action: 'STAY OUT',
      side: null,
      rival: null,
      gapSeconds: null,
      rivalProjectedPace: 0,
      playerProjectedPace: 0,
      paceDeltaMs: 0,
      aheadMonitor: buildRivalMonitor(driverAhead, aheadGap),
      behindMonitor: buildRivalMonitor(driverBehind, behindGap),
    };
  }

  const side = activeRival.position > player.position ? 'behind' : 'ahead';
  const gapSeconds = side === 'behind' ? getGapSeconds(activeRival.deltaToCarInFront) : aheadGap;
  const playerProjectedPace = estimateCurrentPace(player);
  const rivalProjectedPace = estimateFreshPace(activeRival);
  const paceDeltaMs = playerProjectedPace - rivalProjectedPace;
  const playerWear = average(player.tireWear);
  const shouldCover = side === 'behind'
    ? paceDeltaMs > Math.max(550, (gapSeconds ?? 0) * 750) || (playerWear >= 60 && (gapSeconds ?? 99) < 3.5)
    : paceDeltaMs > 1_100 && (gapSeconds ?? 99) < 1.8 && playerWear >= 55;

  return {
    active: true,
    label: side === 'behind' ? 'UNDERCUT THREAT' : 'TARGET ALERT',
    statusText: activeRival.pitStatus > 0 ? 'Rival in pit sequence' : 'Rival on fresh out-lap',
    action: shouldCover ? 'COVER NOW (Box)' : 'STAY OUT',
    side,
    rival: activeRival,
    gapSeconds,
    rivalProjectedPace,
    playerProjectedPace,
    paceDeltaMs,
    aheadMonitor: buildRivalMonitor(driverAhead, aheadGap),
    behindMonitor: buildRivalMonitor(driverBehind, behindGap),
  };
}

function formatDriverName(name: string, index: number): string {
  const trimmed = name?.trim() ?? '';
  if (!trimmed) return `CAR ${index}`;
  return trimmed;
}

function formatGap(seconds: number | null, invert = false): string {
  if (seconds == null) return '--';
  const sign = invert ? '-' : '+';
  return `${sign}${seconds.toFixed(1)}s`;
}

function formatPaceDelta(ms: number): string {
  if (!Number.isFinite(ms) || ms === 0) return '0.000s';
  const prefix = ms > 0 ? '-' : '+';
  return `${prefix}${(Math.abs(ms) / 1000).toFixed(3)}s`;
}

function formatCompoundLabel(compound: string | undefined): string {
  const normalized = (compound ?? '').trim().toLowerCase();
  if (!normalized) return 'UNKNOWN';
  if (normalized === 'slick') return 'SLICK';
  if (normalized === 'inter') return 'INTER';
  if (normalized === 'wet') return 'WET';
  return normalized.toUpperCase();
}

function getCompoundTrackGroup(compound: string | undefined): 'dry' | 'wet' | 'unknown' {
  switch ((compound ?? '').toLowerCase()) {
    case 'soft':
    case 'medium':
    case 'hard':
    case 'slick':
      return 'dry';
    case 'inter':
    case 'wet':
      return 'wet';
    default:
      return 'unknown';
  }
}

function formatWeatherLabel(weather: string | undefined): string {
  return (weather ?? 'unknown').replace(/_/g, ' ').toUpperCase();
}

function formatLapEdge(ms: number): string {
  return `${(Math.abs(ms) / 1000).toFixed(1)}s/lap`;
}

function describeAdvantage(deltaMs: number, dryLabel: string, wetLabel: string): string {
  if (!Number.isFinite(deltaMs) || Math.abs(deltaMs) < 50) return 'PACE PARITY';
  if (deltaMs > 0) {
    return `${wetLabel} +${formatLapEdge(deltaMs)}`;
  }
  return `${dryLabel} +${formatLapEdge(deltaMs)}`;
}

function describeTrend(deltaMsPerLap: number, dryLabel: string, wetLabel: string): string {
  if (!Number.isFinite(deltaMsPerLap) || Math.abs(deltaMsPerLap) < 50) return 'Stable crossover trend';
  if (deltaMsPerLap > 0) {
    return `${wetLabel} gaining ${formatLapEdge(deltaMsPerLap)}`;
  }
  return `${dryLabel} gaining ${formatLapEdge(deltaMsPerLap)}`;
}

function getWeatherSeverityScore(weather: string | undefined, rainPercentage: number): number {
  const normalized = (weather ?? '').toLowerCase();
  const rainScore = Math.max(0, Math.min(100, rainPercentage)) / 100;

  switch (normalized) {
    case 'clear':
      return Math.max(0, rainScore * 0.2);
    case 'light_cloud':
      return Math.max(0.05, rainScore * 0.3);
    case 'overcast':
      return Math.max(0.15, rainScore * 0.45);
    case 'light_rain':
      return Math.max(0.55, rainScore * 0.8);
    case 'heavy_rain':
      return Math.max(0.95, rainScore);
    case 'storm':
      return Math.max(1.2, rainScore * 1.15);
    default:
      return rainScore;
  }
}

function interpolateForecastSample(
  forecasts: SessionInfo['weatherForecast'] | undefined,
  minutesAhead: number,
  fallbackWeather: string | undefined,
  fallbackRainPercentage = 0,
): InterpolatedForecast {
  const samples = [...(forecasts ?? [])]
    .filter((sample) => Number.isFinite(sample.timeOffset))
    .sort((a, b) => a.timeOffset - b.timeOffset);

  if (samples.length === 0) {
    return {
      weather: fallbackWeather ?? 'unknown',
      rainPercentage: fallbackRainPercentage,
      timeOffset: Math.max(0, minutesAhead),
    };
  }

  if (minutesAhead <= samples[0].timeOffset) {
    return {
      weather: samples[0].weather,
      rainPercentage: samples[0].rainPercentage,
      timeOffset: samples[0].timeOffset,
    };
  }

  for (let i = 1; i < samples.length; i++) {
    const upper = samples[i];
    const lower = samples[i - 1];
    if (minutesAhead > upper.timeOffset) continue;

    const span = upper.timeOffset - lower.timeOffset;
    const ratio = span > 0 ? (minutesAhead - lower.timeOffset) / span : 0;
    const rainPercentage = lower.rainPercentage + (upper.rainPercentage - lower.rainPercentage) * ratio;

    return {
      weather: ratio < 0.5 ? lower.weather : upper.weather,
      rainPercentage,
      timeOffset: minutesAhead,
    };
  }

  const last = samples[samples.length - 1];
  return {
    weather: last.weather,
    rainPercentage: last.rainPercentage,
    timeOffset: last.timeOffset,
  };
}

function calculateCrossoverProjection(
  driver: DriverInfo,
  session: SessionInfo,
  lapsAhead: number,
  pitLossSeconds: number,
): CrossoverProjectionState | null {
  const model = session.crossoverPrediction;
  if (!model?.available) return null;

  const clampedLapsAhead = Math.max(1, Math.min(10, Math.round(lapsAhead)));
  const avgLapTimeMs = model.avgLapTimeMs > 0 ? model.avgLapTimeMs : selectBaselineLap(driver);
  const minutesAhead = (avgLapTimeMs * clampedLapsAhead) / 60_000;
  const baselineForecast = interpolateForecastSample(
    session.weatherForecast,
    0,
    session.weather,
  );
  const targetForecast = interpolateForecastSample(
    session.weatherForecast,
    minutesAhead,
    session.weather,
    baselineForecast.rainPercentage,
  );
  const currentSeverity = getWeatherSeverityScore(session.weather, baselineForecast.rainPercentage);
  const futureSeverity = getWeatherSeverityScore(targetForecast.weather, targetForecast.rainPercentage);
  const weatherBiasMsPerLap = (futureSeverity - currentSeverity) * 1200;
  const effectiveTrendMsPerLap = model.trendDeltaMsPerLap + weatherBiasMsPerLap;
  const predictedDeltaMs = model.currentDeltaMs + effectiveTrendMsPerLap * clampedLapsAhead;
  const playerGroup = getCompoundTrackGroup(driver.tireCompound);
  const projectedEdgeMs = Math.abs(predictedDeltaMs);
  const paybackLaps = projectedEdgeMs >= 250 ? (pitLossSeconds * 1000) / projectedEdgeMs : null;
  const remainingLaps = session.totalLaps > 0 ? Math.max(0, session.totalLaps - driver.currentLapNum) : null;

  let action = 'STAY OUT';
  let actionTone: CrossoverProjectionState['actionTone'] = 'hold';
  let rationale = 'No decisive crossover edge yet.';

  if (predictedDeltaMs > 700 && playerGroup === 'dry') {
    action = model.currentDeltaMs > 250 || clampedLapsAhead <= 2
      ? `BOX THIS LAP FOR ${formatCompoundLabel(model.wetGroup)}`
      : `BOX NEXT LAP FOR ${formatCompoundLabel(model.wetGroup)}`;
    actionTone = projectedEdgeMs > 1800 ? 'go' : 'watch';
    rationale = `${formatCompoundLabel(model.wetGroup)} crossover building as rain intensity increases.`;
  } else if (predictedDeltaMs < -700 && playerGroup === 'wet') {
    action = model.currentDeltaMs < -250 || clampedLapsAhead <= 2
      ? 'BOX THIS LAP FOR SLICKS'
      : 'PREPARE SLICKS';
    actionTone = projectedEdgeMs > 1800 ? 'go' : 'watch';
    rationale = 'Track is drying enough for slick crossover risk.';
  } else if (Math.abs(effectiveTrendMsPerLap) > 700 && projectedEdgeMs > 500) {
    action = 'MONITOR WINDOW';
    actionTone = 'watch';
    rationale = predictedDeltaMs > 0
      ? `${formatCompoundLabel(model.wetGroup)} tyres are taking over quickly.`
      : 'Slick pace is recovering quickly.';
  }

  if (paybackLaps != null && remainingLaps != null && paybackLaps > remainingLaps && actionTone !== 'go') {
    action = 'STAY OUT';
    actionTone = 'hold';
    rationale = 'Projected gain does not repay pit loss before the finish.';
  }

  return {
    currentDeltaMs: model.currentDeltaMs,
    predictedDeltaMs,
    effectiveTrendMsPerLap,
    weatherBiasMsPerLap,
    lapsAhead: clampedLapsAhead,
    minutesAhead,
    forecastWeather: targetForecast.weather,
    forecastRainPercentage: targetForecast.rainPercentage,
    action,
    actionTone,
    rationale,
    paybackLaps,
  };
}

function getDamageLevel(value: number): 'safe' | 'warning' | 'danger' {
  if (value < 20) return 'safe';
  if (value <= 50) return 'warning';
  return 'danger';
}

function getDamageColor(value: number): string {
  if (value < 20) return 'var(--accent-green)';
  if (value <= 50) return 'var(--accent-yellow)';
  return 'var(--accent-red)';
}

function FaultIndicator({ label, active }: { label: string; active: boolean }) {
  return (
    <div className={`${styles.faultIndicator} ${active ? styles.faultActive : ''}`}>
      <span className={styles.faultLabel}>{label}</span>
      <span className={styles.faultStatus}>{active ? 'FAULT' : 'OK'}</span>
    </div>
  );
}

function DamageBar({ label, value }: { label: string; value: number }) {
  const level = getDamageLevel(value);

  return (
    <div className={styles.damageItem}>
      <div className={styles.damageHeader}>
        <span className={styles.damageLabel}>{label}</span>
        <span className={`${styles.damageValue} ${styles[level]}`}>{value.toFixed(0)}%</span>
      </div>
      <div className={styles.damageBar}>
        <div
          className={styles.damageFill}
          style={{
            width: `${Math.min(100, value)}%`,
            backgroundColor: getDamageColor(value),
          }}
        />
      </div>
    </div>
  );
}

export function StrategyHealthSection() {
  const pitwallState = useTelemetryStore((state) => state.pitwallState);
  const drivers = pitwallState?.drivers ?? [];
  const session = pitwallState?.session ?? null;
  const driver = drivers.find((item) => item.index === pitwallState?.playerIndex) ?? null;
  const stableHealth = useStableHealthSnapshot(driver?.damage, driver?.tireWear);
  const [predictionLaps, setPredictionLaps] = useState(3);

  const pitRejoinRadar = useMemo(() => {
    if (!driver || drivers.length === 0) return null;
    return calculatePitRejoinRadar(driver, drivers, session);
  }, [driver, drivers, session]);

  const undercutAlert = useMemo(() => {
    if (!driver || drivers.length === 0) return null;
    return buildUndercutAlert(driver, drivers);
  }, [driver, drivers]);

  const crossoverProjection = useMemo(() => {
    if (!driver || !session) return null;
    return calculateCrossoverProjection(
      driver,
      session,
      predictionLaps,
      getPitLossSeconds(getSafetyCarMode(session.safetyCar)),
    );
  }, [driver, predictionLaps, session]);

  const safetyCarMode = getSafetyCarMode(session?.safetyCar);
  const strategyBannerActive = safetyCarMode === 'sc' || safetyCarMode === 'vsc';
  const rejoinToneClass = pitRejoinRadar
    ? pitRejoinRadar.trafficState === 'clean'
      ? styles.cleanAir
      : styles.trafficAir
    : '';
  const rejoinBadgeText = pitRejoinRadar
    ? pitRejoinRadar.trafficState === 'clean'
      ? 'CLEAN AIR'
      : 'TRAFFIC'
    : 'NO DATA';
  const rejoinBadgeClass = pitRejoinRadar
    ? pitRejoinRadar.trafficState === 'clean'
      ? styles.cardBadgeGreen
      : styles.cardBadgeRed
    : styles.cardBadgeBlue;

  const healthSummary = useMemo(() => {
    if (!stableHealth) return null;
    const aeroDamage = average([
      stableHealth.frontLeftWing,
      stableHealth.frontRightWing,
      stableHealth.rearWing,
      stableHealth.floor,
      stableHealth.diffuser,
      stableHealth.sidepod,
    ]);
    const powertrainDamage = average([stableHealth.engine, stableHealth.gearbox]);
    const overallDamage = average([
      stableHealth.frontLeftWing,
      stableHealth.frontRightWing,
      stableHealth.rearWing,
      stableHealth.floor,
      stableHealth.diffuser,
      stableHealth.sidepod,
      stableHealth.engine,
      stableHealth.gearbox,
    ]);
    const tyreWear = average(stableHealth.tyreWear);

    return {
      aeroDamage,
      powertrainDamage,
      overallDamage,
      tyreWear,
      allClear:
        overallDamage < 5 &&
        tyreWear < 5 &&
        !stableHealth.drsFault &&
        !stableHealth.ersFault,
    };
  }, [stableHealth]);

  return (
    <div className={styles.container}>
      <SectionHeader
        title="Strategy & Health"
        subtitle={
          session
            ? `${session.sessionType} | Lap ${driver?.currentLapNum ?? 0}/${session.totalLaps}`
            : undefined
        }
      />

      <div className={styles.content}>
        <div className={styles.strategySection}>
          {strategyBannerActive && (
            <div className={styles.scBanner}>
              <span className={styles.scBannerMode}>{safetyCarMode === 'vsc' ? 'VSC ACTIVE' : 'SC ACTIVE'}</span>
              <span className={styles.scBannerMessage}>PIT LOSS REDUCED - CONSIDER BOX STRATEGY</span>
            </div>
          )}

          <div
            className={`${styles.predictorCard} ${
              crossoverProjection
                ? crossoverProjection.predictedDeltaMs > 0
                  ? styles.predictorWetBias
                  : styles.predictorDryBias
                : styles.predictorNeutral
            }`}
          >
            <div className={styles.predictorHeader}>
              <div className={styles.predictorHeading}>
                <span className={styles.cardLabel}>CROSSOVER PREDICTOR</span>
                <span className={styles.predictorTitle}>
                  {session?.crossoverPrediction?.available
                    ? `${formatCompoundLabel(session.crossoverPrediction.wetGroup)} vs ${formatCompoundLabel(session.crossoverPrediction.dryGroup)}`
                    : 'Waiting for matched tyre data'}
                </span>
              </div>

              <label className={styles.predictorInputGroup}>
                <span className={styles.predictorInputLabel}>LOOK AHEAD</span>
                <div className={styles.predictorInputWrap}>
                  <input
                    className={styles.predictorInput}
                    type="number"
                    min={1}
                    max={10}
                    value={predictionLaps}
                    onChange={(event) => {
                      const next = Number.parseInt(event.target.value, 10);
                      setPredictionLaps(Number.isFinite(next) ? Math.max(1, Math.min(10, next)) : 1);
                    }}
                  />
                  <span className={styles.predictorInputUnit}>LAPS</span>
                </div>
              </label>
            </div>

            {crossoverProjection && session?.crossoverPrediction ? (
              <>
                <div className={styles.predictorGrid}>
                  <div className={styles.predictorStat}>
                    <span className={styles.predictorStatLabel}>CURRENT</span>
                    <span className={styles.predictorStatValue}>
                      {describeAdvantage(
                        crossoverProjection.currentDeltaMs,
                        formatCompoundLabel(session.crossoverPrediction.dryGroup),
                        formatCompoundLabel(session.crossoverPrediction.wetGroup),
                      )}
                    </span>
                  </div>

                  <div className={styles.predictorStat}>
                    <span className={styles.predictorStatLabel}>TREND</span>
                    <span className={styles.predictorStatValue}>
                      {describeTrend(
                        crossoverProjection.effectiveTrendMsPerLap,
                        formatCompoundLabel(session.crossoverPrediction.dryGroup),
                        formatCompoundLabel(session.crossoverPrediction.wetGroup),
                      )}
                    </span>
                  </div>

                  <div className={styles.predictorStat}>
                    <span className={styles.predictorStatLabel}>FORECAST @{crossoverProjection.lapsAhead}L</span>
                    <span className={styles.predictorStatValue}>
                      {describeAdvantage(
                        crossoverProjection.predictedDeltaMs,
                        formatCompoundLabel(session.crossoverPrediction.dryGroup),
                        formatCompoundLabel(session.crossoverPrediction.wetGroup),
                      )}
                    </span>
                  </div>
                </div>

                <div className={styles.predictorFooter}>
                  <div className={styles.predictorMeta}>
                    <span>
                      {formatWeatherLabel(crossoverProjection.forecastWeather)} {crossoverProjection.forecastRainPercentage.toFixed(0)}% rain in {crossoverProjection.minutesAhead.toFixed(1)} min
                    </span>
                    <span>
                      Samples {session.crossoverPrediction.drySampleCount}/{session.crossoverPrediction.wetSampleCount} | Model {session.crossoverPrediction.historyDepth} laps
                    </span>
                    {crossoverProjection.paybackLaps != null && (
                      <span>Payback {crossoverProjection.paybackLaps.toFixed(1)} laps</span>
                    )}
                  </div>

                  <div className={styles.predictorRecommendation}>
                    <span
                      className={`${styles.predictorAction} ${
                        crossoverProjection.actionTone === 'go'
                          ? styles.predictorActionGo
                          : crossoverProjection.actionTone === 'watch'
                            ? styles.predictorActionWatch
                            : styles.predictorActionHold
                      }`}
                    >
                      {crossoverProjection.action}
                    </span>
                    <span className={styles.predictorRationale}>{crossoverProjection.rationale}</span>
                  </div>
                </div>
              </>
            ) : (
              <div className={styles.predictorEmpty}>
                {session?.crossoverPrediction?.reason ?? 'Need both slick and inter/wet laps to build a crossover model.'}
              </div>
            )}
          </div>

          <div className={styles.assistGrid}>
            <div
              className={`${styles.assistCard} ${styles.rejoinCard} ${rejoinToneClass}`}
            >
              <div className={styles.cardHeader}>
                <span className={styles.cardLabel}>PIT REJOIN RADAR</span>
                <span className={`${styles.cardBadge} ${rejoinBadgeClass}`}>
                  {rejoinBadgeText}
                </span>
              </div>

              {pitRejoinRadar ? (
                <>
                  <div className={styles.rejoinMainRow}>
                    <div className={styles.positionStack}>
                      <span className={styles.positionCaption}>NOW</span>
                      <span className={styles.positionValue}>{formatPosition(pitRejoinRadar.currentPosition)}</span>
                    </div>
                    <span className={styles.positionArrow}>&rarr;</span>
                    <div className={styles.positionStack}>
                      <span className={styles.positionCaption}>BOX THIS LAP</span>
                      <span className={styles.positionValue}>{formatPosition(pitRejoinRadar.predictedPosition)}</span>
                    </div>
                    <div className={styles.rejoinMeta}>
                      <span className={styles.rejoinLossLabel}>Pit Loss</span>
                      <span className={styles.rejoinLossValue}>{pitRejoinRadar.pitLossSeconds.toFixed(1)}s</span>
                    </div>
                  </div>

                  <div className={styles.slotGrid}>
                    <div className={styles.slotCard}>
                      <span className={styles.slotLabel}>CAR AHEAD</span>
                      {pitRejoinRadar.frontCar ? (
                        <>
                          <span className={styles.slotName}>
                            {formatPosition(pitRejoinRadar.frontCar.position)} {formatDriverName(pitRejoinRadar.frontCar.name, pitRejoinRadar.frontCar.position)}
                          </span>
                          <span className={styles.slotGap}>{formatGap(pitRejoinRadar.frontCar.gapSeconds)}</span>
                        </>
                      ) : (
                        <span className={styles.slotName}>CLEAR TRACK</span>
                      )}
                    </div>

                    <div className={styles.slotCard}>
                      <span className={styles.slotLabel}>CAR BEHIND</span>
                      {pitRejoinRadar.rearCar ? (
                        <>
                          <span className={styles.slotName}>
                            {formatPosition(pitRejoinRadar.rearCar.position)} {formatDriverName(pitRejoinRadar.rearCar.name, pitRejoinRadar.rearCar.position)}
                          </span>
                          <span className={styles.slotGap}>{formatGap(pitRejoinRadar.rearCar.gapSeconds)}</span>
                        </>
                      ) : (
                        <span className={styles.slotName}>LAST CAR</span>
                      )}
                    </div>
                  </div>

                  <div className={styles.cardFooter}>
                    <span>{pitRejoinRadar.positionsLost > 0 ? `-${pitRejoinRadar.positionsLost} POSITIONS IF YOU BOX NOW` : 'POSITION HOLD IF YOU BOX NOW'}</span>
                    {pitRejoinRadar.pitWindowText && <span>{pitRejoinRadar.pitWindowText}</span>}
                  </div>
                </>
              ) : (
                <div className={styles.noData}>No strategy data available</div>
              )}
            </div>

            <div className={`${styles.assistCard} ${styles.alertCard} ${undercutAlert?.active ? styles.alertLive : styles.alertIdle}`}>
              <div className={styles.cardHeader}>
                <span className={styles.cardLabel}>UNDERCUT / TARGET ALERT</span>
                <span className={`${styles.cardBadge} ${undercutAlert?.active ? styles.cardBadgeRed : styles.cardBadgeBlue}`}>
                  {undercutAlert?.active ? undercutAlert.label : 'MONITOR'}
                </span>
              </div>

              {undercutAlert ? (
                <>
                  <div className={styles.alertTopRow}>
                    <div>
                      <span className={styles.alertTitle}>{undercutAlert.label}</span>
                      <span className={styles.alertSubtitle}>{undercutAlert.statusText}</span>
                    </div>
                    {undercutAlert.rival && (
                      <div className={styles.alertRivalMeta}>
                        <span className={styles.alertRivalName}>
                          {formatPosition(undercutAlert.rival.position)} {formatDriverName(undercutAlert.rival.name, undercutAlert.rival.index)}
                        </span>
                        <span className={styles.alertGap}>{formatGap(undercutAlert.gapSeconds, undercutAlert.side === 'behind')}</span>
                      </div>
                    )}
                  </div>

                  {undercutAlert.active ? (
                    <>
                      <div className={styles.paceCompare}>
                        <div className={styles.paceBlock}>
                          <span className={styles.paceLabel}>RIVAL NEW TYRE</span>
                          <span className={styles.paceValue}>{formatLapTime(undercutAlert.rivalProjectedPace)}</span>
                        </div>
                        <div className={styles.paceBlock}>
                          <span className={styles.paceLabel}>YOUR CURRENT STINT</span>
                          <span className={styles.paceValue}>{formatLapTime(undercutAlert.playerProjectedPace)}</span>
                        </div>
                      </div>

                      <div className={styles.alertActionRow}>
                        <span className={styles.paceDelta}>{formatPaceDelta(undercutAlert.paceDeltaMs)} / lap</span>
                        <span className={`${styles.actionText} ${undercutAlert.action.startsWith('COVER') ? styles.actionCritical : styles.actionHold}`}>
                          {undercutAlert.action}
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className={styles.monitorRow}>
                      {undercutAlert.aheadMonitor && (
                        <div className={styles.monitorChip}>
                          <span className={styles.monitorLabel}>AHEAD</span>
                          <span className={styles.monitorValue}>
                            {formatPosition(undercutAlert.aheadMonitor.position)} {formatDriverName(undercutAlert.aheadMonitor.name, undercutAlert.aheadMonitor.position)} {formatGap(undercutAlert.aheadMonitor.gapSeconds)}
                          </span>
                        </div>
                      )}
                      {undercutAlert.behindMonitor && (
                        <div className={styles.monitorChip}>
                          <span className={styles.monitorLabel}>BEHIND</span>
                          <span className={styles.monitorValue}>
                            {formatPosition(undercutAlert.behindMonitor.position)} {formatDriverName(undercutAlert.behindMonitor.name, undercutAlert.behindMonitor.position)} {formatGap(undercutAlert.behindMonitor.gapSeconds, true)}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div className={styles.noData}>No adjacent rivals available</div>
              )}
            </div>

            <div className={`${styles.assistCard} ${styles.scCard} ${strategyBannerActive ? styles.alertLive : styles.alertIdle}`}>
              <div className={styles.cardHeader}>
                <span className={styles.cardLabel}>SC / VSC WINDOW</span>
                <span className={`${styles.cardBadge} ${strategyBannerActive ? styles.cardBadgeYellow : styles.cardBadgeBlue}`}>
                  {safetyCarMode === 'vsc' ? 'VSC' : safetyCarMode === 'sc' ? 'SC' : 'GREEN'}
                </span>
              </div>

              <div className={styles.scCardContent}>
                <span className={styles.scState}>
                  {safetyCarMode === 'vsc'
                    ? 'VIRTUAL SAFETY CAR'
                    : safetyCarMode === 'sc'
                      ? 'SAFETY CAR'
                      : safetyCarMode === 'formation'
                        ? 'FORMATION LAP'
                        : 'TRACK GREEN'}
                </span>
                <span className={`${styles.scInstruction} ${strategyBannerActive ? styles.scInstructionBlink : ''}`}>
                  {strategyBannerActive
                    ? 'PIT LOSS REDUCED - CONSIDER BOX STRATEGY'
                    : 'Standard pit loss in effect. Wait for a cheaper window.'}
                </span>

                <div className={styles.scMetrics}>
                  <div className={styles.scMetric}>
                    <span className={styles.scMetricLabel}>CURRENT PIT LOSS</span>
                    <span className={styles.scMetricValue}>{getPitLossSeconds(safetyCarMode).toFixed(1)}s</span>
                  </div>
                  <div className={styles.scMetric}>
                    <span className={styles.scMetricLabel}>SAVING</span>
                    <span className={styles.scMetricValue}>
                      {(STANDARD_PIT_LOSS_SECONDS - getPitLossSeconds(safetyCarMode)).toFixed(1)}s
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className={styles.healthSection}>
          <div className={styles.healthHeader}>
            <span className={styles.healthLabel}>CAR HEALTH</span>
            {healthSummary?.allClear && <span className={styles.allClearBadge}>ALL CLEAR</span>}
          </div>

          {stableHealth && healthSummary ? (
            <div className={styles.healthContent}>
              <div className={styles.summaryGrid}>
                <div className={styles.summaryCard}>
                  <span className={styles.summaryLabel}>Overall</span>
                  <span className={`${styles.summaryValue} ${styles[getDamageLevel(healthSummary.overallDamage)]}`}>
                    {healthSummary.overallDamage.toFixed(0)}%
                  </span>
                </div>
                <div className={styles.summaryCard}>
                  <span className={styles.summaryLabel}>Aero</span>
                  <span className={`${styles.summaryValue} ${styles[getDamageLevel(healthSummary.aeroDamage)]}`}>
                    {healthSummary.aeroDamage.toFixed(0)}%
                  </span>
                </div>
                <div className={styles.summaryCard}>
                  <span className={styles.summaryLabel}>Powertrain</span>
                  <span className={`${styles.summaryValue} ${styles[getDamageLevel(healthSummary.powertrainDamage)]}`}>
                    {healthSummary.powertrainDamage.toFixed(0)}%
                  </span>
                </div>
                <div className={styles.summaryCard}>
                  <span className={styles.summaryLabel}>Tyres</span>
                  <span className={`${styles.summaryValue} ${styles[getDamageLevel(healthSummary.tyreWear)]}`}>
                    {healthSummary.tyreWear.toFixed(0)}%
                  </span>
                </div>
              </div>

              <div className={styles.faultRow}>
                <FaultIndicator label="DRS" active={stableHealth.drsFault} />
                <FaultIndicator label="ERS" active={stableHealth.ersFault} />
              </div>

              <div className={styles.damageGrid}>
                {DAMAGE_COMPONENTS.map((component) => (
                  <DamageBar
                    key={component.key}
                    label={component.shortLabel}
                    value={stableHealth[component.key]}
                  />
                ))}
              </div>
            </div>
          ) : (
            <div className={styles.noData}>No damage data available</div>
          )}
        </div>
      </div>
    </div>
  );
}
