import { describe, expect, it } from 'vitest';

import type { RaceListItem, ReplayFrame } from '../../types/telemetry';
import {
  buildReplayMarkers,
  filterRaceArchive,
  formatRaceFileSize,
  resolveRaceArchiveOpenMode,
  type RaceArchiveFilters,
} from './replayArchive';

const DEFAULT_FILTERS: RaceArchiveFilters = {
  search: '',
  track: 'all',
  session: 'all',
  storageMode: 'all',
  replayOnly: false,
};

describe('filterRaceArchive', () => {
  const races: RaceListItem[] = [
    {
      id: 'race-1',
      savedAtLocal: '2026-04-01 20:00:00',
      trackName: 'Belgium',
      sessionType: 'Race',
      playerName: 'Alex',
      finalPosition: 3,
      fileSizeBytes: 2048,
      dataStorageMode: 'advanced',
      hasReplay: true,
      frameCount: 120,
    },
    {
      id: 'race-2',
      savedAtLocal: '2026-04-02 20:00:00',
      trackName: 'Italy (Monza)',
      sessionType: 'Q1',
      playerName: 'Jordan',
      finalPosition: 11,
      fileSizeBytes: 1024,
      dataStorageMode: 'resultOnly',
      hasReplay: false,
      frameCount: 0,
    },
  ];

  it('filters by search and replay availability', () => {
    const filtered = filterRaceArchive(races, {
      ...DEFAULT_FILTERS,
      search: 'belgium alex',
      replayOnly: true,
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('race-1');
  });
});

describe('buildReplayMarkers', () => {
  it('creates SC, penalty, and battle markers without duplicates', () => {
    const frames = Array.from({ length: 10 }, (_, index) => createFrame(index));
    frames[2].pitwall.session!.safetyCar = 'virtual';
    frames[3].raceControl = [{
      id: 'rc-1',
      category: 'warning',
      message: 'Track limits',
      severity: 'warning',
      timestamp: 3_000,
    }];
    frames[4].raceControl = [{
      id: 'rc-1',
      category: 'warning',
      message: 'Track limits',
      severity: 'warning',
      timestamp: 3_000,
    }];
    for (let index = 1; index <= 8; index += 1) {
      frames[index].pitwall.drivers[0].deltaToCarInFront = 900;
    }

    const markers = buildReplayMarkers(frames);

    expect(markers.some((marker) => marker.type === 'safety-car' && marker.label === 'VSC')).toBe(true);
    expect(markers.filter((marker) => marker.type === 'penalty')).toHaveLength(1);
    expect(markers.some((marker) => marker.type === 'battle' && marker.label === 'Attack')).toBe(true);
  });
});

describe('formatRaceFileSize', () => {
  it('formats byte sizes into readable units', () => {
    expect(formatRaceFileSize(1536)).toBe('1.5 KB');
  });
});

describe('resolveRaceArchiveOpenMode', () => {
  it('opens result-only races as result modals', () => {
    expect(resolveRaceArchiveOpenMode({
      id: 'race-result',
      savedAtLocal: '2026-04-03 20:00:00',
      trackName: 'Belgium',
      sessionType: 'Race',
      playerName: 'Alex',
      finalPosition: 2,
      fileSizeBytes: 1024,
      dataStorageMode: 'resultOnly',
      hasReplay: false,
      frameCount: 0,
    })).toBe('result');
  });

  it('keeps summary archives in modal mode', () => {
    expect(resolveRaceArchiveOpenMode({
      id: 'race-summary',
      savedAtLocal: '2026-04-03 21:00:00',
      trackName: 'Belgium',
      sessionType: 'Race',
      playerName: 'Alex',
      finalPosition: 2,
      fileSizeBytes: 2048,
      dataStorageMode: 'summary',
      hasReplay: true,
      frameCount: 120,
    })).toBe('summary');
  });

  it('opens advanced archives with frames as full replay', () => {
    expect(resolveRaceArchiveOpenMode({
      id: 'race-replay',
      savedAtLocal: '2026-04-03 22:00:00',
      trackName: 'Belgium',
      sessionType: 'Race',
      playerName: 'Alex',
      finalPosition: 2,
      fileSizeBytes: 4096,
      dataStorageMode: 'advanced',
      hasReplay: true,
      frameCount: 220,
    })).toBe('replay');
  });
});

function createFrame(index: number): ReplayFrame {
  return {
    timestamp: index * 1_000,
    pitwall: {
      session: {
        weather: 'clear',
        trackTemp: 30,
        airTemp: 20,
        safetyCar: 'none',
        sessionType: 'Race',
        totalLaps: 10,
        trackId: 1,
        trackName: 'Belgium',
        trackLength: 7000,
      },
      drivers: [
        {
          index: 7,
          name: 'Player',
          teamId: 0,
          aiControlled: false,
          position: 2,
          currentLapNum: 5,
          speed: 300,
          topSpeed: 320,
          throttle: 1,
          brake: 0,
          gear: 8,
          steering: 0,
          drsActivated: false,
          lastLapTime: 90_000,
          bestLapTime: 89_500,
          tireCompound: 'soft',
          tireAge: 4,
          tireWear: [10, 10, 10, 10],
          tireSurfaceTemp: [90, 90, 90, 90],
          tireInnerTemp: [92, 92, 92, 92],
          brakeTemp: [500, 500, 500, 500],
          brakeBias: 56,
          diffOnThrottle: 60,
          diffOffThrottle: 52,
          fuelInTank: 10,
          fuelRemainingLaps: 5,
          fuelMix: 0,
          ersStoreEnergy: 50,
          ersDeployMode: 2,
          ersDeployedThisLap: 10,
          ersHarvestedThisLap: 5,
          ersEstimatePct: 60,
          ersEstimateReady: true,
          ersActualPct: 55,
          ersActualReady: true,
          sector1TimeMs: 30_000,
          sector2TimeMs: 60_000,
          currentSector: 2,
          penalties: 0,
          totalWarnings: 0,
          cornerCuttingWarnings: 0,
          numUnservedDriveThroughs: 0,
          numUnservedStopGoPenalties: 0,
          lapInvalid: false,
          pitStatus: 0,
          driverStatus: 1,
          resultStatus: 2,
          numPitStops: 0,
          lapDistance: 1_500,
          pitStopTimer: 0,
          deltaToCarInFront: 3_000,
          deltaToRaceLeader: 1_200,
        },
        {
          index: 8,
          name: 'Ahead',
          teamId: 1,
          aiControlled: false,
          position: 1,
          currentLapNum: 5,
          speed: 301,
          topSpeed: 322,
          throttle: 1,
          brake: 0,
          gear: 8,
          steering: 0,
          drsActivated: false,
          lastLapTime: 89_000,
          bestLapTime: 88_500,
          tireCompound: 'medium',
          tireAge: 5,
          tireWear: [12, 12, 12, 12],
          tireSurfaceTemp: [91, 91, 91, 91],
          tireInnerTemp: [93, 93, 93, 93],
          brakeTemp: [501, 501, 501, 501],
          brakeBias: 56,
          diffOnThrottle: 60,
          diffOffThrottle: 52,
          fuelInTank: 11,
          fuelRemainingLaps: 5,
          fuelMix: 0,
          ersStoreEnergy: 51,
          ersDeployMode: 2,
          ersDeployedThisLap: 10,
          ersHarvestedThisLap: 5,
          ersEstimatePct: 60,
          ersEstimateReady: true,
          ersActualPct: 55,
          ersActualReady: true,
          sector1TimeMs: 30_000,
          sector2TimeMs: 60_000,
          currentSector: 2,
          penalties: 0,
          totalWarnings: 0,
          cornerCuttingWarnings: 0,
          numUnservedDriveThroughs: 0,
          numUnservedStopGoPenalties: 0,
          lapInvalid: false,
          pitStatus: 0,
          driverStatus: 1,
          resultStatus: 2,
          numPitStops: 0,
          lapDistance: 1_600,
          pitStopTimer: 0,
          deltaToCarInFront: 0,
          deltaToRaceLeader: 0,
        },
        {
          index: 9,
          name: 'Behind',
          teamId: 2,
          aiControlled: false,
          position: 3,
          currentLapNum: 5,
          speed: 299,
          topSpeed: 319,
          throttle: 1,
          brake: 0,
          gear: 8,
          steering: 0,
          drsActivated: false,
          lastLapTime: 90_500,
          bestLapTime: 90_000,
          tireCompound: 'hard',
          tireAge: 7,
          tireWear: [15, 15, 15, 15],
          tireSurfaceTemp: [89, 89, 89, 89],
          tireInnerTemp: [90, 90, 90, 90],
          brakeTemp: [490, 490, 490, 490],
          brakeBias: 56,
          diffOnThrottle: 60,
          diffOffThrottle: 52,
          fuelInTank: 12,
          fuelRemainingLaps: 5,
          fuelMix: 0,
          ersStoreEnergy: 48,
          ersDeployMode: 2,
          ersDeployedThisLap: 10,
          ersHarvestedThisLap: 5,
          ersEstimatePct: 60,
          ersEstimateReady: true,
          ersActualPct: 55,
          ersActualReady: true,
          sector1TimeMs: 30_000,
          sector2TimeMs: 60_000,
          currentSector: 2,
          penalties: 0,
          totalWarnings: 0,
          cornerCuttingWarnings: 0,
          numUnservedDriveThroughs: 0,
          numUnservedStopGoPenalties: 0,
          lapInvalid: false,
          pitStatus: 0,
          driverStatus: 1,
          resultStatus: 2,
          numPitStops: 0,
          lapDistance: 1_400,
          pitStopTimer: 0,
          deltaToCarInFront: 1_500,
          deltaToRaceLeader: 2_000,
        },
      ],
      positions: [],
      playerIndex: 7,
      ersEstimateEnabled: true,
      ersComparisonEnabled: true,
    },
    raceControl: [],
  };
}
