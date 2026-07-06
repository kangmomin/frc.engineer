import type { DriverInfo } from '../../types/telemetry';

export interface TrySectorBaseline {
  s1: number;
  s2: number;
  s3: number;
}

export type TryLabel = 'TRY' | 'BUILD' | 'COOL';
export type TryTone = 'attack' | 'watch' | 'standby';

export interface DriverTryState {
  label: TryLabel;
  tone: TryTone;
  summary: string;
  score: number;
  sectorDelta1Ms: number | null;
  sectorDelta2Ms: number | null;
}

const TRY_SECTOR_MARGIN_MS = 250;
const TRY_COMBINED_MARGIN_MS = 400;
const RECENT_COMPETITIVE_LAP_MARGIN_MS = 1_200;
const ERS_DEPLOY_MARGIN_J = 120_000;
const TRY_MIN_ERS_PCT = 18;

function hasCompetitiveSector(deltaMs: number | null): boolean {
  return deltaMs != null && deltaMs <= TRY_SECTOR_MARGIN_MS;
}

function hasStrongSector(deltaMs: number | null): boolean {
  return deltaMs != null && deltaMs <= 100;
}

function formatSignedDelta(deltaMs: number): string {
  const seconds = Math.abs(deltaMs) / 1000;
  const sign = deltaMs <= 0 ? '-' : '+';
  return `${sign}${seconds.toFixed(3)}`;
}

function buildSectorDelta(currentMs: number, bestMs: number): number | null {
  // 유한성 가드(H1): sector1/2TimeMs는 Go DTO에서 omitempty라 완주 전에는 값이 0이 아니라
  // 필드 자체가 부재(undefined)한다. `undefined <= 0`은 false라 아래 가드를 그냥 통과해버리고
  // `undefined - bestMs`가 NaN을 반환해 My Lap Δ타일/summary/Try title에 "+NaN"이 표시되던
  // 버그를 막는다. NaN 등 비유한값도 동일하게 차단한다.
  if (!Number.isFinite(currentMs) || !Number.isFinite(bestMs) || currentMs <= 0 || bestMs <= 0) return null;
  return currentMs - bestMs;
}

function buildSummary(parts: string[]): string {
  if (parts.length === 0) return 'No live push signal';
  return parts.slice(0, 3).join(' | ');
}

function getErsModeLabel(driver: DriverInfo): string | null {
  switch (driver.ersDeployMode) {
    case 3:
      return 'ERS OVT';
    case 2:
      return 'ERS HOT';
    case 1:
      return 'ERS MED';
    default:
      return driver.ersActualReady ? `ERS ${driver.ersActualPct}%` : null;
  }
}

export function evaluateDriverTryState(
  driver: DriverInfo,
  baseline: TrySectorBaseline,
): DriverTryState {
  const sectorDelta1Ms = buildSectorDelta(driver.sector1TimeMs, baseline.s1);
  const sectorDelta2Ms = buildSectorDelta(driver.sector2TimeMs, baseline.s2);
  const combinedDeltaMs =
    driver.sector1TimeMs > 0
      && driver.sector2TimeMs > 0
      && baseline.s1 > 0
      && baseline.s2 > 0
      ? (driver.sector1TimeMs + driver.sector2TimeMs) - (baseline.s1 + baseline.s2)
      : null;

  const competitiveSectorCount = [sectorDelta1Ms, sectorDelta2Ms].filter(hasCompetitiveSector).length;
  const strongSectorCount = [sectorDelta1Ms, sectorDelta2Ms].filter(hasStrongSector).length;

  const isPit = driver.pitStatus !== 0;
  const isInvalid = driver.lapInvalid;
  const isGarage = driver.driverStatus === 0;
  const isInLap = driver.driverStatus === 2;
  const isOutLap = driver.driverStatus === 3;
  const isFlying = driver.driverStatus === 1;
  const isTrack = driver.driverStatus === 4;

  // 2026 모드에서는 overtakeActive가 DRS 신호를 대체한다 (omitempty라 false면 생략).
  const hasDrsSignal = driver.drsActivated || driver.overtakeActive === true;
  const hasAggressiveErsMode = driver.ersDeployMode >= 2;
  const isDeployingErs =
    driver.ersDeployedThisLap > 0
    && driver.ersDeployedThisLap >= driver.ersHarvestedThisLap + ERS_DEPLOY_MARGIN_J;
  const hasUsableErs = !driver.ersActualReady || driver.ersActualPct >= TRY_MIN_ERS_PCT;
  const recentCompetitiveLap =
    driver.lastLapTime > 0
    && driver.bestLapTime > 0
    && driver.lastLapTime <= driver.bestLapTime + RECENT_COMPETITIVE_LAP_MARGIN_MS;

  const sectorSignals: string[] = [];
  if (sectorDelta1Ms != null) sectorSignals.push(`S1 ${formatSignedDelta(sectorDelta1Ms)}`);
  if (sectorDelta2Ms != null) sectorSignals.push(`S2 ${formatSignedDelta(sectorDelta2Ms)}`);

  if (isPit) {
    return {
      label: 'COOL',
      tone: 'standby',
      summary: 'In pit',
      score: -3,
      sectorDelta1Ms,
      sectorDelta2Ms,
    };
  }

  if (isInvalid) {
    return {
      label: 'COOL',
      tone: 'standby',
      summary: 'Lap invalid',
      score: -3,
      sectorDelta1Ms,
      sectorDelta2Ms,
    };
  }

  if (isGarage) {
    return {
      label: 'COOL',
      tone: 'standby',
      summary: 'Garage',
      score: -2,
      sectorDelta1Ms,
      sectorDelta2Ms,
    };
  }

  if (isInLap) {
    return {
      label: 'COOL',
      tone: 'standby',
      summary: buildSummary(['In lap', ...sectorSignals]),
      score: -1,
      sectorDelta1Ms,
      sectorDelta2Ms,
    };
  }

  let score = 0;
  if (isFlying) score += 3;
  else if (isTrack) score += 1;
  else if (isOutLap) score -= 1;

  if (hasAggressiveErsMode && hasUsableErs) score += 2;
  else if (isDeployingErs && hasUsableErs) score += 1;

  if (hasDrsSignal) score += 1;
  score += competitiveSectorCount;
  score += strongSectorCount;
  if (combinedDeltaMs != null && combinedDeltaMs <= TRY_COMBINED_MARGIN_MS) {
    score += 1;
  }
  if (recentCompetitiveLap) score += 1;

  const ersLabel = getErsModeLabel(driver);
  const positiveSignals = [
    isFlying ? 'Flying' : isOutLap ? 'Out lap' : null,
    ...sectorSignals,
    ersLabel,
    hasDrsSignal ? 'DRS' : null,
  ].filter((value): value is string => Boolean(value));

  if (
    (isFlying && hasUsableErs && (hasAggressiveErsMode || hasDrsSignal || competitiveSectorCount > 0 || recentCompetitiveLap))
    || competitiveSectorCount >= 2
    || strongSectorCount >= 1
    || (combinedDeltaMs != null && combinedDeltaMs <= TRY_COMBINED_MARGIN_MS && hasUsableErs)
  ) {
    return {
      label: 'TRY',
      tone: 'attack',
      summary: buildSummary(positiveSignals),
      score,
      sectorDelta1Ms,
      sectorDelta2Ms,
    };
  }

  if (isOutLap || (score >= 2 && hasUsableErs)) {
    return {
      label: 'BUILD',
      tone: 'watch',
      summary: buildSummary(positiveSignals.length > 0 ? positiveSignals : ['Push build-up']),
      score,
      sectorDelta1Ms,
      sectorDelta2Ms,
    };
  }

  return {
    label: 'COOL',
    tone: 'standby',
    summary: buildSummary(
      sectorSignals.length > 0 ? ['Cooldown', ...sectorSignals] : ['No live push signal'],
    ),
    score,
    sectorDelta1Ms,
    sectorDelta2Ms,
  };
}
