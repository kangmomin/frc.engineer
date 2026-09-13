// Synthetic display fixtures, imported only by strategy regression tests.
import type { StrategyContext, StrategyContexts, StrategyObservation, StrategyResult } from './strategy';

export const strategyObservationFixture: StrategyObservation = {
  trackId: 10, tyre: 'Soft', uploads: 5, laps: 120, medianLapMs: 91000, minLapMs: 90000, maxLapMs: 98000,
  fuelLaps: 80, medianFuelKg: 1.5,
};

export const strategyContextFixture: StrategyContext = {
  id: 'a'.repeat(32), trackId: 10, conditions: { packetFormat: 2026, gameYear: 25, gameMajor: 1, gameMinor: 22, formula: 13, sessionType: 15, totalLaps: 30, trackLengthM: 4500, teamId: null,
    rules: { equalPerformance: true, gameMode: 7, ruleSet: 1, sessionLength: 5, surfaceType: 1, lowFuelMode: 0, tyreTemperature: 1, pitLaneTyreSim: 0, ersAssist: 0, pitAssist: 0, pitReleaseAssist: 0, pitStopExperience: 1 } },
  weather: 0, trackTempBucket: 30, tractionControl: 0, abs: 0, users: 3, sessions: 12, cleanLaps: 324,
};
export const strategyCorpusFixture: StrategyContexts = {
  contexts: [strategyContextFixture], records: 12, truncated: false, recordLimit: 300, minUsers: 3, minSessions: 6, minCleanLaps: 40,
  archiveCoverage: { uploadedRaces: 15, withEvidence: 12, withoutEvidence: 3, latestUploadAt: '2026-09-12T03:00:00Z', truncated: false, limit: 300 },
  diagnostics: { collectedLaps: 360, cleanLaps: 324, excludedLaps: 36, excludedRecords: 0,
    exclusions: [{ code: 'pit', records: 12, laps: 24 }, { code: 'race-start', records: 12, laps: 12 }] },
};
export const strategyResultFixture: StrategyResult = {
  status: 'ready', context: strategyContextFixture, reasons: ['not-backtested', 'small-model-difference'], validation: 'in-sample-only',
  compounds: [{ compound: 16, tyre: 'Soft', offsetMs: 0, ageSlopeMs: 110, minAge: 1, maxAge: 16, users: 3, sessions: 12, laps: 150 }, { compound: 18, tyre: 'Hard', offsetMs: 600, ageSlopeMs: 50, minAge: 1, maxAge: 18, users: 3, sessions: 12, laps: 174 }],
  fuelSlopeMsPerKg: 40, lapMedianAbsoluteErrorMs: 1000, pit: { additionalTimeMs: 20000, medianAbsoluteDeviationMs: 800, users: 3, sessions: 12, stops: 12 },
  plans: [{ stints: [{ tyre: 'Soft', compound: 16, startLap: 1, endLap: 12 }, { tyre: 'Hard', compound: 18, startLap: 13, endLap: 30 }], pitLaps: [12], relativeCostMs: 40000, deltaMs: 0 }, { stints: [{ tyre: 'Hard', compound: 18, startLap: 1, endLap: 18 }, { tyre: 'Soft', compound: 16, startLap: 19, endLap: 30 }], pitLaps: [18], relativeCostMs: 40850, deltaMs: 850 }],
  ers: { status: 'observed-budget', users: 3, sessions: 12, laps: 300, deployedJ: 2000000, harvestedJ: 1400000, netUseJ: 600000, startEnergyJ: 3000000, endEnergyJ: 2400000, sustainableLaps: 12,
    segments: [{ deployedJ: 800000, harvestedJ: 600000, durationMs: 30000, meanSpeedKph: 220 }, { deployedJ: 800000, harvestedJ: 500000, durationMs: 30000, meanSpeedKph: 210 }, { deployedJ: 400000, harvestedJ: 300000, durationMs: 30000, meanSpeedKph: 230 }] },
};
