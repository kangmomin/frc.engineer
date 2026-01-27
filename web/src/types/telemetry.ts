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

/**
 * View mode for the dashboard
 */
export type ViewMode = 'driver' | 'pitwall';

/**
 * Tab identifiers for sidebar navigation
 */
export type TabId = 'cockpit' | 'engineer' | 'strategy' | 'telemetry' | 'timing';

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
export interface PitwallState {
  session: SessionInfo | null;
  drivers: DriverInfo[];
  positions: CarPosition[];
  playerIndex: number;
}

export interface SessionInfo {
  weather: string;
  trackTemp: number;
  airTemp: number;
  safetyCar: string;
  sessionType: string;
  totalLaps: number;
  trackId: number;
  trackLength: number;
}

export interface DriverInfo {
  index: number;
  name: string;
  teamId: number;
  position: number;
  currentLapNum: number;
  lastLapTime: number;
  bestLapTime: number;
  tireCompound: string;
  tireAge: number;
  tireWear: number[];
  tireTemp: number[];

  // Fuel & Energy
  fuelInTank: number;
  fuelRemainingLaps: number;
  fuelMix: number;
  ersStoreEnergy: number;
  ersDeployMode: number;
  ersDeployedThisLap: number;
  ersHarvestedThisLap: number;

  // Damage
  damage?: CarDamage;

  // Pit
  pitStatus: number;
  numPitStops: number;
  lapDistance: number;
  pitStopTimer: number;
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
