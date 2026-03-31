import type {
  AppConfig,
  BattleAlert,
  CarDamage,
  CarPosition,
  DriverInfo,
  PitwallState,
  RaceControlNotification,
  SessionInfo,
  TelemetryData,
  TrackListItem,
  TrackMapData,
  TrackPoint,
  WeatherForecast,
  WSResponse,
} from '../types/telemetry';

const MAX_CARS = 22;
const PLAYER_INDEX = 2;
const TRACK_LENGTH = 5807;
const TOTAL_LAPS = 53;
const BASE_TOTAL_PROGRESS = 43.38;
const AVERAGE_LAP_TIME_MS = 93_800;
const FRAME_INTERVAL_MS = 250;
const TAU = Math.PI * 2;
const TRACK_MAP = buildTrackMap();

interface DriverSeed {
  index: number;
  name: string;
  teamId: number;
  tireCompound: DriverInfo['tireCompound'];
  tireAge: number;
  intervalMs: number;
  baseLapMs: number;
  bestLapMs: number;
  pitStops: number;
  fuelBias: number;
  ersBias: number;
  brakeBias: number;
  diffOnThrottle: number;
  diffOffThrottle: number;
  penalties?: number;
  warnings?: number;
  cornerCuts?: number;
  damage?: CarDamage;
}

interface DriverFrame {
  progress: number;
  totalLaps: number;
  driver: DriverInfo;
}

const BASE_FORECAST: WeatherForecast[] = [
  {
    sessionType: 'Race',
    timeOffset: 0,
    weather: 'overcast',
    trackTemp: 31.8,
    trackTempChange: 1,
    airTemp: 24.1,
    airTempChange: 1,
    rainPercentage: 12,
  },
  {
    sessionType: 'Race',
    timeOffset: 5,
    weather: 'light_cloud',
    trackTemp: 30.9,
    trackTempChange: 1,
    airTemp: 23.7,
    airTempChange: 1,
    rainPercentage: 18,
  },
  {
    sessionType: 'Race',
    timeOffset: 10,
    weather: 'light_rain',
    trackTemp: 29.8,
    trackTempChange: 1,
    airTemp: 23.1,
    airTempChange: 1,
    rainPercentage: 38,
  },
  {
    sessionType: 'Race',
    timeOffset: 15,
    weather: 'light_rain',
    trackTemp: 28.6,
    trackTempChange: 1,
    airTemp: 22.8,
    airTempChange: 1,
    rainPercentage: 54,
  },
];

const BASE_SESSION: SessionInfo = {
  weather: 'overcast',
  trackTemp: 31.8,
  airTemp: 24.1,
  safetyCar: 'none',
  sessionType: 'Race',
  totalLaps: TOTAL_LAPS,
  trackId: 12,
  trackName: 'suzuka',
  trackLength: TRACK_LENGTH,
  pitStopWindowIdealLap: 44,
  pitStopWindowLatestLap: 47,
  pitStopRejoinPosition: 7,
  marshalZones: [
    { start: 0.04, flag: 0 },
    { start: 0.16, flag: 0 },
    { start: 0.31, flag: 0 },
    { start: 0.47, flag: 0 },
    { start: 0.62, flag: 0 },
    { start: 0.78, flag: 0 },
    { start: 0.91, flag: 0 },
  ],
  weatherForecast: BASE_FORECAST,
  crossoverPrediction: {
    available: true,
    dryGroup: 'hard',
    wetGroup: 'inter',
    currentDeltaMs: 1240,
    trendDeltaMsPerLap: -210,
    avgLapTimeMs: AVERAGE_LAP_TIME_MS,
    drySampleCount: 18,
    wetSampleCount: 4,
    historyDepth: 22,
    currentDryAvgMs: 93_980,
    currentWetAvgMs: 95_220,
  },
};

function seed(
  index: number,
  name: string,
  teamId: number,
  tireCompound: DriverInfo['tireCompound'],
  tireAge: number,
  intervalMs: number,
  baseLapMs: number,
  bestLapMs: number,
  overrides: Partial<Omit<DriverSeed, 'index' | 'name' | 'teamId' | 'tireCompound' | 'tireAge' | 'intervalMs' | 'baseLapMs' | 'bestLapMs'>> = {},
): DriverSeed {
  return {
    index,
    name,
    teamId,
    tireCompound,
    tireAge,
    intervalMs,
    baseLapMs,
    bestLapMs,
    pitStops: 1,
    fuelBias: 0,
    ersBias: 0,
    brakeBias: 56,
    diffOnThrottle: 54,
    diffOffThrottle: 50,
    ...overrides,
  };
}

const DRIVER_SEEDS: DriverSeed[] = [
  seed(0, 'Max Verstappen', 2, 'hard', 18, 0, 91_388, 90_722, { fuelBias: 0.7, ersBias: 140_000, brakeBias: 56 }),
  seed(1, 'Oscar Piastri', 8, 'hard', 17, 1_480, 91_522, 90_810, { fuelBias: 0.4, ersBias: 110_000, brakeBias: 56 }),
  seed(2, 'Lando Norris', 8, 'hard', 16, 940, 91_708, 91_104, {
    fuelBias: 0.2,
    ersBias: 80_000,
    brakeBias: 57,
    diffOnThrottle: 55,
    damage: {
      frontLeftWing: 6,
      frontRightWing: 4,
      rearWing: 0,
      floor: 2,
      diffuser: 0,
      sidepod: 1,
      engine: 0,
      gearbox: 0,
      drsFault: false,
      ersFault: false,
    },
  }),
  seed(3, 'Charles Leclerc', 1, 'medium', 9, 1_820, 92_004, 91_241, { fuelBias: -0.2, ersBias: 90_000, brakeBias: 56 }),
  seed(4, 'George Russell', 0, 'hard', 19, 1_110, 92_241, 91_566, { fuelBias: 0.6, ersBias: 20_000, brakeBias: 56 }),
  seed(5, 'Lewis Hamilton', 1, 'hard', 18, 1_030, 92_314, 91_630, { fuelBias: 0.1, ersBias: 35_000, brakeBias: 57 }),
  seed(6, 'Fernando Alonso', 4, 'hard', 21, 2_460, 93_118, 92_201, { fuelBias: 0.5, ersBias: -20_000, brakeBias: 55 }),
  seed(7, 'Carlos Sainz', 3, 'medium', 12, 1_190, 93_241, 92_488, { fuelBias: -0.1, ersBias: 60_000, brakeBias: 57, diffOnThrottle: 53 }),
  seed(8, 'Alexander Albon', 3, 'medium', 11, 860, 93_402, 92_775, { fuelBias: -0.1, ersBias: 45_000, brakeBias: 56 }),
  seed(9, 'Lance Stroll', 4, 'hard', 20, 740, 93_688, 92_904, { fuelBias: 0.3, ersBias: -10_000, brakeBias: 55 }),
  seed(10, 'Pierre Gasly', 5, 'medium', 13, 950, 93_944, 93_141, { fuelBias: 0, ersBias: 15_000, brakeBias: 56, warnings: 1, cornerCuts: 1 }),
  seed(11, 'Yuki Tsunoda', 6, 'medium', 12, 820, 94_118, 93_304, { fuelBias: -0.2, ersBias: 55_000, brakeBias: 57 }),
  seed(12, 'Esteban Ocon', 7, 'hard', 18, 1_520, 94_402, 93_577, { fuelBias: 0.1, ersBias: -35_000, brakeBias: 55 }),
  seed(13, 'Nico Hulkenberg', 9, 'hard', 17, 1_140, 94_622, 93_810, { fuelBias: 0.2, ersBias: -25_000, brakeBias: 56 }),
  seed(14, 'Oliver Bearman', 7, 'medium', 10, 930, 94_908, 94_114, { fuelBias: -0.1, ersBias: 20_000, brakeBias: 57 }),
  seed(15, 'Gabriel Bortoleto', 9, 'medium', 9, 880, 95_121, 94_428, { fuelBias: -0.3, ersBias: 35_000, brakeBias: 57 }),
  seed(16, 'Liam Lawson', 6, 'soft', 7, 1_080, 95_409, 94_606, {
    fuelBias: -0.4,
    ersBias: 65_000,
    brakeBias: 58,
    warnings: 2,
    cornerCuts: 1,
    penalties: 5,
  }),
  seed(17, 'Jack Doohan', 5, 'soft', 6, 690, 95_588, 94_744, { fuelBias: -0.5, ersBias: 70_000, brakeBias: 58 }),
  seed(18, 'Andrea Kimi Antonelli', 0, 'medium', 11, 820, 95_862, 95_055, { fuelBias: 0.1, ersBias: 25_000, brakeBias: 56 }),
  seed(19, 'Isack Hadjar', 6, 'medium', 10, 760, 96_118, 95_308, { fuelBias: -0.2, ersBias: 30_000, brakeBias: 57 }),
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
  { name: 'monza', filename: 'monza_recorded.txt' },
  { name: 'singapore', filename: 'singapore_recorded.txt' },
  { name: 'austria', filename: 'austria_recorded.txt' },
];

export function buildMockMessages(tick: number): string[] {
  const frame = buildMockFrame(tick);
  const messages = [
    JSON.stringify(frame.dashboardTelemetry),
    encodeMessage('pitwallState', frame.pitwallState),
  ];

  for (const notification of frame.raceControl) {
    messages.push(encodeMessage('raceControl', notification));
  }
  for (const alert of frame.battleAlerts) {
    messages.push(encodeMessage('battleAlert', alert));
  }

  return messages;
}

export function buildMockFrame(tick: number): {
  pitwallState: PitwallState;
  dashboardTelemetry: TelemetryData;
  raceControl: RaceControlNotification[];
  battleAlerts: BattleAlert[];
} {
  const session = buildSession(tick);
  const leaderTotalLaps = BASE_TOTAL_PROGRESS + tick * (FRAME_INTERVAL_MS / AVERAGE_LAP_TIME_MS);
  const driverFrames = buildDriverFrames(tick, leaderTotalLaps);
  const pitwallState: PitwallState = {
    session,
    drivers: driverFrames.map((frame) => frame.driver),
    positions: buildPositions(driverFrames),
    playerIndex: PLAYER_INDEX,
    trackMap: TRACK_MAP,
    ersComparisonEnabled: true,
  };

  const player = driverFrames.find((frame) => frame.driver.index === PLAYER_INDEX)?.driver ?? driverFrames[0].driver;

  return {
    pitwallState,
    dashboardTelemetry: buildDashboardTelemetry(player, driverFrames, tick),
    raceControl: buildRaceControlEvents(tick, player),
    battleAlerts: buildBattleAlerts(tick, pitwallState.drivers, player),
  };
}

function buildSession(tick: number): SessionInfo {
  const weatherWave = Math.sin(tick / 32);
  const rainBias = Math.max(0, Math.sin((tick - 10) / 20));

  return {
    ...BASE_SESSION,
    weather: rainBias > 0.58 ? 'light_rain' : BASE_SESSION.weather,
    trackTemp: round1(BASE_SESSION.trackTemp - rainBias * 2.2 + weatherWave * 0.4),
    airTemp: round1(BASE_SESSION.airTemp - rainBias * 1.1 + weatherWave * 0.2),
    weatherForecast: BASE_FORECAST.map((forecast, index) => ({
      ...forecast,
      trackTemp: round1(forecast.trackTemp - rainBias * (index + 1) * 0.5),
      airTemp: round1(forecast.airTemp - rainBias * (index + 1) * 0.3),
      rainPercentage: clampInt(
        Math.round(forecast.rainPercentage + rainBias * 18 + index * 3),
        0,
        100,
      ),
    })),
    crossoverPrediction: {
      available: true,
      dryGroup: 'hard',
      wetGroup: 'inter',
      currentDeltaMs: Math.round(1_240 - rainBias * 620 + weatherWave * 40),
      trendDeltaMsPerLap: Math.round(-210 - rainBias * 110 + weatherWave * 18),
      avgLapTimeMs: AVERAGE_LAP_TIME_MS,
      drySampleCount: 18,
      wetSampleCount: 4,
      historyDepth: 22,
      currentDryAvgMs: Math.round(93_980 + rainBias * 180),
      currentWetAvgMs: Math.round(95_220 - rainBias * 220),
    },
  };
}

function buildDriverFrames(tick: number, leaderTotalLaps: number): DriverFrame[] {
  let cumulativeGapMs = 0;

  const frames = DRIVER_SEEDS.map((seed, orderIndex) => {
    if (orderIndex > 0) {
      const intervalPulse = Math.sin(tick / 6 + orderIndex * 0.75) * Math.min(220, seed.intervalMs * 0.14);
      cumulativeGapMs += Math.max(380, Math.round(seed.intervalMs + intervalPulse));
    }

    const totalLaps = leaderTotalLaps - cumulativeGapMs / seed.baseLapMs;
    const progress = fractional(totalLaps);
    const currentLapNum = Math.floor(totalLaps) + 1;
    const sector = getSector(progress);
    const driving = buildDrivingState(progress, tick, orderIndex, cumulativeGapMs);
    const tireAge = Math.max(1, seed.tireAge + (currentLapNum - Math.floor(BASE_TOTAL_PROGRESS) - 1));
    const averageWear = getAverageWear(seed.tireCompound, tireAge, tick, orderIndex);
    const tireWear = wheelMap(orderIndex, [2.2, 3.4, -1.1, -0.4], (offset) => clamp100(averageWear + offset));
    const tireSurfaceTemp = wheelMap(orderIndex, [4, 6, 1, 2], (offset, wheelIndex) =>
      clampInt(
        Math.round(86 + driving.straightBias * 15 + driving.cornerLoad * 11 + offset + wheelIndex * 0.5 + Math.sin(tick / 5 + wheelIndex) * 2),
        72,
        118,
      ),
    );
    const tireInnerTemp = wheelMap(orderIndex, [2, 3, 0, 1], (offset, wheelIndex) =>
      clampInt(
        Math.round(82 + driving.straightBias * 12 + driving.cornerLoad * 8 + offset + wheelIndex * 0.4 + Math.cos(tick / 6 + wheelIndex) * 1.6),
        68,
        110,
      ),
    );
    const brakeTemp = wheelMap(orderIndex, [28, 36, 14, 20], (offset, wheelIndex) =>
      clampInt(
        Math.round(438 + driving.cornerLoad * 255 + driving.brake * 145 + offset + wheelIndex * 3 + orderIndex * 2),
        360,
        980,
      ),
    );
    const lastLapTime = Math.round(seed.baseLapMs + Math.sin(tick / 5 + orderIndex * 0.7) * 120 + driving.cornerLoad * 160);
    const bestLapTime = Math.min(lastLapTime - 120, seed.bestLapMs);
    const fuelRemainingLaps = round2(Math.max(0, TOTAL_LAPS - currentLapNum + 1.2 + seed.fuelBias - orderIndex * 0.03));
    const fuelInTank = round1(Math.max(0.5, fuelRemainingLaps * 1.68 + seed.fuelBias));
    const ersStoreEnergy = clampInt(
      Math.round(2_280_000 + seed.ersBias + Math.sin(tick / 4 + orderIndex * 0.5) * 240_000 - driving.throttle * 140_000),
      350_000,
      4_000_000,
    );
    const ersDeployMode = orderIndex <= 5 ? 3 : orderIndex <= 12 ? 2 : 1;
    const ersDeployedThisLap = clampInt(Math.round(220_000 + progress * 620_000 + driving.throttle * 160_000), 50_000, 1_100_000);
    const ersHarvestedThisLap = clampInt(Math.round(160_000 + driving.brake * 420_000 + (1 - progress) * 110_000), 40_000, 950_000);
    const ersEstimatePct = clampInt(
      Math.round((ersStoreEnergy / 4_000_000) * 100 + Math.sin(tick / 9 + orderIndex * 0.4) * 2),
      0,
      100,
    );

    const driver: DriverInfo = {
      index: seed.index,
      name: seed.name,
      teamId: seed.teamId,
      position: orderIndex + 1,
      currentLapNum,
      speed: driving.speed,
      topSpeed: clampInt(driving.speed + 8 + (orderIndex % 4) * 3, driving.speed, 352),
      throttle: round2(driving.throttle),
      brake: round2(driving.brake),
      gear: driving.gear,
      steering: round2(driving.steering),
      lastLapTime,
      bestLapTime,
      tireCompound: seed.tireCompound,
      tireAge,
      tireWear,
      tireSurfaceTemp,
      tireInnerTemp,
      brakeTemp,
      brakeBias: seed.brakeBias,
      diffOnThrottle: seed.diffOnThrottle,
      diffOffThrottle: seed.diffOffThrottle,
      fuelInTank,
      fuelRemainingLaps,
      fuelMix: orderIndex <= 4 ? 3 : 2,
      ersStoreEnergy,
      ersDeployMode,
      ersDeployedThisLap,
      ersHarvestedThisLap,
      ersEstimatePct,
      ersEstimateReady: true,
      ersActualPct: Math.round((ersStoreEnergy / 4_000_000) * 100),
      ersActualReady: true,
      stintHistory: [
        { compound: orderIndex < 8 ? 'medium' : 'hard', laps: clampInt(currentLapNum - tireAge - 1, 8, 32) },
        { compound: seed.tireCompound, laps: tireAge },
      ],
      damage: seed.damage,
      sector1TimeMs: Math.round(lastLapTime * 0.338 + Math.sin(orderIndex) * 45),
      sector2TimeMs: Math.round(lastLapTime * 0.354 + Math.cos(orderIndex) * 40),
      currentSector: sector,
      dynamics: seed.index === PLAYER_INDEX
        ? [
            { lapNum: currentLapNum - 2, understeerPct: 8.6, oversteerPct: 4.2, lockupCount: 1, spinCount: 0 },
            { lapNum: currentLapNum - 1, understeerPct: 7.9, oversteerPct: 4.8, lockupCount: 0, spinCount: 0 },
            { lapNum: currentLapNum, understeerPct: 7.3, oversteerPct: 5.4, lockupCount: driving.brake > 0.7 ? 1 : 0, spinCount: 0 },
          ]
        : undefined,
      penalties: seed.penalties ?? 0,
      totalWarnings: seed.warnings ?? 0,
      cornerCuttingWarnings: seed.cornerCuts ?? 0,
      numUnservedDriveThroughs: 0,
      numUnservedStopGoPenalties: 0,
      lapInvalid: false,
      pitStatus: 0,
      driverStatus: 1,
      numPitStops: seed.pitStops,
      lapDistance: round1(progress * TRACK_LENGTH),
      pitStopTimer: 0,
      deltaToCarInFront: orderIndex === 0 ? 0 : cumulativeGapMs,
      deltaToRaceLeader: cumulativeGapMs,
      deltaToPlayer: 0,
      pitLaneTime: 0,
    };

    return { progress, totalLaps, driver };
  });

  const playerFrame = frames.find((frame) => frame.driver.index === PLAYER_INDEX);
  const playerLeaderDelta = playerFrame?.driver.deltaToRaceLeader ?? 0;

  return frames.map((frame) => ({
    ...frame,
    driver: {
      ...frame.driver,
      deltaToPlayer: (frame.driver.deltaToRaceLeader ?? 0) - playerLeaderDelta,
    },
  }));
}

function buildDrivingState(progress: number, tick: number, orderIndex: number, gapToLeaderMs: number) {
  const cornerLoad = Math.min(1, Math.max(
    gaussian(progress, 0.08, 0.03),
    gaussian(progress, 0.28, 0.04),
    gaussian(progress, 0.51, 0.035),
    gaussian(progress, 0.71, 0.03),
    gaussian(progress, 0.92, 0.028),
  ) * 1.18);
  const straightBias = clamp01(1 - cornerLoad);
  const paceBias = clamp(-12, 8, 6 - orderIndex * 0.8 - gapToLeaderMs / 8_000);
  const speed = clampInt(
    Math.round(112 + straightBias * 216 + paceBias + Math.sin(tick / 5 + progress * TAU * 3) * 4),
    82,
    339,
  );
  const throttle = clamp01(0.24 + straightBias * 0.78 + Math.sin(tick / 7 + progress * TAU) * 0.05);
  const brake = clamp01(cornerLoad * 0.92 + (1 - straightBias) * 0.08);
  const gear = clampInt(Math.round(2 + straightBias * 6), 1, 8);
  const steering = clamp(-1, 1, Math.sin(progress * TAU * 6 + tick / 9) * (0.1 + cornerLoad * 0.72));

  return { cornerLoad, straightBias, speed, throttle, brake, gear, steering };
}

function buildPositions(driverFrames: DriverFrame[]): CarPosition[] {
  const positions = Array.from({ length: MAX_CARS }, (_, index) => ({
    index,
    x: round2(TRACK_MAP.maxX + 60 + index * 4),
    y: -4,
    z: round2(TRACK_MAP.minZ - 40),
  }));

  for (const frame of driverFrames) {
    const laneOffset = ((frame.driver.position % 3) - 1) * 4;
    const sampled = sampleTrackPosition(frame.progress, laneOffset);
    positions[frame.driver.index] = {
      index: frame.driver.index,
      x: sampled.x,
      y: 0,
      z: sampled.z,
    };
  }

  return positions;
}

function buildDashboardTelemetry(player: DriverInfo, driverFrames: DriverFrame[], tick: number): TelemetryData {
  const playerFrame = driverFrames.find((frame) => frame.driver.index === player.index);
  const lapProgress = playerFrame ? fractional(playerFrame.totalLaps) : fractional(BASE_TOTAL_PROGRESS);
  const currentLapTarget = player.bestLapTime + Math.max(0, player.lastLapTime - player.bestLapTime) + 220;
  const currentLapTime = Math.round(currentLapTarget * lapProgress);

  return {
    speed: player.speed,
    gear: player.gear,
    rpm: clampInt(Math.round(7_400 + player.speed * 22 + player.throttle * 680), 7_200, 12_100),
    throttle: player.throttle,
    brake: player.brake,
    deltaPersonalBest: Math.round((player.lastLapTime - player.bestLapTime) * lapProgress + Math.sin(tick / 6) * 18),
    deltaCarInFront: player.deltaToCarInFront ?? 0,
    deltaRaceLeader: player.deltaToRaceLeader ?? 0,
    currentLap: player.currentLapNum,
    currentLapTime,
    lastLapTime: player.lastLapTime,
    bestLapTime: player.bestLapTime,
    position: player.position,
    drs: (player.deltaToCarInFront ?? 0) > 0 && (player.deltaToCarInFront ?? 0) <= 1000 && isDrsZone(lapProgress),
    revLights: clampInt(Math.round(((player.speed - 120) / 210) * 100), 0, 100),
    sector: player.currentSector,
    lapInvalid: (player.penalties ?? 0) > 0 && player.currentSector === 2,
    timestamp: Date.now(),
  };
}

function buildRaceControlEvents(tick: number, player: DriverInfo): RaceControlNotification[] {
  const timestamp = Date.now();

  if (tick === 0) {
    return [
      {
        id: 'mock-session-note',
        category: 'info',
        message: 'Mock telemetry is replaying full pitwall payloads through the live message router.',
        severity: 'info',
        timestamp,
      },
      {
        id: 'mock-weather-call',
        category: 'warning',
        message: `[${player.name}] Light rain forecast in 10 minutes. Inter crossover closing.`,
        severity: 'warning',
        driverName: player.name,
        timestamp: timestamp - 2_500,
      },
    ];
  }

  if (tick % 36 === 12) {
    return [
      {
        id: `mock-pit-window-${player.currentLapNum}`,
        category: 'warning',
        message: `[${player.name}] Box window open. Target lap ${BASE_SESSION.pitStopWindowIdealLap}.`,
        severity: 'warning',
        driverName: player.name,
        timestamp,
      },
    ];
  }

  if (tick % 48 === 28) {
    return [
      {
        id: `mock-penalty-lawson-${Math.floor(tick / 48)}`,
        category: 'penalty',
        message: '[Liam Lawson] Time penalty: track limits (5s)',
        severity: 'critical',
        driverName: 'Liam Lawson',
        timestamp,
      },
    ];
  }

  return [];
}

function buildBattleAlerts(tick: number, drivers: DriverInfo[], player: DriverInfo): BattleAlert[] {
  if (tick === 0 || tick % 8 !== 0) {
    return [];
  }

  const ahead = drivers.find((driver) => driver.position === player.position - 1);
  const behind = drivers.find((driver) => driver.position === player.position + 1);
  const alerts: BattleAlert[] = [];
  const timestamp = Date.now();

  if (ahead && (player.deltaToCarInFront ?? 0) > 0) {
    const closingRate = round2(clamp(0.08, 0.52, (ahead.lastLapTime - player.lastLapTime) / 1000 + 0.16));
    alerts.push({
      id: `mock-ahead-${tick}`,
      driverAhead: ahead.name,
      driverBehind: player.name,
      gapSeconds: round2((player.deltaToCarInFront ?? 0) / 1000),
      closingRatePerLap: closingRate,
      estOvertakeLap: clampInt(Math.ceil(((player.deltaToCarInFront ?? 0) / 1000) / Math.max(closingRate, 0.1)), 1, 5),
      side: 'ahead',
      timestamp,
    });
  }

  if (behind && (behind.deltaToCarInFront ?? 0) > 0) {
    const closingRate = round2(clamp(-0.35, 0.38, (player.lastLapTime - behind.lastLapTime) / 1000 - 0.04));
    alerts.push({
      id: `mock-behind-${tick}`,
      driverAhead: player.name,
      driverBehind: behind.name,
      gapSeconds: round2((behind.deltaToCarInFront ?? 0) / 1000),
      closingRatePerLap: closingRate,
      estOvertakeLap: clampInt(Math.ceil(((behind.deltaToCarInFront ?? 0) / 1000) / Math.max(Math.abs(closingRate), 0.1)), 1, 5),
      side: 'behind',
      timestamp,
    });
  }

  return alerts;
}

function buildTrackMap(): TrackMapData {
  const points: TrackPoint[] = [];
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < 240; i += 1) {
    const progress = i / 240;
    const angle = progress * TAU;
    const x = 355 * Math.sin(angle) + 124 * Math.sin(angle * 2 + 0.6) + 44 * Math.sin(angle * 3 - 0.25);
    const z = 288 * Math.cos(angle - 0.15) - 152 * Math.cos(angle * 2 + 0.35) + 38 * Math.sin(angle * 4);

    const point: TrackPoint = {
      x: round2(x),
      z: round2(z),
      sector: getSector(progress),
      drs: isDrsZone(progress) ? 1 : 0,
    };

    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
    points.push(point);
  }

  return { points, minX: round2(minX), maxX: round2(maxX), minZ: round2(minZ), maxZ: round2(maxZ) };
}

function sampleTrackPosition(progress: number, laneOffset: number): { x: number; z: number } {
  const scaled = fractional(progress) * TRACK_MAP.points.length;
  const index = Math.floor(scaled) % TRACK_MAP.points.length;
  const nextIndex = (index + 1) % TRACK_MAP.points.length;
  const blend = scaled - Math.floor(scaled);
  const point = TRACK_MAP.points[index];
  const next = TRACK_MAP.points[nextIndex];
  const x = point.x + (next.x - point.x) * blend;
  const z = point.z + (next.z - point.z) * blend;
  const dx = next.x - point.x;
  const dz = next.z - point.z;
  const length = Math.hypot(dx, dz) || 1;
  const offsetX = (-dz / length) * laneOffset;
  const offsetZ = (dx / length) * laneOffset;

  return {
    x: round2(x + offsetX),
    z: round2(z + offsetZ),
  };
}

function encodeMessage(type: string, data: unknown): string {
  const message: WSResponse = { type, data };
  return JSON.stringify(message);
}

function getAverageWear(compound: string, tireAge: number, tick: number, orderIndex: number): number {
  const rate = compound === 'soft' ? 4.3 : compound === 'medium' ? 3.1 : compound === 'hard' ? 2.5 : 3.3;
  return clamp100(tireAge * rate + Math.sin(tick / 10 + orderIndex * 0.6) * 1.8 + orderIndex * 0.35);
}

function wheelMap(orderIndex: number, offsets: number[], mapper: (offset: number, wheelIndex: number) => number): number[] {
  return offsets.map((offset, wheelIndex) => mapper(offset + ((orderIndex + wheelIndex) % 2 === 0 ? 0.4 : -0.4), wheelIndex));
}

function getSector(progress: number): number {
  if (progress < 1 / 3) return 0;
  if (progress < 2 / 3) return 1;
  return 2;
}

function isDrsZone(progress: number): boolean {
  const normalized = fractional(progress);
  return (normalized >= 0.075 && normalized <= 0.16) || (normalized >= 0.595 && normalized <= 0.68);
}

function gaussian(progress: number, center: number, width: number): number {
  const delta = wrapProgress(progress - center);
  return Math.exp(-(delta * delta) / (2 * width * width));
}

function wrapProgress(value: number): number {
  if (value > 0.5) return value - 1;
  if (value < -0.5) return value + 1;
  return value;
}

function fractional(value: number): number {
  return value - Math.floor(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function clamp100(value: number): number {
  return clamp(value, 0, 100);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
