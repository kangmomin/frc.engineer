import { getTeamColor, getTeamShort } from '../../../constants/teamColors';
import { getTyreColor, getTyreShortLabel } from '../../../constants/tyreCompounds';
import type { DriverInfo, PenaltyLogEntry, SessionInfo } from '../../../types/telemetry';
import { deriveDriverCodes } from '../../../utils/driverCodes';
import { formatLapTime } from '../../../utils/formatters';
import { driverCanArmDrs, formatFuelMargin, formatInterval, getSectorFlag } from '../../../utils/raceDisplay';

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
 * Sector 컬럼(Spec §3.3, FIX-1로 정정). S1/S2는 currentSector 진행도로 완료 여부를 판단한다.
 * currentSector는 와이어 기준 **0-based**다(Go internal/packets/lapdata.go:28
 * `Sector uint8 //0=s1,1=s2,2=s3`, pitwall_manager.go:470에서 무변환 전달) — S1 완료(S2 진입)는
 * currentSector>=1, S2 완료(S3 진입)는 currentSector>=2. S3는 전용 필드가 없고, sector1/2TimeMs
 * (현재 랩 진행 중 값)와 lastLapTime(직전 완주 랩 총합)을 섞어 역산하면 서로 다른 랩의 값을
 * 빼는 fabrication이 되므로(Spec §9 위반) 상시 '—'로 degrade한다.
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

  // sector1/2TimeMs는 Go DTO omitempty라 미완주 섹터는 undefined다 — 0으로 정규화(0=미완주=DOT).
  const s1Ms = driver.sector1TimeMs ?? 0;
  const s2Ms = driver.sector2TimeMs ?? 0;
  const s1Valid = driver.currentSector >= 1 && s1Ms > 0;
  const s2Valid = driver.currentSector >= 2 && s2Ms > 0;

  return {
    s1: s1Valid
      ? { text: (s1Ms / 1000).toFixed(3), color: sectorTone(s1Ms, driver.bestSector1Ms, flag1) }
      : { text: DOT, color: 'var(--text-muted)' },
    s2: s2Valid
      ? { text: (s2Ms / 1000).toFixed(3), color: sectorTone(s2Ms, driver.bestSector2Ms, flag2) }
      : { text: DOT, color: 'var(--text-muted)' },
    s3: { text: DASH, color: 'var(--text-muted)' },
  };
}

export interface LeaderRow {
  index: number;
  pos: string;
  posColor: string;
  teamColor: string;
  rowBg: string;
  name: string;
  teamShort: string;
  nameColor: string;
  aiShow: boolean;
  drsLabel: string;
  drsColor: string;
  drsBg: string;
  /** 색상만으로 active/armed/inactive를 구분하던 것을 보완하는 title/aria-label 문구(FIX-6). */
  drsTitle: string;
  ersPct: string;
  ersW: string;
  ersColor: string;
  toYou: string;
  toYouColor: string;
  interval: string;
  lastLap: string;
  lastColor: string;
  bestLap: string;
  bestLapColor: string;
  fuel: string;
  fuelColor: string;
  penLabel: string;
  penColor: string;
  penBg: string;
  /** 페널티 셀 hover 상세용 원시 로그(포맷은 셀에서 lazy). 없으면 빈 배열. */
  penaltyLog: PenaltyLogEntry[];
  /** name: 원시 compound 문자열(legacy CockpitDashboard 표기 선례 준수, 매핑 이름 아님). 색만으로
   * 스틴트 구분을 전달하지 않도록 title/aria-label("Stint N: <name>", FIX-6) 조립에 쓰인다. */
  stintDots: Array<{ color: string; name: string }>;
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

/**
 * DRS/OVT 배지는 armed(노랑/시안)와 active(라임)를 색으로만 구분해 색맹·스크린리더
 * 사용자에게는 동일한 "DRS"/"OVT" 텍스트로만 보인다 — title/aria-label로 상태를 명시한다(FIX-6).
 */
function drsCell(driver: DriverInfo, is2026: boolean): { label: string; color: string; bg: string; title: string } {
  const tone = getDrsTone(driver, is2026);
  const label = is2026 ? 'OVT' : 'DRS';
  if (tone === 'drsActive') return { label, color: '#0c0c0d', bg: 'var(--accent-lime)', title: `${label} active` };
  if (tone === 'drsArmed') {
    return { label, color: '#0c0c0d', bg: is2026 ? 'var(--accent)' : 'var(--accent-yellow)', title: `${label} available` };
  }
  return { label: DASH, color: 'var(--text-muted)', bg: 'transparent', title: `${label} unavailable` };
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

/**
 * 연료는 경쟁상 민감 정보라 피트월에서는 내 팀(내 차 + 팀메이트)만 노출하고,
 * 타팀은 '—'로 가린다(전 차량 연료는 World feed에서만). teamId 255(무팀)·미해결
 * 0-fill 로 같은 id 가 3대 이상 뭉치면 sentinel fan-out 이므로 내 차만 노출한다.
 */
function isFuelVisible(driver: DriverInfo, player: DriverInfo | null, teamResolved: boolean): boolean {
  if (player == null) return false;
  if (driver.index === player.index) return true; // 내 차는 항상
  return teamResolved && driver.teamId === player.teamId; // 팀메이트는 팀이 sane(≤2)일 때만
}

function gapToYouCell(driver: DriverInfo, isPlayer: boolean): { text: string; color: string } {
  if (isPlayer) return { text: 'YOU', color: 'var(--accent)' };
  const delta = driver.deltaToPlayer;
  if (delta == null) return { text: DASH, color: 'var(--text-secondary)' };
  const sign = delta >= 0 ? '+' : '';
  return { text: `${sign}${(delta / 1000).toFixed(1)}`, color: 'var(--text-secondary)' };
}

function tyreCell(driver: DriverInfo): {
  stintDots: Array<{ color: string; name: string }>;
  compound: string;
  compoundColor: string;
  age: string;
  tyreLife: string;
} {
  const stintDots = (driver.stintHistory ?? []).map((s) => ({ color: getTyreColor(s.compound), name: s.compound }));
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
  // Session-best lap across drivers, guarded to positive times so early all-zero
  // frames don't paint P1 purple (bestLapTime is 0 before a lap is set).
  const validBests = drivers.map((d) => d.bestLapTime).filter((t) => t > 0);
  const bestFastestMs = validBests.length ? Math.min(...validBests) : null;
  // deriveDriverCodes: still used as the driver-cell fallback when name is blank,
  // and shared with the World feed for consistent codes.
  const codes = deriveDriverCodes(drivers);

  // Fuel 가시성용 팀 사이즈 가드(F1 = 팀당 2대). player 팀 id 를 공유하는 차가 정확히
  // 1~2대일 때만 "실제 팀"으로 신뢰하고 팀메이트 연료를 노출한다. 255(무팀)는 카운트와
  // 무관하게 팀이 아니므로 제외(1v1 커스텀 로비에서 타인 연료가 새는 것 방지), 미해결
  // 0-fill 로 다수가 같은 id 를 공유하면(>2) sentinel fan-out 이라 내 차만 노출한다.
  const teamCount = player == null ? 0 : drivers.filter((d) => d.teamId === player.teamId).length;
  const teamResolved = player != null && player.teamId !== 255 && teamCount >= 1 && teamCount <= 2;

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
    const fuel = isFuelVisible(driver, player, teamResolved)
      ? formatFuelMargin(driver.fuelRemainingLaps)
      : { text: DASH, color: 'var(--text-muted)' };
    const isFastestLap = fastestMs != null && driver.lastLapTime > 0 && driver.lastLapTime === fastestMs;
    const isSessionBest = bestFastestMs != null && driver.bestLapTime > 0 && driver.bestLapTime === bestFastestMs;
    // Full name (uppercased in the panel) with a code/CAR fallback — the backend
    // sends an empty name before participants arrive or for blank garage slots.
    const displayName = driver.name.trim() || codes.get(driver.index) || `CAR ${driver.index + 1}`;

    return {
      index: driver.index,
      pos: String(driver.position).padStart(2, '0'),
      posColor: posColor(isLeader, isPlayer),
      teamColor: getTeamColor(driver.teamId),
      rowBg: rowBackground(tone, i),
      name: displayName,
      teamShort: getTeamShort(driver.teamId),
      nameColor: isPlayer ? 'var(--accent)' : 'var(--text-primary)',
      aiShow: driver.aiControlled,
      drsLabel: drs.label,
      drsColor: drs.color,
      drsBg: drs.bg,
      drsTitle: drs.title,
      ersPct: ers.pct,
      ersW: ers.width,
      ersColor: ers.color,
      toYou: gap.text,
      toYouColor: gap.color,
      interval: formatInterval(driver, isLeader),
      lastLap: formatLapTime(driver.lastLapTime),
      lastColor: isFastestLap ? 'var(--sector-purple)' : isPlayer ? 'var(--accent)' : 'var(--text-secondary)',
      bestLap: formatLapTime(driver.bestLapTime),
      bestLapColor: isSessionBest ? 'var(--sector-purple)' : isPlayer ? 'var(--accent)' : 'var(--text-secondary)',
      fuel: fuel.text,
      fuelColor: fuel.color,
      penLabel: pen.label,
      penColor: pen.color,
      penBg: pen.bg,
      penaltyLog: driver.penaltyLog ?? [],
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
