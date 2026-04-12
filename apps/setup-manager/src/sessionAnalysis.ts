export const DEFAULT_ANALYSIS_URL = "http://localhost:8081";
export const ANALYSIS_URL_KEY = "frc_analysis_url";

export interface AnalysisSessionInfo {
  uid: string;
  timestamp: string;
  directory: string;
  hasLapData: boolean;
  hasTelemetry: boolean;
  hasMotion: boolean;
  hasCarStatus: boolean;
  hasSession: boolean;
  analysisAvailable: boolean;
  trackName: string | null;
  sessionType: string | null;
  weather: string | null;
  trackTemp: number | null;
}

export interface AnalysisSessionMeta {
  trackId: number | null;
  trackName: string | null;
  sessionType: string | null;
  weather: string | null;
  trackTemp: number | null;
  airTemp: number | null;
  totalLaps: number | null;
  trackLengthM: number | null;
}

export interface LapTrace {
  speed: Array<number | null>;
  throttle: Array<number | null>;
  brake: Array<number | null>;
  understeer: Array<number | null>;
  oversteer: Array<number | null>;
}

export interface ComparisonLap {
  lapNum: number;
  valid: boolean;
  lapTimeMs: number;
  sector1Ms: number;
  sector2Ms: number;
  sector3Ms: number;
  compound: string | null;
  tireAge: number | null;
  understeerPct: number;
  oversteerPct: number;
  lockupCount: number;
  spinCount: number;
  trace: LapTrace;
}

export interface ComparisonAnalysis {
  distances: number[];
  distanceBinM: number;
  bestLapNum: number | null;
  bestLapTimeMs: number | null;
  laps: ComparisonLap[];
}

export interface SessionAnalysisResult {
  session: AnalysisSessionMeta | null;
  comparison: ComparisonAnalysis | null;
}

export interface ComparisonDelta {
  value: number | null;
  text: string;
  direction: "better" | "worse" | "same" | "neutral";
}

export function normalizeAnalysisServerUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  return trimmed || DEFAULT_ANALYSIS_URL;
}

export function normalizeSessionList(value: unknown): AnalysisSessionInfo[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(normalizeSessionInfo)
    .filter((item): item is AnalysisSessionInfo => item !== null)
    .sort((left, right) => right.directory.localeCompare(left.directory));
}

export function normalizeSessionAnalysisResult(value: unknown): SessionAnalysisResult {
  if (!value || typeof value !== "object") {
    return { session: null, comparison: null };
  }

  const candidate = value as Record<string, unknown>;
  return {
    session: normalizeSessionMeta(candidate.session),
    comparison: normalizeComparisonAnalysis(candidate.comparison),
  };
}

export function getDefaultLapNumber(result: SessionAnalysisResult | null): number | null {
  if (!result?.comparison?.laps.length) {
    return null;
  }
  if (typeof result.comparison.bestLapNum === "number" && result.comparison.bestLapNum > 0) {
    return result.comparison.bestLapNum;
  }
  return result.comparison.laps[0]?.lapNum ?? null;
}

export function findComparisonLap(
  result: SessionAnalysisResult | null,
  lapNum: number | null,
): ComparisonLap | null {
  if (!result?.comparison || typeof lapNum !== "number") {
    return null;
  }
  return result.comparison.laps.find((lap) => lap.lapNum === lapNum) ?? null;
}

export function formatLapTime(value: number | null | undefined): string {
  return typeof value === "number" && value > 0 ? `${(value / 1000).toFixed(3)}s` : "--";
}

export function formatPercent(value: number | null | undefined): string {
  return typeof value === "number" ? `${value.toFixed(1)}%` : "--";
}

export function formatWeatherLabel(value: string | null | undefined): string {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized) {
    return "--";
  }
  if (normalized.includes("rain")) {
    return "Wet";
  }
  if (normalized === "clear" || normalized === "light_cloud" || normalized === "overcast") {
    return "Dry";
  }
  return normalized.replace(/_/g, " ");
}

export function formatTrackTemp(value: number | null | undefined): string {
  return typeof value === "number" ? `${value.toFixed(0)}C` : "--";
}

export function buildConditionMismatch(
  left: SessionAnalysisResult | null,
  right: SessionAnalysisResult | null,
): string | null {
  const leftMeta = left?.session;
  const rightMeta = right?.session;
  if (!leftMeta || !rightMeta) {
    return null;
  }

  const mismatches: string[] = [];
  if (leftMeta.trackName && rightMeta.trackName && leftMeta.trackName !== rightMeta.trackName) {
    mismatches.push("track");
  }
  if (leftMeta.sessionType && rightMeta.sessionType && leftMeta.sessionType !== rightMeta.sessionType) {
    mismatches.push("session");
  }
  if (leftMeta.weather && rightMeta.weather && formatWeatherLabel(leftMeta.weather) !== formatWeatherLabel(rightMeta.weather)) {
    mismatches.push("weather");
  }

  if (!mismatches.length) {
    return null;
  }
  return `Comparison conditions differ: ${mismatches.join(", ")}.`;
}

export function buildTimeDelta(after: number | null, before: number | null): ComparisonDelta {
  return buildMetricDelta(after, before, {
    scale: 1 / 1000,
    precision: 3,
    unit: "s",
    mode: "lower",
  });
}

export function buildMetricDelta(
  after: number | null,
  before: number | null,
  options: {
    scale?: number;
    precision?: number;
    unit?: string;
    mode?: "lower" | "higher" | "neutral";
  } = {},
): ComparisonDelta {
  if (typeof after !== "number" || typeof before !== "number") {
    return { value: null, text: "--", direction: "neutral" };
  }

  const scale = typeof options.scale === "number" ? options.scale : 1;
  const precision = typeof options.precision === "number" ? options.precision : 1;
  const unit = options.unit ?? "";
  const mode = options.mode ?? "neutral";
  const delta = after - before;
  const scaledDelta = delta * scale;
  if (delta === 0) {
    return {
      value: delta,
      text: `${scaledDelta.toFixed(precision)}${unit}`,
      direction: "same",
    };
  }

  let direction: ComparisonDelta["direction"] = "neutral";
  if (mode === "lower") {
    direction = delta < 0 ? "better" : "worse";
  } else if (mode === "higher") {
    direction = delta > 0 ? "better" : "worse";
  }

  return {
    value: delta,
    text: `${scaledDelta > 0 ? "+" : ""}${scaledDelta.toFixed(precision)}${unit}`,
    direction,
  };
}

export function averageTrace(series: Array<number | null>): number | null {
  const values = series.filter((value): value is number => typeof value === "number");
  if (!values.length) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function maxTrace(series: Array<number | null>): number | null {
  let max: number | null = null;
  for (const value of series) {
    if (typeof value !== "number") {
      continue;
    }
    if (max === null || value > max) {
      max = value;
    }
  }
  return max;
}

function normalizeSessionInfo(value: unknown): AnalysisSessionInfo | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const directory = typeof candidate.directory === "string" ? candidate.directory : null;
  if (!directory) {
    return null;
  }

  return {
    uid: typeof candidate.uid === "string" ? candidate.uid : "",
    timestamp: typeof candidate.timestamp === "string" ? candidate.timestamp : "",
    directory,
    hasLapData: Boolean(candidate.hasLapData),
    hasTelemetry: Boolean(candidate.hasTelemetry),
    hasMotion: Boolean(candidate.hasMotion),
    hasCarStatus: Boolean(candidate.hasCarStatus),
    hasSession: Boolean(candidate.hasSession),
    analysisAvailable: Boolean(candidate.analysisAvailable),
    trackName: typeof candidate.trackName === "string" && candidate.trackName ? candidate.trackName : null,
    sessionType: typeof candidate.sessionType === "string" && candidate.sessionType ? candidate.sessionType : null,
    weather: typeof candidate.weather === "string" && candidate.weather ? candidate.weather : null,
    trackTemp: typeof candidate.trackTemp === "number" ? candidate.trackTemp : null,
  };
}

function normalizeSessionMeta(value: unknown): AnalysisSessionMeta | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  return {
    trackId: typeof candidate.trackId === "number" ? candidate.trackId : null,
    trackName: typeof candidate.trackName === "string" && candidate.trackName ? candidate.trackName : null,
    sessionType: typeof candidate.sessionType === "string" && candidate.sessionType ? candidate.sessionType : null,
    weather: typeof candidate.weather === "string" && candidate.weather ? candidate.weather : null,
    trackTemp: typeof candidate.trackTemp === "number" ? candidate.trackTemp : null,
    airTemp: typeof candidate.airTemp === "number" ? candidate.airTemp : null,
    totalLaps: typeof candidate.totalLaps === "number" ? candidate.totalLaps : null,
    trackLengthM: typeof candidate.trackLengthM === "number" ? candidate.trackLengthM : null,
  };
}

function normalizeComparisonAnalysis(value: unknown): ComparisonAnalysis | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const distances = Array.isArray(candidate.distances)
    ? candidate.distances.filter((item): item is number => typeof item === "number")
    : [];
  const laps = Array.isArray(candidate.laps)
    ? candidate.laps.map((item) => normalizeComparisonLap(item, distances.length)).filter((item): item is ComparisonLap => item !== null)
    : [];

  return {
    distances,
    distanceBinM: typeof candidate.distanceBinM === "number" ? candidate.distanceBinM : 50,
    bestLapNum: typeof candidate.bestLapNum === "number" ? candidate.bestLapNum : null,
    bestLapTimeMs: typeof candidate.bestLapTimeMs === "number" ? candidate.bestLapTimeMs : null,
    laps,
  };
}

function normalizeComparisonLap(value: unknown, traceLength: number): ComparisonLap | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const lapNum = typeof candidate.lapNum === "number" ? candidate.lapNum : null;
  if (lapNum === null) {
    return null;
  }

  return {
    lapNum,
    valid: Boolean(candidate.valid),
    lapTimeMs: typeof candidate.lapTimeMs === "number" ? candidate.lapTimeMs : 0,
    sector1Ms: typeof candidate.sector1Ms === "number" ? candidate.sector1Ms : 0,
    sector2Ms: typeof candidate.sector2Ms === "number" ? candidate.sector2Ms : 0,
    sector3Ms: typeof candidate.sector3Ms === "number" ? candidate.sector3Ms : 0,
    compound: typeof candidate.compound === "string" && candidate.compound ? candidate.compound : null,
    tireAge: typeof candidate.tireAge === "number" ? candidate.tireAge : null,
    understeerPct: typeof candidate.understeerPct === "number" ? candidate.understeerPct : 0,
    oversteerPct: typeof candidate.oversteerPct === "number" ? candidate.oversteerPct : 0,
    lockupCount: typeof candidate.lockupCount === "number" ? candidate.lockupCount : 0,
    spinCount: typeof candidate.spinCount === "number" ? candidate.spinCount : 0,
    trace: normalizeLapTrace(candidate.trace, traceLength),
  };
}

function normalizeLapTrace(value: unknown, traceLength: number): LapTrace {
  if (!value || typeof value !== "object") {
    return emptyTrace(traceLength);
  }

  const candidate = value as Record<string, unknown>;
  return {
    speed: normalizeTraceSeries(candidate.speed, traceLength),
    throttle: normalizeTraceSeries(candidate.throttle, traceLength),
    brake: normalizeTraceSeries(candidate.brake, traceLength),
    understeer: normalizeTraceSeries(candidate.understeer, traceLength),
    oversteer: normalizeTraceSeries(candidate.oversteer, traceLength),
  };
}

function normalizeTraceSeries(value: unknown, traceLength: number): Array<number | null> {
  const fallback = emptySeries(traceLength);
  if (!Array.isArray(value)) {
    return fallback;
  }

  const normalized = value.map((item) => (typeof item === "number" ? item : null));
  if (normalized.length < traceLength) {
    return [...normalized, ...emptySeries(traceLength - normalized.length)];
  }
  return normalized.slice(0, traceLength);
}

function emptyTrace(length: number): LapTrace {
  return {
    speed: emptySeries(length),
    throttle: emptySeries(length),
    brake: emptySeries(length),
    understeer: emptySeries(length),
    oversteer: emptySeries(length),
  };
}

function emptySeries(length: number): Array<null> {
  return Array.from({ length }, () => null);
}
