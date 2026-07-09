import type { DriverInfo, MarshalZone, SessionInfo } from '../types/telemetry';

/**
 * Broadcast(WORLD FEED) 뷰 전용 표시 헬퍼.
 * CockpitDashboard.tsx의 동명 헬퍼와는 신규 요구사항(FORMATION·RED FLAG 등)이 섞여
 * 있어 독립적으로 재구현한다 — cockpit 쪽을 import/수정하지 않는다.
 */

export type StatusTone = 'green' | 'safety' | 'vsc' | 'formation' | 'red' | 'info';

export interface RaceStatus {
  label: string;
  tone: StatusTone;
}

/**
 * 레이스 상태 pill. 우선순위: FORMATION > RED FLAG(마샬존 flag===4) > SAFETY CAR(full)
 * > VSC(virtual*) > GREEN. 세션이 없으면 대시(—)/info.
 */
export function getRaceStatus(session: SessionInfo | null): RaceStatus {
  if (!session) return { label: '—', tone: 'info' };
  if (session.safetyCar === 'formation') return { label: 'FORMATION', tone: 'formation' };
  if (session.marshalZones?.some((zone) => zone.flag === 4)) {
    return { label: 'RED FLAG', tone: 'red' };
  }
  if (session.safetyCar === 'full') return { label: 'SAFETY CAR', tone: 'safety' };
  if (session.safetyCar?.startsWith('virtual')) return { label: 'VSC', tone: 'vsc' };
  return { label: 'GREEN', tone: 'green' };
}

export const FLAG_COLORS: Record<number, string> = {
  1: '#cdff13', // GREEN
  2: '#00daf3', // BLUE
  3: '#eab308', // YELLOW
  4: '#ff525c', // RED
};

/** 섹터(1~3) 구간에 걸린 마샬존 플래그. 없으면 0. */
export function getSectorFlag(marshalZones: MarshalZone[] | undefined, sector: number): number {
  if (!marshalZones) return 0;
  const lo = (sector - 1) / 3;
  const hi = sector / 3;
  for (const zone of marshalZones) {
    if (zone.start >= lo && zone.start < hi && zone.flag >= 1) return zone.flag;
  }
  return 0;
}

export function formatSafetyCarShort(safetyCar: string): string {
  switch (safetyCar) {
    case 'full':
      return 'SC';
    case 'virtual':
      return 'VSC';
    case 'virtual_ending':
      return 'VSCE';
    case 'virtual_standing':
      return 'VSC';
    case 'formation':
      return 'FORM';
    default:
      return '';
  }
}

export function formatGapToLeader(driver: DriverInfo, isLeader: boolean): string {
  if (isLeader) return 'LEADER';
  if (driver.deltaToRaceLeader === undefined) return '—';
  return `+${(driver.deltaToRaceLeader / 1000).toFixed(1)}`;
}

export function formatInterval(driver: DriverInfo, isLeader: boolean): string {
  if (isLeader) return '—';
  if (driver.pitStatus > 0) return 'PIT';
  if (driver.deltaToCarInFront === undefined || driver.deltaToCarInFront <= 0) return '—';
  return `+${(driver.deltaToCarInFront / 1000).toFixed(1)}`;
}

/** Fuel margin in laps. +N = spare, −N = short. Exact/near-zero renders unsigned
 * "0.0" (never "-0.0") as a valid on-target reading; negative is red. Pit Wall(내 팀
 * 한정 노출)과 World feed가 동일 포맷을 공유해 두 뷰의 연료 표기가 어긋나지 않게 한다. */
export function formatFuelMargin(laps: number): { text: string; color: string } {
  if (!Number.isFinite(laps) || Math.abs(laps) < 0.05) {
    return { text: '0.0', color: 'var(--text-secondary)' };
  }
  const sign = laps > 0 ? '+' : '-';
  return {
    text: `${sign}${Math.abs(laps).toFixed(1)}`,
    color: laps < 0 ? 'var(--accent-red)' : 'var(--text-secondary)',
  };
}

export interface WeatherCondition {
  label: string;
  tone: 'dry' | 'mixed' | 'wet';
}

/** 트랙 컨디션. weather 값은 백엔드에서 snake_case로 온다 (예: light_rain). */
export function getTrackCondition(weather: string): WeatherCondition {
  const normalized = weather.replace(/_/g, ' ').toLowerCase();
  if (normalized === 'light rain') return { label: 'MIXED', tone: 'mixed' };
  if (normalized === 'heavy rain' || normalized === 'storm') return { label: 'WET', tone: 'wet' };
  // clear / light cloud / overcast / 미지 값은 DRY로 취급
  return { label: 'DRY', tone: 'dry' };
}

export function formatForecastLabel(minutes: number): string {
  if (minutes <= 0) return 'NOW';
  return `+${Math.round(minutes)}M`;
}

/** DRS(2025)/Overtake(2026) 암전 가능 여부. */
export function driverCanArmDrs(driver: DriverInfo, is2026: boolean): boolean {
  if (is2026) return driver.overtakeAvailable === true;
  return (driver.deltaToCarInFront ?? Infinity) <= 1000;
}
