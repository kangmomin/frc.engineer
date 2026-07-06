import { describe, expect, it } from 'vitest';
import type { DriverInfo } from '../../../types/telemetry';
import { deriveCutoffWatch } from './cutoffWatch';
import { deriveQualiSegment } from './qualiSegment';

function makeDriver(index: number, position: number, bestLapTime: number): DriverInfo {
  return {
    index,
    name: `Driver ${index}`,
    teamId: 0,
    aiControlled: false,
    position,
    currentLapNum: 5,
    speed: 0,
    topSpeed: 0,
    throttle: 0,
    brake: 0,
    gear: 0,
    steering: 0,
    drsActivated: false,
    lastLapTime: bestLapTime,
    bestLapTime,
    tireCompound: 'soft',
    tireAge: 3,
    tireWear: [],
    tireSurfaceTemp: [],
    tireInnerTemp: [],
    brakeTemp: [],
    brakeBias: 55,
    diffOnThrottle: 50,
    diffOffThrottle: 50,
    fuelInTank: 10,
    fuelRemainingLaps: 5,
    fuelMix: 2,
    ersStoreEnergy: 2_000_000,
    ersDeployMode: 1,
    ersDeployedThisLap: 0,
    ersHarvestedThisLap: 0,
    ersEstimatePct: 80,
    ersEstimateReady: true,
    ersActualPct: 80,
    ersActualReady: true,
    sector1TimeMs: 0,
    sector2TimeMs: 0,
    currentSector: 0,
    penalties: 0,
    totalWarnings: 0,
    cornerCuttingWarnings: 0,
    numUnservedDriveThroughs: 0,
    numUnservedStopGoPenalties: 0,
    lapInvalid: false,
    pitStatus: 0,
    driverStatus: 1,
    resultStatus: 0,
    numPitStops: 0,
    lapDistance: 0,
    pitStopTimer: 0,
  };
}

// Q1 field of 16: P1..P16 with position === array index + 1, best lap spaced by 100ms.
function makeQ1Field(): DriverInfo[] {
  return Array.from({ length: 16 }, (_, i) => makeDriver(i, i + 1, 90_000 + i * 100));
}

describe('deriveCutoffWatch — no player car', () => {
  it('degrades honestly, no cutoff shown', () => {
    const vm = deriveCutoffWatch(null, [], deriveQualiSegment('Q1'), 300, new Map());
    expect(vm.hasPlayer).toBe(false);
    expect(vm.showCutoff).toBe(false);
    expect(vm.advice).toBe('No player car');
  });
});

describe('deriveCutoffWatch — Q1 safe vs drop zone', () => {
  it('P15 (inside top 15) is provisionally through, margin "Safe by"', () => {
    const sorted = makeQ1Field();
    const player = sorted[14]; // P15
    const vm = deriveCutoffWatch(player, sorted, deriveQualiSegment('Q1'), 300, new Map([[15, 'P16']]));
    expect(vm.showCutoff).toBe(true);
    expect(vm.statusLabel).toBe('PROVISIONALLY THROUGH');
    expect(vm.statusColor).toBe('var(--accent-lime)');
    expect(vm.marginText).toMatch(/^Safe by/);
    expect(vm.cutoffPosText).toBe('P16');
    expect(vm.cutoffCodeText).toBe('P16'); // code map lookup for sorted[15] (index 15)
  });

  it('P16 (first drop) is in the drop zone, margin "Need"', () => {
    const sorted = makeQ1Field();
    const player = sorted[15]; // P16 — the cutoff driver itself
    const vm = deriveCutoffWatch(player, sorted, deriveQualiSegment('Q1'), 300, new Map());
    expect(vm.statusLabel).toBe('IN THE DROP ZONE');
    expect(vm.statusColor).toBe('var(--accent-red)');
    // margin vs itself is 0 -> "Need 0.000s" (not fabricated, genuinely on the cutoff line)
    expect(vm.marginText).toMatch(/^Need/);
  });

  it('margin tile: >0.3s apart is tertiary tone, otherwise secondary', () => {
    const sorted = [makeDriver(0, 1, 90_000), makeDriver(1, 2, 90_500)];
    const vmFar = deriveCutoffWatch(sorted[0], sorted, { segment: 'Q1', safeCount: 1, noCutoff: false, outLabel: '' }, 300, new Map());
    expect(vmFar.marginTileTone).toBe('tertiary'); // 0.5s apart
    const sortedClose = [makeDriver(0, 1, 90_000), makeDriver(1, 2, 90_150)];
    const vmClose = deriveCutoffWatch(sortedClose[0], sortedClose, { segment: 'Q1', safeCount: 1, noCutoff: false, outLabel: '' }, 300, new Map());
    expect(vmClose.marginTileTone).toBe('secondary'); // 0.15s apart
  });
});

describe('deriveCutoffWatch — Q3 (no cutoff, pole fight)', () => {
  it('shows "Fighting for pole" and hides cutoff-specific fields', () => {
    const sorted = [makeDriver(0, 1, 89_500), makeDriver(1, 2, 89_700)];
    const vm = deriveCutoffWatch(sorted[1], sorted, deriveQualiSegment('Q3'), 300, new Map());
    expect(vm.showCutoff).toBe(false);
    expect(vm.statusLabel).toBe('Fighting for pole');
    expect(vm.marginText).toBe('—');
    expect(vm.cutoffPosText).toBe('—');
  });

  it('SS3 mirrors Q3 and also shows "Fighting for pole"', () => {
    const sorted = [makeDriver(0, 1, 89_500)];
    const vm = deriveCutoffWatch(sorted[0], sorted, deriveQualiSegment('SS3'), 300, new Map());
    expect(vm.statusLabel).toBe('Fighting for pole');
  });
});

describe('deriveCutoffWatch — non-standard noCutoff formats (Short Q/OSQ) never claim pole fight (scope L3)', () => {
  it('Short Q has noCutoff but is not a pole shootout — status/advice degrade honestly, not "Fighting for pole"', () => {
    const sorted = [makeDriver(0, 1, 89_500)];
    const vm = deriveCutoffWatch(sorted[0], sorted, deriveQualiSegment('Short Q'), 300, new Map());
    expect(vm.showCutoff).toBe(false);
    expect(vm.statusLabel).toBe('—');
    expect(vm.advice).toBe('Clear track ahead');
  });

  it('OSQ still respects the clock-warning branch over the honest degrade', () => {
    const sorted = [makeDriver(0, 1, 89_500)];
    const vm = deriveCutoffWatch(sorted[0], sorted, deriveQualiSegment('OSQ'), 45, new Map());
    expect(vm.advice).toBe("Under 90s — make sure you're on a lap");
  });
});

describe('deriveCutoffWatch — advice priority (clock > segment > default)', () => {
  it('clock under 90s always wins, even in Q3', () => {
    const sorted = [makeDriver(0, 1, 89_500)];
    const vm = deriveCutoffWatch(sorted[0], sorted, deriveQualiSegment('Q3'), 45, new Map());
    expect(vm.advice).toBe("Under 90s — make sure you're on a lap");
  });

  it('Q3 with plenty of time shows the pole-fight message', () => {
    const sorted = [makeDriver(0, 1, 89_500)];
    const vm = deriveCutoffWatch(sorted[0], sorted, deriveQualiSegment('Q3'), 300, new Map());
    expect(vm.advice).toBe('Final runs — one lap for pole');
  });

  it('Q1 with plenty of time shows the default clear-track message', () => {
    const sorted = makeQ1Field();
    const vm = deriveCutoffWatch(sorted[0], sorted, deriveQualiSegment('Q1'), 300, new Map());
    expect(vm.advice).toBe('Clear track ahead');
  });

  it('unknown sessionTimeLeft (undefined) does not crash and skips the clock branch', () => {
    const sorted = makeQ1Field();
    const vm = deriveCutoffWatch(sorted[0], sorted, deriveQualiSegment('Q1'), undefined, new Map());
    expect(vm.advice).toBe('Clear track ahead');
  });
});
