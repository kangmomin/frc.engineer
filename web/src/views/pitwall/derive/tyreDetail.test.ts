import { describe, expect, it } from 'vitest';
import type { DriverInfo } from '../../../types/telemetry';
import { deriveTyreDetail } from './tyreDetail';

function makeDriver(overrides: Partial<DriverInfo> = {}): DriverInfo {
  return {
    index: 0, name: 'Player', teamId: 0, aiControlled: false, position: 1, currentLapNum: 1,
    speed: 0, topSpeed: 0, throttle: 0, brake: 0, gear: 0, steering: 0, drsActivated: false,
    lastLapTime: 0, bestLapTime: 0, tireCompound: 'soft', tireAge: 0,
    tireWear: [0, 0, 0, 0], tireSurfaceTemp: [0, 0, 0, 0], tireInnerTemp: [0, 0, 0, 0],
    brakeTemp: [], brakeBias: 0, diffOnThrottle: 0, diffOffThrottle: 0, fuelInTank: 0,
    fuelRemainingLaps: 0, fuelMix: 0, ersStoreEnergy: 0, ersDeployMode: 0, ersDeployedThisLap: 0,
    ersHarvestedThisLap: 0, ersEstimatePct: 0, ersEstimateReady: false, ersActualPct: 0,
    ersActualReady: false, sector1TimeMs: 0, sector2TimeMs: 0, currentSector: 0, penalties: 0,
    totalWarnings: 0, cornerCuttingWarnings: 0, numUnservedDriveThroughs: 0,
    numUnservedStopGoPenalties: 0, lapInvalid: false, pitStatus: 0, numPitStops: 0,
    lapDistance: 0, pitStopTimer: 0,
    ...overrides,
  };
}

describe('deriveTyreDetail', () => {
  it('returns null when there is no player', () => {
    expect(deriveTyreDetail(null)).toBeNull();
  });

  it('returns null when the wear array is unavailable (< 4)', () => {
    expect(deriveTyreDetail(makeDriver({ tireWear: [] }))).toBeNull();
    expect(deriveTyreDetail(makeDriver({ tireWear: [10, 20] }))).toBeNull();
  });

  it('renders fresh tyres ([0,0,0,0]) rather than hiding them', () => {
    const vm = deriveTyreDetail(makeDriver({ tireWear: [0, 0, 0, 0], tireSurfaceTemp: [0, 0, 0, 0] }));
    expect(vm).not.toBeNull();
    expect(vm!.wheels.map((w) => w.label)).toEqual(['FL', 'FR', 'RL', 'RR']);
    expect(vm!.wheels[0].wearText).toBe('0%');
    // Garage 0° temps degrade to a dash (physically-impossible reading = not reported).
    expect(vm!.wheels[0].tempText).toBe('—');
  });

  it('maps wear tone and surface/inner temps per wheel', () => {
    const vm = deriveTyreDetail(makeDriver({
      tireWear: [12, 40, 65, 8],
      tireSurfaceTemp: [95, 96, 97, 98],
      tireInnerTemp: [101, 102, 103, 104],
    }));
    expect(vm!.wheels[0].wearColor).toBe('var(--text-secondary)'); // 12 < 35
    expect(vm!.wheels[1].wearColor).toBe('var(--accent-soft)');    // 40 in [35,60)
    expect(vm!.wheels[2].wearColor).toBe('var(--accent-red)');     // 65 >= 60
    expect(vm!.wheels[0].tempText).toBe('95° / 101°');
  });
});
