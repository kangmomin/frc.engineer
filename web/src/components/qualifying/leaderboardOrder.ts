import type { DriverInfo } from '../../types/telemetry';

export function getQualifyingBestLapTime(driver: DriverInfo | null | undefined): number {
  if (!driver) return 0;
  if (Number.isFinite(driver.bestLapTime) && driver.bestLapTime > 0) {
    return driver.bestLapTime;
  }
  if (Number.isFinite(driver.lastLapTime) && driver.lastLapTime > 0) {
    return driver.lastLapTime;
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

function getKnockoutCutoff(sessionType: string | null | undefined): number | null {
  switch ((sessionType ?? '').trim().toUpperCase()) {
    case 'Q2':
    case 'SS2':
      return 15;
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

export function sortQualifyingDrivers(drivers: DriverInfo[], sessionType: string | null | undefined): DriverInfo[] {
  const cutoff = getKnockoutCutoff(sessionType);
  const copy = [...drivers];

  copy.sort((a, b) => {
    const aHasLap = hasRecordedBestLap(a);
    const bHasLap = hasRecordedBestLap(b);
    if (aHasLap !== bHasLap) return aHasLap ? -1 : 1;
    if (!aHasLap && !bHasLap) return a.position - b.position;

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
