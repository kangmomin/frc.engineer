import { q1AdvancingCount, type QualifyingFormat } from './format';
import type { DriverInfo } from '../../types/telemetry';

export function getQualifyingBestLapTime(driver: DriverInfo | null | undefined): number {
  if (!driver) return 0;
  if (Number.isFinite(driver.bestLapTime) && driver.bestLapTime > 0) {
    return driver.bestLapTime;
  }
  return 0;
}

function hasRecordedBestLap(driver: DriverInfo): boolean {
  return getQualifyingBestLapTime(driver) > 0;
}

function compareDriversByBestLap(a: DriverInfo, b: DriverInfo): number {
  if (!hasRecordedBestLap(a) && !hasRecordedBestLap(b)) {
    return a.position - b.position;
  }
  if (!hasRecordedBestLap(a)) return 1;
  if (!hasRecordedBestLap(b)) return -1;

  const lapDiff = getQualifyingBestLapTime(a) - getQualifyingBestLapTime(b);
  if (lapDiff !== 0) return lapDiff;
  return a.position - b.position;
}

function getKnockoutCutoff(sessionType: string | null | undefined, format?: QualifyingFormat | null): number | null {
  const q1Count = q1AdvancingCount(format);
  if (q1Count === null) return null;
  switch ((sessionType ?? '').trim().toUpperCase()) {
    case 'Q2':
    case 'SS2':
      return q1Count;
    case 'Q3':
    case 'SS3':
      return 10;
    default:
      return null;
  }
}

function getKnockoutGroup(driver: DriverInfo, cutoff: number): number {
  if (driver.position > cutoff) return 2;
  if (driver.position > 0) return 0;
  return 1;
}

export function sortQualifyingDrivers(drivers: DriverInfo[], sessionType: string | null | undefined, format?: QualifyingFormat | null): DriverInfo[] {
  const cutoff = getKnockoutCutoff(sessionType, format);
  const copy = [...drivers];

  copy.sort((a, b) => {
    if (cutoff != null) {
      const aGroup = getKnockoutGroup(a, cutoff);
      const bGroup = getKnockoutGroup(b, cutoff);
      const groupDiff = aGroup - bGroup;
      if (groupDiff !== 0) return groupDiff;
      if (aGroup === 2) return a.position - b.position;
    }
    return compareDriversByBestLap(a, b);
  });

  return copy;
}
