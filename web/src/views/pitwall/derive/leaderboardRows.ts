import { getTeamColor } from '../../../constants/teamColors';
import { getTyreColor, getTyreShortLabel } from '../../../constants/tyreCompounds';
import type { DriverInfo, SessionInfo } from '../../../types/telemetry';
import { formatLapTime } from '../../../utils/formatters';
import { driverCanArmDrs, formatInterval, getSectorFlag } from '../../../utils/raceDisplay';

/**
 * Pit Wall 리더보드 행 파생. legacy CockpitDashboard.tsx(byte-frozen)의 순수 헬퍼를
 * 기계적으로 이식(복사, import 아님)하고, 목업(PitWall.dc.html)의 색상/레이아웃을
 * 실데이터 위에 재구성한다. 조작/추정 없이 결측은 '—'/'·'로 degrade한다.
 */

const DASH = '—';
const DOT = '·';

const WING_DAMAGE_THRESHOLD = 10;
const BODY_DAMAGE_THRESHOLD = 20;
/** 개인베스트(bestSectorNMs) 근접 판정 여유(ms). 목업 sTone의 절대오차 0.12s를 이식. */
const SECTOR_CLOSE_MARGIN_MS = 120;
const ERS_LOW_PCT = 20;

// ── legacy 이식 헬퍼 (CockpitDashboard.tsx 기계적 복사, import 아님) ──

/** legacy abbreviateDriver(1786) 이식·개칭. */
export function codeFromName(name: string, fallbackIndex?: number): string {
  const trimmed = name?.trim();
  if (!trimmed) return fallbackIndex != null ? `P${fallbackIndex}` : '---';
  const parts = trimmed.split(/\s+/);
  return (parts.length > 1 ? parts[parts.length - 1] : trimmed).slice(0, 3).toUpperCase();
}

/** legacy getDamageSummaryItems(1770) 이식. */
export function getDamageSummaryItems(
  driver: DriverInfo | null,
): Array<{ label: 'FL' | 'FR' | 'RW' | 'OTH'; value: number }> {
  return [
    { label: 'FL', value: driver?.damage?.frontLeftWing ?? 0 },
    { label: 'FR', value: driver?.damage?.frontRightWing ?? 0 },
    { label: 'RW', value: driver?.damage?.rearWing ?? 0 },
    {
      label: 'OTH',
      value: Math.max(
        driver?.damage?.floor ?? 0,
        driver?.damage?.diffuser ?? 0,
        driver?.damage?.sidepod ?? 0,
      ),
    },
  ];
}

/**
 * 윙(FL/FR/RW)=10, 바디(OTH)=20 명명 임계 톤(Spec §3.1). legacy getDamageSeverityStyle의
 * 연속 HSL 그라디언트 대신 감사 가능한 명명 상수를 사용한다(신규 구현, lift 아님).
 */
export function damageTone(value: number, part: 'FL' | 'FR' | 'RW' | 'OTH'): string {
  const threshold = part === 'OTH' ? BODY_DAMAGE_THRESHOLD : WING_DAMAGE_THRESHOLD;
  if (value <= 0) return 'var(--text-muted)';
  return value >= threshold ? 'var(--accent-red)' : 'var(--accent-soft)';
}

/** legacy driverHasDrs(2061) 이식. */
export function driverHasDrs(driver: DriverInfo, is2026: boolean): boolean {
  if (is2026) return driver.overtakeActive === true || driver.drsActivated === true;
  if (driver.drsActivated !== undefined) return driver.drsActivated;
  return driverCanArmDrs(driver, is2026);
}

/** legacy getDrsTone(2073) 이식. */
export function getDrsTone(driver: DriverInfo, is2026: boolean): 'drsActive' | 'drsArmed' | 'drsInactive' {
  if (driverHasDrs(driver, is2026)) return 'drsActive';
  if (driverCanArmDrs(driver, is2026)) return 'drsArmed';
  return 'drsInactive';
}

/** legacy getPitStatusTone(2083) 이식. */
export function getPitStatusTone(driver: DriverInfo): 'pitActive' | 'pitInactive' {
  return driver.pitStatus > 0 ? 'pitActive' : 'pitInactive';
}

/** legacy getDriverRowTone(2087) 이식. playerRow > leaderRow > teamRow > alternating. */
export function getDriverRowTone(
  driver: DriverInfo,
  player: DriverInfo | null,
): 'playerRow' | 'leaderRow' | 'teamRow' | '' {
  if (player && driver.index === player.index) return 'playerRow';
  if (driver.position === 1) return 'leaderRow';
  if (player && driver.teamId === player.teamId) return 'teamRow';
  return '';
}

/** Spec §3.2: SG > DT > time penalty > warning 우선순위. legacy에 전용 헬퍼 없어 신설. */
export function derivePenaltyBadge(driver: DriverInfo): { label: string; color: string; bg: string } {
  if (driver.numUnservedStopGoPenalties > 0) {
    return { label: 'SG', color: '#0c0c0d', bg: 'var(--accent-red)' };
  }
  if (driver.numUnservedDriveThroughs > 0) {
    return { label: 'DT', color: '#0c0c0d', bg: 'var(--accent-red)' };
  }
  if (driver.penalties > 0) {
    return { label: `+${driver.penalties}`, color: '#0c0c0d', bg: 'var(--accent-soft)' };
  }
  if (driver.totalWarnings > 0) {
    return { label: `${driver.totalWarnings}W`, color: '#0c0c0d', bg: 'var(--accent-yellow)' };
  }
  return { label: DASH, color: 'var(--text-muted)', bg: 'transparent' };
}

/**
 * Sector 컬럼(Spec §3.3, 복잡도 높음). S1/S2는 currentSector 진행도로 완료 여부를 판단하고,
 * S3는 직접 필드가 없어 lastLapTime - sector1TimeMs - sector2TimeMs로 역산한다(양수일 때만).
 * 불확실하면 조작하지 않고 '·'(진행 중)/'—'(불확실)로 degrade한다.
 */
function sectorTone(currentMs: number, bestMs: number | null | undefined, flag: number): string {
  if (flag === 3 || flag === 4) return flag === 3 ? '#eab308' : 'var(--accent-red)';
  if (!bestMs || bestMs <= 0) return 'var(--text-secondary)';
  return currentMs - bestMs <= SECTOR_CLOSE_MARGIN_MS ? 'var(--accent-lime)' : 'var(--accent-soft)';
}

export interface SectorCellVM {
  text: string;
  color: string;
}

export function deriveSectorCells(
  driver: DriverInfo,
  session: SessionInfo | null,
): { s1: SectorCellVM; s2: SectorCellVM; s3: SectorCellVM } {
  const flag1 = getSectorFlag(session?.marshalZones, 1);
  const flag2 = getSectorFlag(session?.marshalZones, 2);
  const flag3 = getSectorFlag(session?.marshalZones, 3);

  const s1Valid = driver.currentSector >= 2 && driver.sector1TimeMs > 0;
  const s2Valid = driver.currentSector >= 3 && driver.sector2TimeMs > 0;
  const s3Raw = driver.lastLapTime - driver.sector1TimeMs - driver.sector2TimeMs;
  const s3Valid =
    driver.lastLapTime > 0 && driver.sector1TimeMs > 0 && driver.sector2TimeMs > 0 && s3Raw > 0;

  return {
    s1: s1Valid
      ? { text: (driver.sector1TimeMs / 1000).toFixed(3), color: sectorTone(driver.sector1TimeMs, driver.bestSector1Ms, flag1) }
      : { text: DOT, color: 'var(--text-muted)' },
    s2: s2Valid
      ? { text: (driver.sector2TimeMs / 1000).toFixed(3), color: sectorTone(driver.sector2TimeMs, driver.bestSector2Ms, flag2) }
      : { text: DOT, color: 'var(--text-muted)' },
    s3: s3Valid
      ? { text: (s3Raw / 1000).toFixed(3), color: sectorTone(s3Raw, driver.bestSector3Ms, flag3) }
      : { text: DASH, color: 'var(--text-muted)' },
  };
}

export interface LeaderRow {
  index: number;
  pos: string;
  posColor: string;
  teamColor: string;
  rowBg: string;
  name: string;
  nameColor: string;
  aiShow: boolean;
  drsLabel: string;
  drsColor: string;
  drsBg: string;
  ersPct: string;
  ersW: string;
  ersColor: string;
  toYou: string;
  toYouColor: string;
  interval: string;
  lastLap: string;
  lastColor: string;
  penLabel: string;
  penColor: string;
  penBg: string;
  stintDots: Array<{ color: string }>;
  compound: string;
  compoundColor: string;
  age: string;
  tyreLife: string;
  pitLabel: string;
  pitColor: string;
  pitBg: string;
  vmax: string;
  s1: string;
  s1c: string;
  s2: string;
  s2c: string;
  s3: string;
  s3c: string;
  dmgFL: string;
  dmgFLc: string;
  dmgFR: string;
  dmgFRc: string;
  dmgRW: string;
  dmgRWc: string;
  dmgOTH: string;
  dmgOTHc: string;
}

function rowBackground(tone: ReturnType<typeof getDriverRowTone>, index: number): string {
  if (tone === 'playerRow') return 'rgba(0,229,255,.13)';
  if (tone === 'leaderRow') return 'rgba(205,255,19,.05)';
  if (tone === 'teamRow') return 'rgba(39,244,210,.06)';
  return index % 2 ? 'rgba(255,255,255,.015)' : 'transparent';
}

/** 목업 posColor 우선순위(leader > player > muted)를 그대로 이식. rowBg 우선순위와는 별개. */
function posColor(isLeader: boolean, isPlayer: boolean): string {
  if (isLeader) return 'var(--accent-lime)';
  if (isPlayer) return 'var(--accent)';
  return 'var(--text-muted)';
}

function drsCell(driver: DriverInfo, is2026: boolean): { label: string; color: string; bg: string } {
  const tone = getDrsTone(driver, is2026);
  const label = is2026 ? 'OVT' : 'DRS';
  if (tone === 'drsActive') return { label, color: '#0c0c0d', bg: 'var(--accent-lime)' };
  if (tone === 'drsArmed') {
    return { label, color: '#0c0c0d', bg: is2026 ? 'var(--accent)' : 'var(--accent-yellow)' };
  }
  return { label: DASH, color: 'var(--text-muted)', bg: 'transparent' };
}

function ersCell(driver: DriverInfo): { pct: string; width: string; color: string } {
  const value = driver.ersActualReady ? driver.ersActualPct : driver.ersEstimateReady ? driver.ersEstimatePct : null;
  if (value == null) return { pct: DASH, width: '0%', color: 'var(--text-muted)' };
  const rounded = Math.round(value);
  return {
    pct: `${rounded}%`,
    width: `${rounded}%`,
    color: rounded < ERS_LOW_PCT ? 'var(--accent-soft)' : 'var(--accent)',
  };
}

function gapToYouCell(driver: DriverInfo, isPlayer: boolean): { text: string; color: string } {
  if (isPlayer) return { text: 'YOU', color: 'var(--accent)' };
  const delta = driver.deltaToPlayer;
  if (delta == null) return { text: DASH, color: 'var(--text-secondary)' };
  const sign = delta >= 0 ? '+' : '';
  return { text: `${sign}${(delta / 1000).toFixed(1)}`, color: 'var(--text-secondary)' };
}

function tyreCell(driver: DriverInfo): {
  stintDots: Array<{ color: string }>;
  compound: string;
  compoundColor: string;
  age: string;
  tyreLife: string;
} {
  const stintDots = (driver.stintHistory ?? []).map((s) => ({ color: getTyreColor(s.compound) }));
  const hasLife =
    driver.tyreLifeSpan != null && driver.tyreUsableLife != null && driver.tyreUsableLife > 0;
  const tyreLife = hasLife
    ? `${Math.max(0, driver.tyreLifeSpan as number)}/${driver.tyreUsableLife}`
    : DASH;
  return {
    stintDots,
    compound: getTyreShortLabel(driver.tireCompound),
    compoundColor: getTyreColor(driver.tireCompound),
    age: String(driver.tireAge),
    tyreLife,
  };
}

function pitCell(driver: DriverInfo): { label: string; color: string; bg: string } {
  const active = driver.pitStatus > 0;
  return {
    label: active ? 'PIT' : DASH,
    color: active ? '#0c0c0d' : 'var(--text-muted)',
    bg: active ? 'var(--accent)' : 'transparent',
  };
}

function damageCell(driver: DriverInfo): {
  dmgFL: string;
  dmgFLc: string;
  dmgFR: string;
  dmgFRc: string;
  dmgRW: string;
  dmgRWc: string;
  dmgOTH: string;
  dmgOTHc: string;
} {
  const items = getDamageSummaryItems(driver);
  const fl = items[0].value;
  const fr = items[1].value;
  const rw = items[2].value;
  const oth = items[3].value;
  return {
    dmgFL: `${fl}%`,
    dmgFLc: damageTone(fl, 'FL'),
    dmgFR: `${fr}%`,
    dmgFRc: damageTone(fr, 'FR'),
    dmgRW: `${rw}%`,
    dmgRWc: damageTone(rw, 'RW'),
    dmgOTH: `${oth}%`,
    dmgOTHc: damageTone(oth, 'OTH'),
  };
}

/**
 * (drivers, player, is2026, session) → LeaderRow[]. drivers는 position 오름차순 정렬 전제.
 * omitempty 결측은 '—'/'·'로 정규화하고 0.000을 표기하지 않는다(Spec §9).
 */
export function deriveLeaderboardRows(
  drivers: DriverInfo[],
  player: DriverInfo | null,
  is2026: boolean,
  session: SessionInfo | null,
): LeaderRow[] {
  const validLaps = drivers.map((d) => d.lastLapTime).filter((t) => t > 0);
  const fastestMs = validLaps.length ? Math.min(...validLaps) : null;

  return drivers.map((driver, i) => {
    const isPlayer = player != null && driver.index === player.index;
    const isLeader = driver.position === 1;
    const tone = getDriverRowTone(driver, player);
    const drs = drsCell(driver, is2026);
    const ers = ersCell(driver);
    const gap = gapToYouCell(driver, isPlayer);
    const pen = derivePenaltyBadge(driver);
    const tyre = tyreCell(driver);
    const pit = pitCell(driver);
    const sector = deriveSectorCells(driver, session);
    const dmg = damageCell(driver);
    const isFastestLap = fastestMs != null && driver.lastLapTime > 0 && driver.lastLapTime === fastestMs;

    return {
      index: driver.index,
      pos: String(driver.position).padStart(2, '0'),
      posColor: posColor(isLeader, isPlayer),
      teamColor: getTeamColor(driver.teamId),
      rowBg: rowBackground(tone, i),
      name: codeFromName(driver.name, driver.index),
      nameColor: isPlayer ? 'var(--accent)' : 'var(--text-primary)',
      aiShow: driver.aiControlled,
      drsLabel: drs.label,
      drsColor: drs.color,
      drsBg: drs.bg,
      ersPct: ers.pct,
      ersW: ers.width,
      ersColor: ers.color,
      toYou: gap.text,
      toYouColor: gap.color,
      interval: formatInterval(driver, isLeader),
      lastLap: formatLapTime(driver.lastLapTime),
      lastColor: isFastestLap ? 'var(--sector-purple)' : isPlayer ? 'var(--accent)' : 'var(--text-secondary)',
      penLabel: pen.label,
      penColor: pen.color,
      penBg: pen.bg,
      stintDots: tyre.stintDots,
      compound: tyre.compound,
      compoundColor: tyre.compoundColor,
      age: tyre.age,
      tyreLife: tyre.tyreLife,
      pitLabel: pit.label,
      pitColor: pit.color,
      pitBg: pit.bg,
      vmax: driver.topSpeed > 0 ? String(Math.round(driver.topSpeed)) : DASH,
      s1: sector.s1.text,
      s1c: sector.s1.color,
      s2: sector.s2.text,
      s2c: sector.s2.color,
      s3: sector.s3.text,
      s3c: sector.s3.color,
      dmgFL: dmg.dmgFL,
      dmgFLc: dmg.dmgFLc,
      dmgFR: dmg.dmgFR,
      dmgFRc: dmg.dmgFRc,
      dmgRW: dmg.dmgRW,
      dmgRWc: dmg.dmgRWc,
      dmgOTH: dmg.dmgOTH,
      dmgOTHc: dmg.dmgOTHc,
    };
  });
}
