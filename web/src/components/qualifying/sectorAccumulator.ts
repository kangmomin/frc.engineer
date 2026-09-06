import type { DriverInfo } from '../../types/telemetry';

/** Official history can replace provisional records, including clearing an
 * invalid best. Before history arrives, only completed observed valid laps
 * contribute sector bests. */
export interface SectorAcc {
  bestS1: number;
  bestS2: number;
  bestS3: number;
}

interface PrevSnap {
  currentLapNum: number;
  sector1TimeMs: number;
  sector2TimeMs: number;
  invalid: boolean;
}

const positive = (value: number | null | undefined) => Number.isFinite(value) && value! > 0 ? value! : 0;
const best = (previous: number, current: number) => current > 0 && (previous === 0 || current < previous) ? current : previous;

export function createSectorAccumulator() {
  let key = '';
  let previous = new Map<number, PrevSnap>();
  let accumulated = new Map<number, SectorAcc>();
  let maxLap = 0;
  return {
    ingest(drivers: DriverInfo[], sessionKey: string): Map<number, SectorAcc> {
      const currentMaxLap = Math.max(0, ...drivers.map((driver) => driver.currentLapNum));
      if (key !== sessionKey || (currentMaxLap > 0 && currentMaxLap < maxLap)) {
        previous = new Map();
        accumulated = new Map();
      }
      key = sessionKey;
      maxLap = currentMaxLap;
      let changed = false;
      const next = new Map(accumulated);
      const snapshots = new Map<number, PrevSnap>();
      for (const driver of drivers) {
        const snap = previous.get(driver.index);
        const old = accumulated.get(driver.index);
        let acc = { ...(old ?? { bestS1: 0, bestS2: 0, bestS3: 0 }) };
        if (snap && !snap.invalid && driver.currentLapNum === snap.currentLapNum + 1 && driver.lastLapTime > 0) {
          const s3 = snap.sector1TimeMs > 0 && snap.sector2TimeMs > 0
            ? driver.lastLapTime - snap.sector1TimeMs - snap.sector2TimeMs : 0;
          acc = {
            bestS1: best(acc.bestS1, snap.sector1TimeMs),
            bestS2: best(acc.bestS2, snap.sector2TimeMs),
            bestS3: best(acc.bestS3, s3),
          };
        }
        if (driver.sessionHistoryAvailable) {
          acc = { bestS1: positive(driver.bestSector1Ms), bestS2: positive(driver.bestSector2Ms), bestS3: positive(driver.bestSector3Ms) };
        } else {
          if (driver.bestSector1Ms != null) acc.bestS1 = positive(driver.bestSector1Ms);
          if (driver.bestSector2Ms != null) acc.bestS2 = positive(driver.bestSector2Ms);
          if (driver.bestSector3Ms != null) acc.bestS3 = positive(driver.bestSector3Ms);
        }
        if (!old || old.bestS1 !== acc.bestS1 || old.bestS2 !== acc.bestS2 || old.bestS3 !== acc.bestS3) {
          next.set(driver.index, acc);
          changed = true;
        }
        snapshots.set(driver.index, {
          currentLapNum: driver.currentLapNum,
          sector1TimeMs: positive(driver.sector1TimeMs),
          sector2TimeMs: positive(driver.sector2TimeMs),
          invalid: driver.lapInvalid || (snap?.currentLapNum === driver.currentLapNum && snap.invalid),
        });
      }
      previous = snapshots;
      if (changed) accumulated = next;
      return accumulated;
    },
  };
}
