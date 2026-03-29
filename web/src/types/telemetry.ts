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
export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface FeaturePermissions {
  viewERSActual: boolean;
  viewAdvancedStrategy: boolean;
  viewPitStatus: boolean;
  viewTopSpeed: boolean;
  viewPlayerDelta: boolean;
}

export type DataStorageMode = 'advanced' | 'resultOnly' | 'summary';

/**
 * View mode for the dashboard
 */
export type ViewMode = 'driver' | 'pitwall';

/**
 * Tire wear prediction display mode
 * - 'absolute': Show predicted total wear at N laps (e.g. 75%)
 * - 'relative': Show additional wear over N laps (e.g. +15%)
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

export interface RaceSummary {
  id: string;
  savedAtLocal: string;
  sessionUID: number;
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
  replay?: {
    frameIntervalMs: number;
    trackMap?: TrackMapData;
    session?: SessionInfo;
    frames: {
      timestamp: number;
      pitwall: PitwallState;
      raceControl?: RaceControlNotification[];
      battleAlerts?: BattleAlert[];
    }[];
  };
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
  session: SessionInfo | null;
  drivers: DriverInfo[];
  positions: CarPosition[];
  playerIndex: number;
  trackMap?: TrackMapData;
  ersComparisonEnabled: boolean;
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
  weather: string;
  trackTemp: number;
  airTemp: number;
  safetyCar: string;
  sessionType: string;
  totalLaps: number;
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
  position: number;
  currentLapNum: number;
  speed: number;
  topSpeed: number;
  throttle: number;
  brake: number;
  gear: number;
  steering: number;
  lastLapTime: number;
  bestLapTime: number;
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
  ersEstimatePct: number;
  ersEstimateReady: boolean;
  ersActualPct: number;
  ersActualReady: boolean;

  // Strategy
  stintHistory?: StintInfo[];

  // Damage
  damage?: CarDamage;

  // Sector times (current lap)
  sector1TimeMs: number;
  sector2TimeMs: number;
  currentSector: number;

  // Vehicle Dynamics
  dynamics?: DynamicsLap[];

  // Penalties
  penalties: number;
  totalWarnings: number;
  cornerCuttingWarnings: number;
  numUnservedDriveThroughs: number;
  numUnservedStopGoPenalties: number;

  // Pit
  pitStatus: number;
  driverStatus: number;
  numPitStops: number;
  lapDistance: number;
  pitStopTimer: number;
  deltaToCarInFront?: number;
  deltaToRaceLeader?: number;
  deltaToPlayer?: number;
  pitLaneTime?: number;
}

export interface StintInfo {
  compound: string;
  laps: number;
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
}

/**
 * Battle prediction alert from backend
 */
export interface BattleAlert {
  id: string;
  driverAhead: string;
  driverBehind: string;
  gapSeconds: number;
  closingRatePerLap: number;
  estOvertakeLap: number;
  side: 'ahead' | 'behind';
  timestamp: number;
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
