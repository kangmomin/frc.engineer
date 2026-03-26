import type {
  AppConfig,
  BattleAlert,
  CarPosition,
  DriverInfo,
  PitwallState,
  RaceControlNotification,
  SessionInfo,
  TrackListItem,
} from '../types/telemetry';

const BASE_SESSION: SessionInfo = {
  weather: 'clear',
  trackTemp: 42.4,
  airTemp: 28.1,
  safetyCar: 'none',
  sessionType: 'Race',
  totalLaps: 57,
  trackId: 5,
  trackName: 'Suzuka GP',
  trackLength: 5807,
  pitStopWindowIdealLap: 46,
  pitStopWindowLatestLap: 49,
  pitStopRejoinPosition: 6,
  weatherForecast: [
    {
      sessionType: 'Race',
      timeOffset: 0,
      weather: 'clear',
      trackTemp: 42.4,
      trackTempChange: 0,
      airTemp: 28.1,
      airTempChange: 0,
      rainPercentage: 8,
    },
    {
      sessionType: 'Race',
      timeOffset: 5,
      weather: 'light_cloud',
      trackTemp: 41.9,
      trackTempChange: -1,
      airTemp: 27.6,
      airTempChange: -1,
      rainPercentage: 22,
    },
    {
      sessionType: 'Race',
      timeOffset: 10,
      weather: 'overcast',
      trackTemp: 40.8,
      trackTempChange: -1,
      airTemp: 27.1,
      airTempChange: -1,
      rainPercentage: 31,
    },
  ],
};

interface DriverSeed {
  index: number;
  name: string;
  teamId: number;
  position: number;
  lastLapTime: number;
  bestLapTime: number;
  tireCompound: string;
  tireAge: number;
  gapToLeader: number;
  gapToFront: number;
  fuelRemainingLaps: number;
  fuelInTank: number;
  brakeBias: number;
  diffOnThrottle: number;
  diffOffThrottle: number;
  ersStoreEnergy: number;
  ersDeployMode: number;
  ersDeployedThisLap: number;
  ersHarvestedThisLap: number;
  tireWear: [number, number, number, number];
  tireSurfaceTemp: [number, number, number, number];
  tireInnerTemp: [number, number, number, number];
  brakeTemp: [number, number, number, number];
  damage?: DriverInfo['damage'];
}

const DRIVER_SEEDS: DriverSeed[] = [
  {
    index: 1,
    name: 'Max Verstappen',
    teamId: 2,
    position: 1,
    lastLapTime: 94221,
    bestLapTime: 93811,
    tireCompound: 'Hard',
    tireAge: 12,
    gapToLeader: 0,
    gapToFront: 0,
    fuelRemainingLaps: 14.8,
    fuelInTank: 18.1,
    brakeBias: 56.4,
    diffOnThrottle: 54,
    diffOffThrottle: 50,
    ersStoreEnergy: 3150000,
    ersDeployMode: 2,
    ersDeployedThisLap: 850000,
    ersHarvestedThisLap: 410000,
    tireWear: [63, 66, 57, 58],
    tireSurfaceTemp: [101, 103, 98, 99],
    tireInnerTemp: [97, 101, 95, 96],
    brakeTemp: [488, 496, 451, 462],
  },
  {
    index: 2,
    name: 'Lando Norris',
    teamId: 8,
    position: 2,
    lastLapTime: 93892,
    bestLapTime: 93677,
    tireCompound: 'Medium',
    tireAge: 8,
    gapToLeader: 2441,
    gapToFront: 2441,
    fuelRemainingLaps: 13.4,
    fuelInTank: 16.7,
    brakeBias: 58.5,
    diffOnThrottle: 55,
    diffOffThrottle: 50,
    ersStoreEnergy: 3000000,
    ersDeployMode: 3,
    ersDeployedThisLap: 910000,
    ersHarvestedThisLap: 150000,
    tireWear: [64, 68, 52, 54],
    tireSurfaceTemp: [102, 114, 98, 99],
    tireInnerTemp: [99, 111, 97, 98],
    brakeTemp: [521, 538, 479, 484],
    damage: {
      frontLeftWing: 15,
      frontRightWing: 12,
      rearWing: 2,
      floor: 0,
      diffuser: 0,
      sidepod: 2,
      engine: 0,
      gearbox: 0,
      drsFault: false,
      ersFault: false,
    },
  },
  {
    index: 3,
    name: 'Charles Leclerc',
    teamId: 1,
    position: 3,
    lastLapTime: 94401,
    bestLapTime: 93950,
    tireCompound: 'Hard',
    tireAge: 15,
    gapToLeader: 5119,
    gapToFront: 2678,
    fuelRemainingLaps: 13.1,
    fuelInTank: 16.2,
    brakeBias: 56.8,
    diffOnThrottle: 52,
    diffOffThrottle: 50,
    ersStoreEnergy: 2480000,
    ersDeployMode: 2,
    ersDeployedThisLap: 780000,
    ersHarvestedThisLap: 230000,
    tireWear: [72, 74, 68, 69],
    tireSurfaceTemp: [104, 106, 100, 101],
    tireInnerTemp: [99, 101, 98, 98],
    brakeTemp: [502, 509, 472, 478],
  },
  {
    index: 4,
    name: 'George Russell',
    teamId: 0,
    position: 4,
    lastLapTime: 94992,
    bestLapTime: 94288,
    tireCompound: 'Hard',
    tireAge: 11,
    gapToLeader: 8002,
    gapToFront: 2883,
    fuelRemainingLaps: 12.9,
    fuelInTank: 15.8,
    brakeBias: 56.1,
    diffOnThrottle: 53,
    diffOffThrottle: 49,
    ersStoreEnergy: 2310000,
    ersDeployMode: 1,
    ersDeployedThisLap: 620000,
    ersHarvestedThisLap: 370000,
    tireWear: [59, 61, 56, 57],
    tireSurfaceTemp: [99, 101, 96, 97],
    tireInnerTemp: [95, 98, 93, 94],
    brakeTemp: [468, 474, 439, 447],
  },
  {
    index: 5,
    name: 'Oscar Piastri',
    teamId: 8,
    position: 5,
    lastLapTime: 94662,
    bestLapTime: 94017,
    tireCompound: 'Hard',
    tireAge: 18,
    gapToLeader: 10224,
    gapToFront: 2222,
    fuelRemainingLaps: 12.3,
    fuelInTank: 15.1,
    brakeBias: 57.2,
    diffOnThrottle: 54,
    diffOffThrottle: 50,
    ersStoreEnergy: 2240000,
    ersDeployMode: 1,
    ersDeployedThisLap: 610000,
    ersHarvestedThisLap: 300000,
    tireWear: [78, 80, 71, 73],
    tireSurfaceTemp: [103, 105, 99, 100],
    tireInnerTemp: [100, 102, 97, 98],
    brakeTemp: [499, 505, 470, 476],
  },
];

export const mockConfig: AppConfig = {
  udpPort: 20777,
  backendPort: 17082,
  forwardTargets: [],
  trackRecording: false,
  packetLogging: false,
  raceSummaryRecording: true,
  dataStorageMode: 'summary',
};

export const mockTracks: TrackListItem[] = [
  { name: 'Suzuka Preview', filename: 'suzuka_preview.csv' },
  { name: 'Monza Preview', filename: 'monza_preview.csv' },
];

export function buildMockFrame(tick: number): {
  pitwallState: PitwallState;
  raceControl: RaceControlNotification[];
  battleAlerts: BattleAlert[];
} {
  const wave = Math.sin(tick / 3);
  const lapBase = 44 + Math.floor(tick / 18);
  const session: SessionInfo = {
    ...BASE_SESSION,
    trackTemp: round1(BASE_SESSION.trackTemp + wave * 0.4),
    airTemp: round1(BASE_SESSION.airTemp + wave * 0.2),
  };

  const drivers = DRIVER_SEEDS.map((seed) => buildDriver(seed, tick, lapBase));
  const positions = buildPositions(tick);

  return {
    pitwallState: {
      session,
      drivers,
      positions,
      playerIndex: 2,
    },
    raceControl: [
      {
        id: 'mock-info',
        category: 'info',
        message: 'Preview mode active. Telemetry feed is simulated.',
        severity: 'info',
        timestamp: Date.now(),
      },
      {
        id: 'mock-warn',
        category: 'warning',
        message: 'Pit window opens in 2 laps for car 02.',
        severity: 'warning',
        driverName: 'Lando Norris',
        timestamp: Date.now() - 6000,
      },
    ],
    battleAlerts: [
      {
        id: 'mock-ahead',
        driverAhead: 'Max Verstappen',
        driverBehind: 'Lando Norris',
        gapSeconds: Number((drivers[1].deltaToCarInFront ?? 0) / 1000),
        closingRatePerLap: 0.32 + wave * 0.05,
        estOvertakeLap: 7,
        side: 'ahead',
        timestamp: Date.now(),
      },
      {
        id: 'mock-behind',
        driverAhead: 'Lando Norris',
        driverBehind: 'Charles Leclerc',
        gapSeconds: Number((drivers[2].deltaToCarInFront ?? 0) / 1000),
        closingRatePerLap: -0.15 + wave * 0.03,
        estOvertakeLap: 0,
        side: 'behind',
        timestamp: Date.now(),
      },
    ],
  };
}

function buildDriver(seed: DriverSeed, tick: number, lapBase: number): DriverInfo {
  const wave = Math.sin((tick + seed.position) / 3);
  const wearGrowth = tick * 0.12;
  const playerBias = seed.index === 2 ? 1 : 0;

  return {
    index: seed.index,
    name: seed.name,
    teamId: seed.teamId,
    position: seed.position,
    currentLapNum: lapBase,
    speed: Math.round(286 + (6 - seed.position) * 4 + wave * 9),
    throttle: clamp01(0.78 + wave * 0.08),
    brake: clamp01(0.08 - wave * 0.04),
    gear: 8,
    steering: wave * 0.12,
    lastLapTime: Math.round(seed.lastLapTime - wave * 110),
    bestLapTime: seed.bestLapTime,
    tireCompound: seed.tireCompound,
    tireAge: seed.tireAge + Math.floor(tick / 18),
    tireWear: seed.tireWear.map((value, index) => clamp100(value + wearGrowth + index * 0.6)) as [number, number, number, number],
    tireSurfaceTemp: seed.tireSurfaceTemp.map((value, index) => Math.round(value + wave * 3 + index)) as [number, number, number, number],
    tireInnerTemp: seed.tireInnerTemp.map((value, index) => Math.round(value + wave * 2 + index * 0.5)) as [number, number, number, number],
    brakeTemp: seed.brakeTemp.map((value, index) => Math.round(value + wave * 8 + index * 4)) as [number, number, number, number],
    brakeBias: seed.brakeBias,
    diffOnThrottle: seed.diffOnThrottle,
    diffOffThrottle: seed.diffOffThrottle,
    fuelInTank: round1(seed.fuelInTank - tick * 0.06),
    fuelRemainingLaps: round2(seed.fuelRemainingLaps - tick * 0.02),
    fuelMix: 2,
    ersStoreEnergy: Math.max(0, Math.round(seed.ersStoreEnergy - tick * 3500 + wave * 50000)),
    ersDeployMode: seed.ersDeployMode,
    ersDeployedThisLap: Math.round(seed.ersDeployedThisLap + tick * 2200),
    ersHarvestedThisLap: Math.round(seed.ersHarvestedThisLap + tick * 1700),
    stintHistory: [
      { compound: 'Soft', laps: 10 },
      { compound: seed.tireCompound, laps: seed.tireAge + Math.floor(tick / 18) },
    ],
    damage: seed.damage,
    sector1TimeMs: 31650 + Math.round(wave * 90),
    sector2TimeMs: 32100 + Math.round(wave * 70),
    currentSector: (tick + seed.position) % 3,
    dynamics: [
      { lapNum: lapBase - 2, understeerPct: 7.4, oversteerPct: 4.2, lockupCount: 0, spinCount: 0 },
      { lapNum: lapBase - 1, understeerPct: 6.8, oversteerPct: 5.1, lockupCount: 1, spinCount: 0 },
    ],
    pitStatus: 0,
    driverStatus: 1,
    numPitStops: 1,
    lapDistance: 3920 + tick * 35 + seed.position * 16,
    pitStopTimer: 0,
    deltaToCarInFront: seed.position === 1 ? undefined : Math.max(900, Math.round(seed.gapToFront - wave * 120 + playerBias * 40)),
    deltaToRaceLeader: seed.position === 1 ? undefined : Math.max(0, Math.round(seed.gapToLeader - wave * 130 + playerBias * 40)),
    pitLaneTime: 22800,
  };
}

function buildPositions(tick: number): CarPosition[] {
  return DRIVER_SEEDS.map((driver, index) => ({
    index: driver.index,
    x: Math.cos((tick + index * 14) / 8) * (220 - index * 12),
    y: 0,
    z: Math.sin((tick + index * 14) / 8) * (180 - index * 9),
  }));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clamp100(value: number): number {
  return Math.max(0, Math.min(100, round1(value)));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
