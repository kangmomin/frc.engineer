import { getPlatformUrl, isPlatformConfigured } from './platformBase';
import { getActiveSessionToken, getViewAsToken, notifySessionUnauthorized } from './session';
import type { TrackContext } from './tracks';

export type StrategyTyre = 'Soft' | 'Medium' | 'Hard' | 'Inter' | 'Wet';
export const STRATEGY_TYRES: StrategyTyre[] = ['Soft', 'Medium', 'Hard', 'Inter', 'Wet'];
export interface StrategyMinimums { users: number; sessions: number; cleanLaps: number }
export interface StrategyObservation {
  trackId: number; tyre: StrategyTyre | ''; uploads: number; laps: number;
  medianLapMs: number; minLapMs: number; maxLapMs: number;
  fuelLaps: number; medianFuelKg: number | null;
}
export interface StrategyContext {
  id: string;
  trackId: number;
  conditions: {
    packetFormat: number; gameYear: number; gameMajor: number; gameMinor: number;
    formula: number; sessionType: number; totalLaps: number; trackLengthM: number; teamId: number | null;
    rules: {
      equalPerformance: boolean; gameMode: number; ruleSet: number; sessionLength: number;
      surfaceType: number; lowFuelMode: number; tyreTemperature: number; pitLaneTyreSim: number;
      ersAssist: number; pitAssist: number; pitReleaseAssist: number; pitStopExperience: number;
    };
  };
  weather: number; trackTempBucket: number; tractionControl: number; abs: number;
  users: number; sessions: number; cleanLaps: number;
}
export interface StrategyContexts {
  contexts: StrategyContext[]; records: number; truncated: boolean; recordLimit: number; minUsers: number; minSessions: number;
  // Optional while the web and platform deployments are rolling out separately.
  minCleanLaps?: number;
  referenceMinimums?: StrategyMinimums | null;
  observations?: StrategyObservation[] | null;
  diagnostics?: {
    collectedLaps: number; cleanLaps: number; excludedLaps: number; excludedRecords: number;
    exclusions: { code: string; records: number; laps: number }[];
  } | null;
  archiveCoverage?: {
    uploadedRaces: number; withEvidence: number; withoutEvidence: number;
    latestUploadAt: string | null; truncated: boolean; limit: number;
  } | null;
}
export interface StrategyRequest {
  contextId: string; maxStops: number; availableSets: Partial<Record<StrategyTyre, number>>; requireTwoCompounds: boolean;
  allowLimitedEvidence?: boolean;
}
export interface StrategySegment { deployedJ: number; harvestedJ: number; durationMs: number; meanSpeedKph: number }
export interface StrategyResult {
  sampleLevel?: 'standard' | 'limited'; minimumEvidence?: StrategyMinimums;
  status: string; context: StrategyContext | null; reasons: string[]; validation: string;
  compounds: { compound: number; tyre: StrategyTyre; offsetMs: number; ageSlopeMs: number; minAge: number; maxAge: number; users: number; sessions: number; laps: number }[];
  fuelSlopeMsPerKg: number | null; lapMedianAbsoluteErrorMs: number | null;
  pit: { additionalTimeMs: number; medianAbsoluteDeviationMs: number; users: number; sessions: number; stops: number } | null;
  plans: { stints: { tyre: StrategyTyre; compound: number; startLap: number; endLap: number }[]; pitLaps: number[]; relativeCostMs: number; deltaMs: number }[];
  ers: {
    status: string; users: number; sessions: number; laps: number; deployedJ: number; harvestedJ: number; netUseJ: number;
    startEnergyJ: number; endEnergyJ: number; sustainableLaps: number; segments: StrategySegment[];
  };
}

export class StrategyError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function request<T>(path: string, signal?: AbortSignal, body?: unknown): Promise<T> {
  const token = getActiveSessionToken();
  if (!isPlatformConfigured() || !token) throw new StrategyError(401, '로그인이 필요합니다.');
  if (getViewAsToken()) throw new StrategyError(403, 'View As에서는 전략 실험실을 사용할 수 없습니다.');
  const response = await fetch(getPlatformUrl(path), {
    method: body === undefined ? 'GET' : 'POST', cache: 'no-store', signal,
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 401) notifySessionUnauthorized(token);
  if (!response.ok) throw new StrategyError(response.status, response.status === 403 ? '전략 실험실 사용 권한이 없습니다.' : response.status === 404 ? '비교 조건이 바뀌었습니다. 조건을 새로 불러오세요.' : '요청에 실패했습니다. 잠시 후 다시 시도하세요.');
  return response.json() as Promise<T>;
}
export interface StrategyFilter { trackId: number | null; format: string }
const query = (track: StrategyFilter) => {
  const params = new URLSearchParams();
  if (track.trackId !== null) params.set('trackId', String(track.trackId));
  params.set('gameFormat', track.format);
  return params.toString();
};
export const strategyClient = {
  contexts: (track: StrategyFilter, signal?: AbortSignal) => request<StrategyContexts>(`/strategies/contexts?${query(track)}`, signal),
  simulate: (track: TrackContext, body: StrategyRequest, signal?: AbortSignal) => request<StrategyResult>(`/strategies/simulate?${query(track)}`, signal, body),
};
export const strategyErrorMessage = (error: unknown) => error instanceof StrategyError ? error.message : '연결을 확인하고 다시 시도하세요.';
