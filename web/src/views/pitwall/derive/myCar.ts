import { getTyreColor, getTyreShortLabel } from '../../../constants/tyreCompounds';
import type { DriverInfo, SessionInfo } from '../../../types/telemetry';
import { deriveDriverCodes } from '../../../utils/driverCodes';
import { formatLapTime } from '../../../utils/formatters';

const DASH = '—';

const COMPOUND_NAMES: Record<string, string> = {
  soft: 'Soft',
  medium: 'Medium',
  hard: 'Hard',
  inter: 'Intermediate',
  wet: 'Wet',
  unknown: 'Unknown',
  Soft: 'Soft',
  Medium: 'Medium',
  Hard: 'Hard',
  Inter: 'Intermediate',
  Wet: 'Wet',
  Unknown: 'Unknown',
};

function compoundName(compound: string): string {
  return COMPOUND_NAMES[compound] ?? compound;
}

/**
 * legacy formatAheadGap(1793) 이식. 결측 placeholder는 Spec §9(0.000 금지 · '—' 정규화)에
 * 맞춰 legacy의 '--'에서 '—'로 조정한다.
 */
export function formatAheadGap(player: DriverInfo | null): string {
  if (player?.deltaToCarInFront == null || player.deltaToCarInFront <= 0) return DASH;
  return `-${(player.deltaToCarInFront / 1000).toFixed(2)}s`;
}

/** legacy formatBehindGap(1798) 이식(placeholder '—'로 조정, 위와 동일 사유). */
export function formatBehindGap(carBehind: DriverInfo | null): string {
  if (carBehind?.deltaToCarInFront == null || carBehind.deltaToCarInFront <= 0) return DASH;
  return `+${(carBehind.deltaToCarInFront / 1000).toFixed(2)}s`;
}

/** legacy formatBattlePace(1803) 이식(placeholder '—'로 조정). */
export function formatBattlePace(
  player: DriverInfo | null,
  rival: DriverInfo | null,
  side: 'ahead' | 'behind',
): string {
  if (!player || !rival || player.lastLapTime <= 0 || rival.lastLapTime <= 0) return DASH;
  const deltaMs = side === 'ahead' ? player.lastLapTime - rival.lastLapTime : rival.lastLapTime - player.lastLapTime;
  return `${deltaMs > 0 ? '+' : ''}${(deltaMs / 1000).toFixed(2)}s`;
}

/** deltaMs<=0(더 빠름)=lime, >0(더 느림)=red. 테마 토큰 --delta-faster/--delta-slower 사용. */
function deltaTone(deltaMs: number): string {
  return deltaMs <= 0 ? 'var(--delta-faster)' : 'var(--delta-slower)';
}

/** TyrePredictorPanel과 공유(FIX-5) — 그쪽은 예측 연산 특성상 `?? 0`으로 unwrap해 쓴다. */
export function averageWear(driver: DriverInfo): number | null {
  if (driver.tyreSetWear != null) return driver.tyreSetWear;
  if (driver.tireWear.length > 0) {
    return driver.tireWear.reduce((sum, w) => sum + w, 0) / driver.tireWear.length;
  }
  return null;
}

export interface PitWindowVM {
  tone: 'open' | 'upcoming' | 'closed';
  title: string;
  rangeText: string;
  rejoinText: string | null;
}

/**
 * PIT WINDOW. idealLap/latestLap이 모두 있을 때만 표시하고, currentLapNum 대비 실데이터로
 * OPEN/UPCOMING/CLOSED를 계산한다(예측·억제 없음, Phase1 StrategyPanel의 "실데이터 그대로"
 * 선례 참조 — 목업의 fabricated "Undercut" 수치는 rejoinPosition 실필드로 대체).
 */
function derivePitWindow(player: DriverInfo, session: SessionInfo | null): PitWindowVM | null {
  const ideal = session?.pitStopWindowIdealLap;
  const latest = session?.pitStopWindowLatestLap;
  if (ideal == null || latest == null) return null;

  const lap = player.currentLapNum;
  const tone: PitWindowVM['tone'] = lap < ideal ? 'upcoming' : lap <= latest ? 'open' : 'closed';
  const title = tone === 'open' ? 'PIT WINDOW OPEN' : tone === 'upcoming' ? `PIT WINDOW OPENS L${ideal}` : 'PIT WINDOW CLOSED';
  const rejoin = session?.pitStopRejoinPosition;

  return {
    tone,
    title,
    rangeText: `Box L${ideal}–${latest}`,
    rejoinText: rejoin != null ? `Rejoin → P${rejoin}` : null,
  };
}

export interface MyCarVM {
  position: string;
  aheadCode: string;
  gapAhead: string;
  behindCode: string;
  gapBehind: string;
  lastLapText: string;
  deltaText: string;
  deltaColor: string;
  ersText: string;
  compound: string;
  compoundColor: string;
  compoundName: string;
  tireAge: string;
  wearText: string;
  pitWindow: PitWindowVM | null;
}

/** (player, drivers, session) → MyCarVM | null. drivers는 position 오름차순 정렬 전제. */
export function deriveMyCar(
  player: DriverInfo | null,
  drivers: DriverInfo[],
  session: SessionInfo | null,
): MyCarVM | null {
  if (!player) return null;

  const idx = drivers.findIndex((d) => d.index === player.index);
  const ahead = idx > 0 ? drivers[idx - 1] : null;
  const behind = idx >= 0 && idx < drivers.length - 1 ? drivers[idx + 1] : null;
  // Broadcast(WORLD)와 동일 코드 파생 공유(FIX-5).
  const codes = deriveDriverCodes(drivers);

  // [Assumption] Spec은 "앞차 없음(리더)" 폴백으로 deltaPersonalBest를 제안하지만, 그 필드는
  // 레거시 TelemetryData(구 단일차량 프로토콜) 전용이며 DriverInfo에는 존재하지 않는다.
  // 실데이터로 재현 불가하므로 조작하지 않고 '—'로 degrade한다(완료 보고에 기록).
  const deltaText = ahead ? formatBattlePace(player, ahead, 'ahead') : DASH;
  const deltaMsForTone = ahead ? player.lastLapTime - ahead.lastLapTime : null;

  const wear = averageWear(player);

  return {
    position: `P${player.position}`,
    aheadCode: ahead ? codes.get(ahead.index) ?? DASH : DASH,
    gapAhead: formatAheadGap(player),
    behindCode: behind ? codes.get(behind.index) ?? DASH : DASH,
    gapBehind: formatBehindGap(behind),
    lastLapText: formatLapTime(player.lastLapTime),
    deltaText,
    deltaColor: deltaMsForTone == null ? 'var(--text-secondary)' : deltaTone(deltaMsForTone),
    ersText: player.ersActualReady ? `${Math.round(player.ersActualPct)}%` : player.ersEstimateReady ? `${Math.round(player.ersEstimatePct)}%` : DASH,
    compound: getTyreShortLabel(player.tireCompound),
    compoundColor: getTyreColor(player.tireCompound),
    compoundName: compoundName(player.tireCompound),
    tireAge: String(player.tireAge),
    wearText: wear != null ? `${Math.round(wear)}%` : DASH,
    pitWindow: derivePitWindow(player, session),
  };
}
