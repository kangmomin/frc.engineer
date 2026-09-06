/**
 * Telemetry data received from the Go backend via WebSocket
 * Maps to internal/dto/dashboard.go
 */
export interface TelemetryData {
  // Core telemetry
  speed: number;      // Speed in km/h
  gear: number;       // -1=R, 0=N, 1-8=forward gears
  rpm: number;        // Engine RPM
  throttle: number;   // 0.0 to 1.0
  brake: number;      // 0.0 to 1.0

  // Delta times (in milliseconds)
  deltaPersonalBest: number;  // Delta to personal best
  deltaCarInFront: number;    // Delta to car in front
  deltaRaceLeader: number;    // Delta to race leader

  // Lap information
  currentLap: number;         // Current lap number
  currentLapTime: number;     // Current lap time in ms
  lastLapTime: number;        // Last lap time in ms
  bestLapTime: number;        // Best lap time in ms
  position: number;           // Current race position

  // Additional indicators
  drs: boolean;               // DRS active
  revLights: number;          // Rev lights percentage (0-100)
  sector: number;             // Current sector (0, 1, 2)
  lapInvalid: boolean;        // Whether current lap is invalid

  // Metadata
  timestamp: number;          // Unix timestamp in milliseconds
}

/**
 * WebSocket connection state
 */
export type ConnectionState =
  | 'connecting'
  | 'waiting-offer'
  | 'negotiating'
  | 'reconnecting'
  | 'connected'
  | 'disconnected'
  | 'timeout'
  | 'ice-failed'
  | 'error';

export type DataStorageMode = 'advanced' | 'resultOnly' | 'summary';

/**
 * View mode for the dashboard
 */
export type ViewMode = 'driver' | 'pitwall';

/**
 * Tire wear prediction display mode
 * - 'absolute': Show predicted total wear after N more laps (e.g. 75%)
 * - 'relative': Show additional wear over the next N laps (e.g. +15%)
 */
export type TireWearDisplayMode = 'absolute' | 'relative';

/**
 * Tab identifiers for sidebar navigation
 */
export type TabId = 'engineer' | 'settings' | 'races';

/**
 * Runtime application config (mirrors backend RuntimeConfig)
 */
export interface AppConfig {
  udpPort: number;
  backendPort: number;
  forwardTargets: ForwardTarget[];
  trackRecording: boolean;
  packetLogging: boolean;
  raceSummaryRecording: boolean;
  dataStorageMode: DataStorageMode;
}

export interface ForwardTarget {
  host: string;
  port: number;
  enabled: boolean;
}

export interface TrackListItem {
  name: string;
  filename: string;
}

export interface RaceListItem {
  id: string;
  savedAtLocal: string;
  trackName: string;
  sessionType: string;
  playerName: string;
  finalPosition: number;
  fileSizeBytes: number;
  dataStorageMode?: DataStorageMode;
  hasReplay?: boolean;
  frameCount?: number;
}

export interface RaceStint {
  compound: string;
  laps: number;
  startLap?: number;
  endLap?: number;
  tireWearPct?: number;
}

export interface RacePlayerSummary {
  driverIndex: number;
  name: string;
  teamId: number;
  finalPosition: number;
  completedLaps: number;
  bestLapMs: number;
  lastLapMs: number;
  pitStops: number;
  stints?: RaceStint[];
}

export interface RaceDriverSummary {
  driverIndex: number;
  name: string;
  teamId: number;
  position: number;
  completedLaps: number;
  bestLapMs: number;
  lastLapMs: number;
  pitStops: number;
  tireCompound: string;
  tireAge: number;
  stints?: RaceStint[];
}

export interface RacePenaltySummary {
  timePenaltySeconds?: number;
  warnings?: number;
  cornerCutWarnings?: number;
  unservedDriveThrough?: number;
  unservedStopGo?: number;
}

export interface RacePitSummary {
  stops: number;
  pitLaneTimeMs?: number;
  estimatedTimeLostMs?: number;
}

export interface RaceTyreSummary {
  finalCompound?: string;
  finalAge?: number;
  averageWearPct?: number;
  peakWearPct?: number;
  finalSetWearPct?: number;
  lifeSpan?: number;
  usableLife?: number;
  lifeRemainingPct?: number;
}

export interface RaceDebrief {
  classifiedDrivers: number;
  winnerName?: string;
  gapToWinnerMs?: number;
  fastestLapDeltaMs?: number;
  penalties: RacePenaltySummary;
  pit: RacePitSummary;
  tyres: RaceTyreSummary;
  timeline?: RaceControlNotification[];
}

export interface LapTiming {
  lapNumber: number;
  lapMs: number;
  s1Ms: number;
  s2Ms: number;
  s3Ms: number;
  tyre?: string;
  valid: boolean;
}

export interface CarSetup {
  frontWing: number;
  rearWing: number;
  onThrottle: number;
  offThrottle: number;
  frontCamber: number;
  rearCamber: number;
  frontToe: number;
  rearToe: number;
  frontSuspension: number;
  rearSuspension: number;
  frontAntiRollBar: number;
  rearAntiRollBar: number;
  frontSuspensionHeight: number;
  rearSuspensionHeight: number;
  brakePressure: number;
  brakeBias: number;
  engineBraking: number;
  rearLeftTyrePressure: number;
  rearRightTyrePressure: number;
  frontLeftTyrePressure: number;
  frontRightTyrePressure: number;
  ballast: number;
  fuelLoad: number;
}

// RaceDetail mirrors internal/races.RaceDetail — the rich, player-centric sub-block
// present only on schemaVersion>=1 summaries. Every field is optional so legacy (v0)
// and unknown-future readers degrade gracefully.
export interface RaceDetail {
  laps?: LapTiming[];
  dynamics?: DynamicsLap[];
  events?: RaceControlNotification[];
  setup?: CarSetup;
}

export interface RaceSummary {
  id: string;
  savedAtLocal: string;
  sessionUID: number;
  schemaVersion?: number;
  gameFormat?: string;
  detail?: RaceDetail;
  dataStorageMode?: DataStorageMode;
  track: {
    trackId: number;
    trackName: string;
  };
  session: {
    sessionType: string;
    totalLaps: number;
    safetyCar: string;
    weather: string;
    airTemp: number;
    trackTemp: number;
  };
  player: RacePlayerSummary;
  drivers: RaceDriverSummary[];
  highlights: {
    fastestLapHolder?: string;
    fastestLapMs?: number;
    notifications: {
      penalty: number;
      warning: number;
      info: number;
    };
  };
  debrief?: RaceDebrief;
  replay?: {
    frameIntervalMs: number;
    trackMap?: TrackMapData;
    session?: SessionInfo;
    frames: ReplayFrame[];
  };
}

// Highest single-document schema version this client fully understands. Mirrors the
// Go constant races.RaceSummarySchemaVersion — bump both together when the summary /
// detail structure changes.
export const RACE_SUMMARY_SCHEMA_VERSION = 1;

export type RaceSummarySchema = 'legacy' | 'rich' | 'unknownFuture';

// resolveSummarySchema classifies a stored summary by its schemaVersion so readers
// dispatch on it instead of guessing from field presence. Mirrors the writer's
// stamp-always / reader-preserve contract: 0 (or absent) is a legacy pre-versioning
// summary, versions we know are rich, and any higher version is unknown-future — the
// caller still renders the fields it recognises and never crashes.
export function resolveSummarySchema(summary: Pick<RaceSummary, 'schemaVersion'>): RaceSummarySchema {
  const version = summary.schemaVersion ?? 0;
  if (version <= 0) {
    return 'legacy';
  }
  if (version <= RACE_SUMMARY_SCHEMA_VERSION) {
    return 'rich';
  }
  return 'unknownFuture';
}

export interface ReplayFrame {
  timestamp: number;
  pitwall: PitwallState;
  raceControl?: RaceControlNotification[];
}

export interface ReplayStreamMeta {
  type: 'meta';
  frameIntervalMs: number;
  trackMap?: TrackMapData;
  session?: SessionInfo;
}

export interface ReplayStreamFrame {
  type: 'frame';
  frame: ReplayFrame;
}

/**
 * A single telemetry data point for chart visualization
 */
export interface TelemetryPoint {
  lapDistance: number;   // X-axis: distance in metres
  lapTime: number;       // Lap time at this point (ms)
  speed: number;         // Speed in km/h
  throttle: number;      // 0.0-1.0
  brake: number;         // 0.0-1.0
  gear: number;          // -1=R, 0=N, 1-8
}

/**
 * Complete telemetry data for a lap
 */
export interface LapTelemetry {
  trackId: number;
  lapTimeMs: number;
  sector1Ms: number;
  sector2Ms: number;
  sector3Ms: number;
  dataPoints: TelemetryPoint[];
}

/**
 * Response to getLapData request
 */
export interface LapDataResponse {
  bestLap: LapTelemetry | null;
  currentLap: TelemetryPoint[] | null;
  bestLapTime: number;
}

/**
 * WebSocket request message
 */
export interface WSRequest {
  type: string;
  requestId?: string;
  data?: unknown;
}

/**
 * WebSocket response message
 */
export interface WSResponse {
  type: string;
  requestId?: string;
  data?: unknown;
  error?: string;
}

/**
 * Comprehensive pitwall state from backend
 */
export interface TrackPoint {
  x: number;
  z: number;
  sector: number;
  drs: number;
}

export interface TrackMapData {
  points: TrackPoint[];
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface MarshalZone {
  start: number; // 0..1 fraction of track
  flag: number;  // -1=invalid, 0=none, 1=green, 2=blue, 3=yellow, 4=red
}

export interface PitwallState {
	/** Decimal uint64 identity, also available before session metadata arrives. */
  sessionUid?: string;
  session: SessionInfo | null;
  drivers: DriverInfo[];
  positions: CarPosition[];
  playerIndex: number;
  /** packetFormat: 2025 / 2026 (2026 = Season Pack 모드, DRS 대신 Overtake) */
  gameFormat?: number;
  trackMap?: TrackMapData;
  senderState?: SenderState | null;
  ersEstimateEnabled: boolean;
  ersComparisonEnabled: boolean;
}

export interface SenderState {
  saveFiles: boolean;
  trackRecording: boolean;
  raceStorageMode?: DataStorageMode | 'off';
}

export interface WeatherForecast {
  sessionType: string;
  timeOffset: number;
  weather: string;
  trackTemp: number;
  trackTempChange: number;
  airTemp: number;
  airTempChange: number;
  rainPercentage: number;
}

export interface CrossoverPrediction {
  available: boolean;
  dryGroup: string;
  wetGroup: string;
  currentDeltaMs: number;
  trendDeltaMsPerLap: number;
  avgLapTimeMs: number;
  drySampleCount: number;
  wetSampleCount: number;
  historyDepth: number;
  currentDryAvgMs: number;
  currentWetAvgMs: number;
  reason?: string;
}

export interface SessionInfo {
  formula?: number;
  qualifyingGridSize?: number;
  sessionUid?: string;
  weather: string;
  trackTemp: number;
  airTemp: number;
  safetyCar: string;
  sessionType: string;
  totalLaps: number;
  sessionTimeLeft?: number;
  sessionDuration?: number;
  trackId: number;
  trackName: string;
  trackLength: number;
  pitStopWindowIdealLap?: number;
  pitStopWindowLatestLap?: number;
  pitStopRejoinPosition?: number;
  marshalZones?: MarshalZone[];
  weatherForecast?: WeatherForecast[];
  crossoverPrediction?: CrossoverPrediction;
}

export interface DriverInfo {
  index: number;
  name: string;
  teamId: number;
  aiControlled: boolean;
  position: number;
  currentLapNum: number;
  // Go DTO omitempty: 정지(speed=0)는 필드 부재(undefined)로 전달된다 — Math.round(undefined)=NaN 방지.
  speed?: number;
  topSpeed: number;
  throttle: number;
  brake: number;
  gear: number;
  steering: number;
  drsActivated: boolean;
  /** 2026 Season Pack 전용: Overtake(Manual Override) 활성 */
  overtakeActive?: boolean;
  /** 2026 Season Pack 전용: Overtake 사용 가능 */
  overtakeAvailable?: boolean;
  /** 2026 Season Pack 전용: 0=corner(Z-mode), 1=straight(X-mode) */
  activeAeroMode?: number;
  lastLapTime: number;
  bestLapTime: number;
  sessionHistoryAvailable?: boolean;
  tireCompound: string;
  tireAge: number;
  tireWear: number[];
  tireSurfaceTemp: number[];
  tireInnerTemp: number[];
  brakeTemp: number[];

  // Car Controls
  brakeBias: number;
  diffOnThrottle: number;
  diffOffThrottle: number;

  // Fuel & Energy
  fuelInTank: number;
  fuelRemainingLaps: number;
  fuelMix: number;
  ersStoreEnergy: number;
  ersDeployMode: number;
  ersDeployedThisLap: number;
  ersHarvestedThisLap: number;
  // Go DTO omitempty: pct=0(배터리 고갈)은 필드 부재(undefined)로 전달된다 — Math.round(undefined)=NaN 방지.
  ersEstimatePct?: number;
  ersEstimateReady: boolean;
  ersActualPct?: number;
  ersActualReady: boolean;

  // TyreSets (Commentary)
  tyreSetWear?: number | null;
  tyreLifeSpan?: number | null;
  tyreUsableLife?: number | null;
  availableSets?: TyreSetBrief[];

  // Strategy
  stintHistory?: StintInfo[];

  // Damage
  damage?: CarDamage;

  // Sector times (current lap)
  // Go DTO omitempty: 값이 0이면 와이어에서 필드가 부재(undefined)한다. 실 캡처(test-sets)에서
  // 아웃랩/라인통과 직후 Sector1/2TimeInMS=0 확인 — 타입을 실측에 맞춰 optional로 선언한다.
  sector1TimeMs?: number;
  sector2TimeMs?: number;
  currentSector: number; // 0-based: 0=S1, 1=S2, 2=S3 (wire value, no transform — see internal/packets/lapdata.go Sector field)

  // Best sector times (from SessionHistory)
  bestSector1Ms?: number | null;
  bestSector2Ms?: number | null;
  bestSector3Ms?: number | null;

  // Vehicle Dynamics
  dynamics?: DynamicsLap[];

  // Penalties
  penalties: number;
  totalWarnings: number;
  cornerCuttingWarnings: number;
  numUnservedDriveThroughs: number;
  numUnservedStopGoPenalties: number;
  penaltyLog?: PenaltyLogEntry[];

  // Lap validity
  lapInvalid: boolean;

  // Pit
  pitStatus: number;
  // Go DTO omitempty: driverStatus=0(GARAGE)/resultStatus=0(비활성)은 필드 부재(undefined)로 전달된다.
  // 실 캡처(test-sets)에서 개러지 드라이버 DriverStatus=0 확인 — `=== 0` 비교가 undefined에서 어긋나므로
  // 소비처는 `?? 0`으로 정규화해야 한다(classificationRows.ts 선례).
  driverStatus?: number;
  resultStatus?: number;
  numPitStops: number;
  lapDistance: number;
  pitStopTimer: number;
  deltaToCarInFront?: number;
  deltaToRaceLeader?: number;
  deltaToPlayer?: number;
  pitLaneTime?: number;
  // 마지막 완료 피트스톱의 실측값(Go DTO omitempty — 미피트 시 undefined).
  measuredPitLaneMs?: number; // 레인 체류(ms) = 이동+정지
  measuredPitStopMs?: number; // 정지 작업(ms), 유형 분류 입력
}

/** One penalty/warning entry for the leaderboard hover detail (DTO PenaltyLogEntry).
 * Codes map via web/src/constants/penalties.ts. */
export interface PenaltyLogEntry {
  lap: number;
  pen: number;
  inf: number;
  sec?: number;
}

export interface StintInfo {
  compound: string;
  laps: number;
}

export interface TyreSetBrief {
  compound: string;
  count: number;
}

export interface CarDamage {
  frontLeftWing: number;
  frontRightWing: number;
  rearWing: number;
  floor: number;
  diffuser: number;
  sidepod: number;
  engine: number;
  gearbox: number;
  drsFault: boolean;
  ersFault: boolean;
}

export interface DynamicsLap {
  lapNum: number;
  understeerPct: number;
  oversteerPct: number;
  lockupCount: number;
  spinCount: number;
}

export interface StrategyGuideResponse {
  track: StrategyTrackGuide;
  tyreTemps: StrategyTyreTempDataset;
}

export interface StrategyTrackGuide {
  track: string;
  source: {
    url: string;
    scraped_at: string;
  };
  track_info: {
    lap_count?: number;
    laps_50pct: number;
    circuit_length_km: number;
    lap_record_display: string;
    lap_record_ms: number;
    drs_zones: number;
    pole_position_side: string;
    pit_limit_kph: number;
    pit_limit_mph: number;
  };
  tyre_strategy: {
    compounds: Record<string, string>;
    wear_per_lap: Record<string, StrategyRangeValue>;
    tyre_life_50pct: Record<string, StrategyLapValue>;
  };
  quali_strategy?: {
    fuel_amount_kg: number;
    outlap_time_ms: number;
    starting_tyre_temp_c: number;
    enable_ers_turn: number;
    enable_ers_display: string;
  };
  race_strategy?: {
    available: boolean;
    laps_50pct?: number;
    starting_fuel_50pct_kg?: number;
    plan_a?: StrategyRacePlan;
    plan_b?: StrategyRacePlan;
    plan_100pct?: StrategyRacePlan;
    pit_stop_time_lost_s?: number;
    notes?: string;
  };
  setup_type_descriptions: Record<string, string | null>;
  hotlap_video_url?: string;
  /** F1 26(2026 Season Pack) 세션에서만 채워진다. F1 25는 undefined(원본 불변). */
  strategy_meta?: StrategyMeta;
}

/** 트랙 가이드가 게임 포맷에 맞춰 어떻게 보정됐는지 설명한다(백엔드 ApplyGameFormat). */
export interface StrategyMeta {
  /** 데이터 출처 게임 (현재 전부 "f1_25_scrape"). */
  source_game: string;
  /** 세션 packetFormat (2026). */
  game_format: number;
  /** 적용된 보정 (예: "drs_abolished", "c6_downgraded_to_c5"). */
  adjustments?: string[];
  /** 26 규정 기반 정성 안내 (검증 confirmed 사실만). */
  notes?: string[];
}

export interface StrategyRangeValue {
  display: string;
  min_pct: number;
  max_pct: number;
  description?: string;
}

export interface StrategyLapValue {
  laps: number;
  description?: string;
}

export interface StrategyRacePlan {
  tyres: string[];
  pit_window_display: string;
  pit_windows: Array<{
    start_lap: number;
    end_lap: number;
  }>;
  description?: string;
}

export interface StrategyTyreTempDataset {
  compounds: Record<string, StrategyTyreCompound>;
}

export interface StrategyTyreCompound {
  peak_temps_c: number[];
  points: StrategyTyreTempPoint[];
}

export interface StrategyTyreTempPoint {
  temp_c: number;
  grip_pct: number;
  zone: string;
}

export interface CarPosition {
  index: number;
  x: number;
  y: number;
  z: number;
}

/**
 * Race control notification from backend event packets
 */
export interface RaceControlNotification {
  id: string;
  category: 'penalty' | 'warning' | 'info';
  message: string;
  severity: 'critical' | 'warning' | 'info';
  driverName?: string;
  timestamp: number;
  lap?: number;
}

/**
 * Default telemetry data for initial state
 */
export const defaultTelemetryData: TelemetryData = {
  speed: 0,
  gear: 0,
  rpm: 0,
  throttle: 0,
  brake: 0,
  deltaPersonalBest: 0,
  deltaCarInFront: 0,
  deltaRaceLeader: 0,
  currentLap: 0,
  currentLapTime: 0,
  lastLapTime: 0,
  bestLapTime: 0,
  position: 0,
  drs: false,
  revLights: 0,
  sector: 0,
  lapInvalid: false,
  timestamp: 0,
};
