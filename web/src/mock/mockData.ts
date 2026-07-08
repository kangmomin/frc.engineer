import type {
  AppConfig,
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
  penaltyLog?: DriverInfo['penaltyLog'];
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
  trackName: 'Japan',
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
  seed(10, 'Pierre Gasly', 5, 'medium', 13, 950, 93_944, 93_141, { fuelBias: 0, ersBias: 15_000, brakeBias: 56, warnings: 1, cornerCuts: 1, penaltyLog: [{ lap: 8, pen: 5, inf: 7 }] }),
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
    penaltyLog: [
      { lap: 4, pen: 5, inf: 7 },
      { lap: 11, pen: 4, inf: 4, sec: 5 },
      { lap: 19, pen: 5, inf: 12 },
    ],
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
  { name: 'Italy (Monza)', filename: 'monza_recorded.txt' },
  { name: 'Singapore', filename: 'singapore_recorded.txt' },
  { name: 'Austria', filename: 'austria_recorded.txt' },
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

  return messages;
}

export function buildMockFrame(tick: number): {
  pitwallState: PitwallState;
  dashboardTelemetry: TelemetryData;
  raceControl: RaceControlNotification[];
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
    senderState: {
      saveFiles: true,
      trackRecording: mockConfig.trackRecording,
      raceStorageMode: mockConfig.dataStorageMode,
    },
    ersEstimateEnabled: true,
    ersComparisonEnabled: true,
  };

  const player = driverFrames.find((frame) => frame.driver.index === PLAYER_INDEX)?.driver ?? driverFrames[0].driver;

  return {
    pitwallState,
    dashboardTelemetry: buildDashboardTelemetry(player, driverFrames, tick),
    raceControl: buildRaceControlEvents(tick, player),
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
      aiControlled: seed.index !== PLAYER_INDEX && seed.index % 7 === 0,
      position: orderIndex + 1,
      currentLapNum,
      speed: driving.speed,
      topSpeed: clampInt(driving.speed + 8 + (orderIndex % 4) * 3, driving.speed, 352),
      throttle: round2(driving.throttle),
      brake: round2(driving.brake),
      gear: driving.gear,
      steering: round2(driving.steering),
      drsActivated: orderIndex > 0 && cumulativeGapMs > 0 && cumulativeGapMs <= 1000,
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
      penaltyLog: seed.penaltyLog,
      lapInvalid: false,
      pitStatus: 0,
      driverStatus: 1,
      resultStatus: 2,
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

  // 인접 간격(interval)을 gap-to-leader 차분으로 계산 — deltaToCarInFront 를 gap-to-leader 로
  // 두던 단순화를 바로잡는다(러닝오더 INT 컬럼·배틀 엔진이 실제 interval 을 쓰도록).
  const byGap = [...frames].sort(
    (a, b) => (a.driver.deltaToRaceLeader ?? 0) - (b.driver.deltaToRaceLeader ?? 0),
  );
  const intervalByIndex = new Map<number, number>();
  byGap.forEach((frame, i) => {
    const cur = frame.driver.deltaToRaceLeader ?? 0;
    const prev = i === 0 ? 0 : byGap[i - 1].driver.deltaToRaceLeader ?? 0;
    intervalByIndex.set(frame.driver.index, i === 0 ? 0 : Math.max(0, round1(cur - prev)));
  });

  return frames.map((frame) => ({
    ...frame,
    driver: {
      ...frame.driver,
      deltaToCarInFront: intervalByIndex.get(frame.driver.index) ?? 0,
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
    speed: player.speed ?? 0,
    gear: player.gear,
    rpm: clampInt(Math.round(7_400 + (player.speed ?? 0) * 22 + player.throttle * 680), 7_200, 12_100),
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
    revLights: clampInt(Math.round((((player.speed ?? 0) - 120) / 210) * 100), 0, 100),
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

// ── Qualifying mock feed (Phase 3, additive) ──
// 위 buildMockMessages/buildMockFrame(Race 고정)는 그대로 두고, `?mock=quali` 전용 경로를
// 별도로 추가한다. Qualifying 뷰는 positions(60Hz)를 구독하지 않으므로 positions=[]로 둔다.

const QUALI_DRIVER_COUNT = DRIVER_SEEDS.length;
/** 랩 1개 = 48틱(~12초, 250ms/틱). 실제 F1 퀄리 랩(~90s)보다 압축된 mock 전용 페이스 —
 * dev 검증 중 랩 롤오버(섹터 누적기 S3 역산)를 짧은 시간 안에 여러 번 관찰하기 위함. */
const QUALI_LAP_TICKS = 48;
const QUALI_BASE_LAP_MS = 90_100;
const QUALI_LAP_SPREAD_MS = 1_700; // 필드 스프레드 90.1s ~ 91.8s
const QUALI_SECTOR1_RATIO = 0.338;
const QUALI_SECTOR2_RATIO = 0.354;
const QUALI_SESSION_START_SECONDS = 300;
/** 세션 내내 출차하지 않는 드라이버(랩 미기록 엣지케이스 + driverStatus GAR 믹스 고정 확보). */
const QUALI_GARAGE_INDICES = new Set<number>([17, 19]);

type QualiLapQuality = 'out' | 'push' | 'in';

/** 4랩 주기: OUT → FLYING → FLYING → IN, 드라이버별 index만큼 위상차(staggered). */
function qualiLapQuality(driverIndex: number, lapNum: number): QualiLapQuality {
  const phase = (lapNum - 1 + driverIndex) % 4;
  if (phase === 0) return 'out';
  if (phase === 3) return 'in';
  return 'push';
}

function qualiDriverStatus(quality: QualiLapQuality): number {
  if (quality === 'out') return 3;
  if (quality === 'in') return 2;
  return 1; // push → flying
}

function qualiBaseLapMs(driverIndex: number): number {
  return Math.round(QUALI_BASE_LAP_MS + (driverIndex / (QUALI_DRIVER_COUNT - 1)) * QUALI_LAP_SPREAD_MS);
}

/** 해당 랩(lapNum)의 "확정" 랩타임. out/in은 push 대비 느리고, push는 소폭 지터를 갖는다. */
function qualiFinalLapMs(driverIndex: number, lapNum: number): number {
  const baseMs = qualiBaseLapMs(driverIndex);
  const quality = qualiLapQuality(driverIndex, lapNum);
  if (quality === 'out') return Math.round(baseMs * 1.12);
  if (quality === 'in') return Math.round(baseMs * 1.18);
  const jitter = Math.sin(lapNum * 0.9 + driverIndex * 0.5) * 180;
  return Math.round(baseMs + jitter);
}

/** push(flying) 랩만 개인 최고기록 후보로 반영 — out/in 랩은 bestLapTime을 갱신하지 않는다. */
function qualiBestLapMs(driverIndex: number, uptoLapInclusive: number): number {
  let best = 0;
  for (let n = 1; n <= uptoLapInclusive; n += 1) {
    if (qualiLapQuality(driverIndex, n) !== 'push') continue;
    const t = qualiFinalLapMs(driverIndex, n);
    if (best === 0 || t < best) best = t;
  }
  return best;
}

function buildQualiGarageDriver(index: number, seed: DriverSeed): DriverInfo {
  const driver: DriverInfo = {
    index,
    name: seed.name,
    teamId: seed.teamId,
    aiControlled: index !== PLAYER_INDEX && index % 7 === 0,
    position: 0,
    currentLapNum: 0,
    speed: 0,
    topSpeed: 0,
    throttle: 0,
    brake: 0,
    gear: 0,
    steering: 0,
    drsActivated: false,
    lastLapTime: 0,
    bestLapTime: 0,
    tireCompound: seed.tireCompound,
    tireAge: seed.tireAge,
    tireWear: [0, 0, 0, 0],
    tireSurfaceTemp: [0, 0, 0, 0],
    tireInnerTemp: [0, 0, 0, 0],
    brakeTemp: [0, 0, 0, 0],
    brakeBias: seed.brakeBias,
    diffOnThrottle: seed.diffOnThrottle,
    diffOffThrottle: seed.diffOffThrottle,
    fuelInTank: 0,
    fuelRemainingLaps: 0,
    fuelMix: 2,
    ersStoreEnergy: 2_000_000,
    ersDeployMode: 1,
    ersDeployedThisLap: 0,
    ersHarvestedThisLap: 0,
    ersEstimatePct: 100,
    ersEstimateReady: true,
    ersActualPct: 100,
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
    // [tradeoff, comp m-7] pitStatus:0(온트랙)+lapDistance:0이라 useTrackGaps(`pitStatus===0`
    // 필터)가 이 차를 "0m 지점의 온트랙 차"로 오인해 ahead/behind 갭 계산을 오염시킬 수 있다.
    // pitStatus:1/2(PIT)로 바꾸면 실제로는 더 정확해지지만, classificationRows의
    // getDriverStatusInfo가 "핏 > 드라이버상태" 우선순위(전 커밋 불변 lift)라 Status 컬럼이
    // GAR 대신 PIT을 표시하게 되어 M1(driverStatus ?? 0 → GAR) 검증을 스모크에서 가리게 된다 —
    // 그 트레이드오프를 피해 pitStatus:0을 유지한다(garage 드라이버는 QUALI_GARAGE_INDICES
    // 2대뿐이라 ahead/behind 오염 영향은 제한적).
    pitStatus: 0,
    driverStatus: 0, // GARAGE — 아래서 omitempty 부재로 삭제(M1 정규화를 smoke가 실제로 밟게 함)
    resultStatus: 0,
    numPitStops: 0,
    lapDistance: 0,
    pitStopTimer: 0,
  };

  // omitempty 재현(Phase3 M3): 완주 없는 섹터(sector1/2TimeMs)와 driverStatus(0=GARAGE)는
  // 실 와이어에서 필드 자체가 부재하다 — M1(classificationRows의 `d.driverStatus ?? 0`)의
  // undefined 정규화 경로를 smoke가 실제로 밟도록 런타임에서 키를 제거한다(타입 변경 없음).
  const mutableDriver = driver as Partial<DriverInfo>;
  delete mutableDriver.sector1TimeMs;
  delete mutableDriver.sector2TimeMs;
  delete mutableDriver.driverStatus;

  return driver;
}

function buildQualiActiveDriver(index: number, seed: DriverSeed, tick: number): DriverInfo {
  // 드라이버별 위상차(stagger) — 모든 차가 동시에 결승선을 통과하지 않도록.
  const effectiveTick = tick + index * 3;
  const lapProgress = effectiveTick / QUALI_LAP_TICKS;
  const currentLapNum = Math.floor(lapProgress) + 1;
  const lapFraction = fractional(lapProgress);
  // lastLapTime/bestLapTime은 currentLapNum이 넘어가기 "한 틱 앞서" 갱신된다(실 텔레메트리
  // 필드 갱신 타이밍 — 레거시 useSectorAccumulator의 롤오버 역산이 전제하는 바로 그 특성,
  // Phase3 Spec §3.2). +1 오프셋으로 그 타이밍을 그대로 재현한다.
  const lastLapCompletedNum = Math.floor((effectiveTick + 1) / QUALI_LAP_TICKS);

  const curLapTotal = qualiFinalLapMs(index, currentLapNum);
  const quality = qualiLapQuality(index, currentLapNum);
  const s1Final = Math.round(curLapTotal * QUALI_SECTOR1_RATIO);
  const s2Final = Math.round(curLapTotal * QUALI_SECTOR2_RATIO);

  // sector1/2TimeMs는 라이브 스톱워치처럼 구간 내내 증가하는 값이 아니라, 해당 섹터를
  // "완주"하는 순간에만 등장하는 계단형 값이다(실 와이어 시맨틱 — Phase2 deriveSectorCells의
  // `currentSector>=1이어야 sector1TimeMs가 유효`라는 게이트가 바로 이 특성을 전제한다).
  // 섹터 도중 선형 보간(램프)으로 채우면 useSectorAccumulator의 "관측된 모든 양수값의 최소"
  // 로직이 램프 초반의 극소값을 실제 완주 기록으로 오인해 고정해버린다 — 반드시 계단형으로
  // 생성해야 한다.
  let sector1TimeMs: number;
  let sector2TimeMs: number;
  let currentSector: number;
  if (lapFraction < QUALI_SECTOR1_RATIO) {
    sector1TimeMs = 0;
    sector2TimeMs = 0;
    currentSector = 0;
  } else if (lapFraction < QUALI_SECTOR1_RATIO + QUALI_SECTOR2_RATIO) {
    sector1TimeMs = s1Final;
    sector2TimeMs = 0;
    currentSector = 1;
  } else {
    sector1TimeMs = s1Final;
    sector2TimeMs = s2Final;
    currentSector = 2;
  }

  const lastLapTime = lastLapCompletedNum > 0 ? qualiFinalLapMs(index, lastLapCompletedNum) : 0;
  const bestLapTime = lastLapCompletedNum > 0 ? qualiBestLapMs(index, lastLapCompletedNum) : 0;
  const ersActualPct = clampInt(Math.round(70 + 25 * Math.sin(effectiveTick / 10 + index)), 15, 100);

  const driver: DriverInfo = {
    index,
    name: seed.name,
    teamId: seed.teamId,
    aiControlled: index !== PLAYER_INDEX && index % 7 === 0,
    position: 0, // buildQualiDriverFrames에서 bestLapTime 순위로 재배정
    currentLapNum,
    speed: 0,
    topSpeed: 0,
    throttle: 0,
    brake: 0,
    gear: 0,
    steering: 0,
    drsActivated: quality === 'push' && lapFraction > 0.5,
    lastLapTime,
    bestLapTime,
    tireCompound: seed.tireCompound,
    tireAge: seed.tireAge,
    tireWear: [0, 0, 0, 0],
    tireSurfaceTemp: [0, 0, 0, 0],
    tireInnerTemp: [0, 0, 0, 0],
    brakeTemp: [0, 0, 0, 0],
    brakeBias: seed.brakeBias,
    diffOnThrottle: seed.diffOnThrottle,
    diffOffThrottle: seed.diffOffThrottle,
    fuelInTank: 60,
    fuelRemainingLaps: 8,
    fuelMix: 2,
    ersStoreEnergy: 2_500_000,
    ersDeployMode: ((index + currentLapNum) % 3) + 1,
    ersDeployedThisLap: Math.round(300_000 + lapFraction * 400_000),
    ersHarvestedThisLap: Math.round(200_000 + (1 - lapFraction) * 200_000),
    ersEstimatePct: ersActualPct,
    ersEstimateReady: true,
    ersActualPct,
    ersActualReady: true,
    sector1TimeMs,
    sector2TimeMs,
    currentSector,
    penalties: 0,
    totalWarnings: 0,
    cornerCuttingWarnings: 0,
    numUnservedDriveThroughs: 0,
    numUnservedStopGoPenalties: 0,
    lapInvalid: false,
    pitStatus: 0,
    driverStatus: qualiDriverStatus(quality),
    resultStatus: 0,
    numPitStops: 0,
    lapDistance: round1(lapFraction * TRACK_LENGTH),
    pitStopTimer: 0,
  };

  // omitempty 재현(Phase3 M3/scope M3): Go DTO의 sector1/2TimeMs는 `,omitempty`라 완주 전
  // 구간은 값이 0이 아니라 필드 자체가 부재(undefined)한다. 실 와이어 정합을 위해 아직
  // 완주하지 않은 섹터의 키를 런타임에서 제거한다 — 타입(DriverInfo.sector1/2TimeMs: number)은
  // 그대로 두고 이 지점에서만 cast로 삭제를 허용한다. H1(tryStatus buildSectorDelta)의
  // undefined 경로를 smoke가 실제로 밟도록 하기 위함(마스킹하던 명시적 0을 제거).
  const mutableDriver = driver as Partial<DriverInfo>;
  if (currentSector === 0) {
    delete mutableDriver.sector1TimeMs;
    delete mutableDriver.sector2TimeMs;
  } else if (currentSector === 1) {
    delete mutableDriver.sector2TimeMs;
  }

  return driver;
}

function buildQualiDriverFrames(tick: number): DriverInfo[] {
  const drivers = DRIVER_SEEDS.map((seed, index) =>
    QUALI_GARAGE_INDICES.has(index) ? buildQualiGarageDriver(index, seed) : buildQualiActiveDriver(index, seed, tick),
  );

  // 순위 재계산: 기록 있는 드라이버는 bestLapTime 오름차순, 미기록(GAR 등)은 하단(원 index 순).
  const ranked = [...drivers].sort((a, b) => {
    const aHas = a.bestLapTime > 0;
    const bHas = b.bestLapTime > 0;
    if (aHas !== bHas) return aHas ? -1 : 1;
    if (aHas) return a.bestLapTime - b.bestLapTime;
    return a.index - b.index;
  });
  ranked.forEach((driver, i) => {
    driver.position = i + 1;
  });

  return drivers;
}

function buildQualiSession(tick: number): SessionInfo {
  return {
    ...BASE_SESSION,
    sessionType: 'Q1',
    sessionTimeLeft: Math.max(0, Math.round(QUALI_SESSION_START_SECONDS - (tick * FRAME_INTERVAL_MS) / 1000)),
    weatherForecast: BASE_FORECAST,
  };
}

export function buildQualiMockFrame(tick: number): { pitwallState: PitwallState } {
  const session = buildQualiSession(tick);
  const drivers = buildQualiDriverFrames(tick);
  const pitwallState: PitwallState = {
    session,
    drivers,
    positions: [],
    playerIndex: PLAYER_INDEX,
    senderState: {
      saveFiles: true,
      trackRecording: false,
      raceStorageMode: 'summary',
    },
    ersEstimateEnabled: true,
    ersComparisonEnabled: true,
  };
  return { pitwallState };
}

/** `?mock=quali` 전용 메시지 빌더(Phase3 Spec §7.5). positions(60Hz)는 Qualifying 뷰가
 * 구독하지 않으므로 별도 positionUpdate 메시지를 보내지 않는다. */
export function buildQualiMockMessages(tick: number): string[] {
  const frame = buildQualiMockFrame(tick);
  return [encodeMessage('pitwallState', frame.pitwallState)];
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
