// Mirror of the owner race-analysis read contract in internal/platformsvc.
// Keep this hand-written module wire-shaped: the service is the schema owner
// and this client deliberately does not add inferred fields.
import type { PlatformMySetupParams } from './platform';

export interface RaceAnalysisShare {
  token: string;
  includeSetup: boolean;
}

export interface SharedRaceAnalysis {
  detail: RaceAnalysisDetail;
  includeSetup: boolean;
  setup?: PlatformMySetupParams;
}

export type Availability = 'complete' | 'partial' | 'unavailable' | 'unknown';

export type CompletenessReason =
  | 'legacy-metadata-missing'
  | 'schema-unsupported'
  | 'source-missing'
  | 'late-capture'
  | 'checkpoint-finalize'
  | 'event-buffer-limit'
  | 'event-upload-limit'
  | 'incident-window-truncated'
  | 'incident-participant-limit'
  | 'incident-collision-limit'
  | 'incident-frame-limit'
  | 'incident-clip-limit'
  | 'incident-merge-limit'
  | 'upload-participants-trimmed'
  | 'upload-clips-dropped'
  | 'request-budget-dropped'
  | 'track-outline-unavailable'
  | 'track-outline-downsampled'
  | 'pit-measurement-unavailable';

export interface SectionCompleteness {
  status: Availability;
  reasons: CompletenessReason[];
  capturedCount: number | null;
  storedCount: number | null;
}

// [x,y,z,vx,vy,vz,yawRad,gLat,gLong,speedKmh,throttle,brake,steer,gear]
export type IncidentCarTuple = [
  number, number, number, number, number, number, number,
  number, number, number, number, number, number, number,
];

export interface RaceAnalysisTrack {
  id: number;
  name: string;
}

export interface RaceAnalysisListItem {
  id: string;
  track: RaceAnalysisTrack;
  sessionType: string;
  gameFormat: string;
  recordedAt: string | null;
  uploadedAt: string;
  finishPosition: number | null;
  completedLaps: number | null;
  bestLapMs: number | null;
  schemaVersion: number | null;
  incidentCount: number | null;
  completeness: {
    analysis: SectionCompleteness;
    incidents: SectionCompleteness;
  };
}

export interface RaceAnalysisListResponse {
  items: RaceAnalysisListItem[];
  nextOffset: number | null;
}

export interface RaceAnalysisLap {
  lapNumber: number;
  lapMs: number;
  s1Ms: number | null;
  s2Ms: number | null;
  s3Ms: number | null;
  tyre: string | null;
  valid: boolean;
}

export interface RaceAnalysisStint {
  compound: string;
  laps: number;
  startLap: number | null;
  endLap: number | null;
  tireWearPct: number | null;
}

export interface RaceAnalysisDynamic {
  lapNumber: number;
  understeerPct: number;
  oversteerPct: number;
  lockupCount: number;
  spinCount: number;
}

export interface RaceAnalysisPenalties {
  timePenaltySeconds: number;
  warnings: number;
  cornerCutWarnings: number;
  unservedDriveThrough: number;
  unservedStopGo: number;
}

export interface RaceAnalysisTyres {
  finalCompound: string | null;
  finalAge: number | null;
  averageWearPct: number | null;
  peakWearPct: number | null;
  finalSetWearPct: number | null;
  lifeSpan: number | null;
  usableLife: number | null;
  lifeRemainingPct: number | null;
}

export interface RaceAnalysisEvent {
  lap: number | null;
  timestamp: number | null;
  category: string;
  severity: string;
  message: string;
  driverName: string | null;
}

export interface RaceAnalysisPitMeasurement {
  stops: number;
  pitLaneTimeMs: number | null;
  stationaryMs: number | null;
}

export interface RaceAnalysisTrackOutline {
  points: Array<[number, number]>;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

export interface IncidentParticipant {
  idx: number;
  name: string;
  teamId: number | null;
  isPlayer: boolean;
  minDistM: number;
}

export interface IncidentCompleteness {
  status: Availability;
  reasons: CompletenessReason[];
  capturedParticipantCount: number | null;
  storedParticipantCount: number;
  capturedFrameCount: number | null;
  storedFrameCount: number;
}

export interface RaceAnalysisIncidentSummary {
  index: number;
  sessionTimeMs: number;
  windowStartMs: number;
  frameIntervalMs: number;
  lap: number | null;
  collisions: Array<[number, number]>;
  participants: IncidentParticipant[];
  frameCount: number;
  completeness: IncidentCompleteness;
}

export interface RaceAnalysisSectionCompleteness {
  laps: SectionCompleteness;
  sectors: SectionCompleteness;
  stints: SectionCompleteness;
  tyres: SectionCompleteness;
  dynamics: SectionCompleteness;
  penalties: SectionCompleteness;
  events: SectionCompleteness;
  pit: SectionCompleteness;
  trackOutline: SectionCompleteness;
  incidents: SectionCompleteness;
}

export interface RaceAnalysisDetail {
  id: string;
  track: RaceAnalysisTrack;
  sessionType: string;
  gameFormat: string;
  recordedAt: string | null;
  uploadedAt: string;
  finishPosition: number | null;
  completedLaps: number | null;
  bestLapMs: number | null;
  schemaVersion: number | null;
  laps: RaceAnalysisLap[];
  stints: RaceAnalysisStint[];
  dynamics: RaceAnalysisDynamic[];
  penalties: RaceAnalysisPenalties | null;
  tyres: RaceAnalysisTyres | null;
  events: RaceAnalysisEvent[];
  pitMeasurement: RaceAnalysisPitMeasurement | null;
  trackOutline: RaceAnalysisTrackOutline | null;
  incidents: RaceAnalysisIncidentSummary[];
  sectionCompleteness: RaceAnalysisSectionCompleteness;
}

export interface IncidentFrame {
  tMs: number;
  cars: Array<IncidentCarTuple | null>;
  // null is the explicit v0/v1 freshness ambiguity; [] is fresh v2 telemetry.
  telemetryUnavailable: number[] | null;
}

export interface IncidentReplay {
  raceId: string;
  index: number;
  schemaVersion: number | null;
  sessionTimeMs: number;
  windowStartMs: number;
  frameIntervalMs: number;
  lap: number | null;
  collisions: Array<[number, number]>;
  participants: IncidentParticipant[];
  frames: IncidentFrame[];
  completeness: IncidentCompleteness;
}
