import type { SetupKey } from "../../../shared/setup-manager/catalog";

export type Mode = "equal" | "nonequal" | null;
export type WeatherMode = "dry" | "rain" | null;

export interface SenderRaceResult {
  id?: string;
  savedAtLocal?: string;
  track?: {
    trackName?: string;
  };
  session?: {
    sessionType?: string;
    weather?: string;
    trackTemp?: number;
  };
  player?: {
    name?: string;
    teamId?: number;
    finalPosition?: number;
    bestLapMs?: number;
    lastLapMs?: number;
  };
  highlights?: {
    fastestLapMs?: number;
  };
}

export interface AutoSetupContext {
  track: string | null;
  weather: WeatherMode;
  team: string | null;
  mode: Mode;
  source: "live-session" | "race-result" | null;
  sessionType: string | null;
  bestLapTime: number | null;
  trackTemp: number | null;
}

export interface SavedRecommendation {
  id: string;
  track: string;
  weather: Exclude<WeatherMode, null>;
  mode: Exclude<Mode, null>;
  team: string | null;
  setupKey: SetupKey;
  label: string;
  savedAtLocal: string;
  sessionType?: string;
  trackTemp?: number | null;
}

export interface LapComparisonSnapshot {
  slot: "before" | "after";
  source: "live" | "race-result";
  capturedAtLocal: string;
  track: string | null;
  weather: WeatherMode;
  team: string | null;
  setupKey: SetupKey | null;
  setupLabel: string | null;
  sessionType: string | null;
  trackTemp: number | null;
  bestLapTime: number | null;
  lastLapTime: number | null;
  topSpeed: number | null;
}

export interface LapComparisonState {
  before: LapComparisonSnapshot | null;
  after: LapComparisonSnapshot | null;
}

const TEAM_ID_TO_NAME: Record<number, string> = {
  0: "Mercedes",
  1: "Ferrari",
  2: "Red Bull",
  3: "Williams",
  4: "Aston Martin",
  5: "Alpine",
  6: "Vcarb",
  7: "Haas",
  8: "McLaren",
  9: "Sauber",
  10: "Audi",
};

export function formatSavedAtLocal(date = new Date()): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

export function resolveTrackName(
  raw: string | null | undefined,
  senderTrackMap: Record<string, string>,
  knownTracks: Array<{ name: string }>,
): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return null;
  }

  const direct = knownTracks.find((track) => track.name.toLowerCase() === trimmed.toLowerCase());
  if (direct) {
    return direct.name;
  }

  return senderTrackMap[trimmed.toLowerCase()] ?? null;
}

export function normalizeWeatherMode(raw: string | null | undefined): WeatherMode {
  const normalized = raw?.trim().toLowerCase().replace(/_/g, " ") ?? "";
  if (!normalized) {
    return null;
  }
  if (normalized.includes("rain") || normalized.includes("storm") || normalized.includes("wet")) {
    return "rain";
  }
  return "dry";
}

export function resolveTeamName(teamId: number | null | undefined): string | null {
  if (typeof teamId !== "number") {
    return null;
  }
  return TEAM_ID_TO_NAME[teamId] ?? null;
}

export function buildAutoSetupContext(args: {
  liveTrack: string | null;
  liveWeather: string | null | undefined;
  liveTeam: string | null;
  liveSessionType?: string | null;
  liveTrackTemp?: number | null;
  liveBestLapTime?: number | null;
  latestRaceResult?: SenderRaceResult | null;
  senderTrackMap: Record<string, string>;
  knownTracks: Array<{ name: string }>;
}): AutoSetupContext | null {
  const {
    liveTrack,
    liveWeather,
    liveTeam,
    liveSessionType,
    liveTrackTemp,
    liveBestLapTime,
    latestRaceResult,
    senderTrackMap,
    knownTracks,
  } = args;

  if (liveTrack || liveWeather || liveTeam) {
    const weather = normalizeWeatherMode(liveWeather);
    const team = liveTeam ?? null;
    return {
      track: liveTrack,
      weather,
      team,
      mode: team ? "nonequal" : liveTrack || weather ? "equal" : null,
      source: "live-session",
      sessionType: liveSessionType ?? null,
      bestLapTime: liveBestLapTime ?? null,
      trackTemp: liveTrackTemp ?? null,
    };
  }

  if (!latestRaceResult) {
    return null;
  }

  const track = resolveTrackName(latestRaceResult.track?.trackName, senderTrackMap, knownTracks);
  const weather = normalizeWeatherMode(latestRaceResult.session?.weather);
  const team = resolveTeamName(latestRaceResult.player?.teamId);
  if (!track && !weather && !team) {
    return null;
  }

  return {
    track,
    weather,
    team,
    mode: team ? "nonequal" : track || weather ? "equal" : null,
    source: "race-result",
    sessionType: latestRaceResult.session?.sessionType ?? null,
    bestLapTime: latestRaceResult.player?.bestLapMs ?? null,
    trackTemp: latestRaceResult.session?.trackTemp ?? null,
  };
}

export function buildRecommendationId(input: {
  track: string | null;
  weather: WeatherMode;
  mode: Mode;
  team: string | null;
}): string | null {
  if (!input.track || !input.weather || !input.mode) {
    return null;
  }
  const teamPart = input.mode === "nonequal" ? input.team ?? "unknown" : "equal";
  return [input.track, input.weather, input.mode, teamPart].join("::").toLowerCase();
}

export function normalizeSavedRecommendations(value: unknown): SavedRecommendation[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const out: SavedRecommendation[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const candidate = entry as Partial<SavedRecommendation>;
    const mode = candidate.mode === "equal" || candidate.mode === "nonequal" ? candidate.mode : null;
    const weather = candidate.weather === "dry" || candidate.weather === "rain" ? candidate.weather : null;
    if (!candidate.track || !candidate.setupKey || !candidate.label || !mode || !weather) {
      continue;
    }

    const team = mode === "nonequal" ? candidate.team ?? null : null;
    const id = buildRecommendationId({
      track: candidate.track,
      weather,
      mode,
      team,
    });
    if (!id || seen.has(id)) {
      continue;
    }

    out.push({
      id,
      track: candidate.track,
      weather,
      mode,
      team,
      setupKey: candidate.setupKey,
      label: candidate.label,
      savedAtLocal: candidate.savedAtLocal || formatSavedAtLocal(),
      sessionType: candidate.sessionType,
      trackTemp: typeof candidate.trackTemp === "number" ? candidate.trackTemp : null,
    });
    seen.add(id);
  }

  return out.sort((left, right) => right.savedAtLocal.localeCompare(left.savedAtLocal));
}

export function upsertSavedRecommendation(
  list: SavedRecommendation[],
  next: Omit<SavedRecommendation, "id" | "savedAtLocal"> & { savedAtLocal?: string },
): SavedRecommendation[] {
  const id = buildRecommendationId(next);
  if (!id) {
    return list;
  }

  const saved: SavedRecommendation = {
    ...next,
    id,
    team: next.mode === "nonequal" ? next.team ?? null : null,
    savedAtLocal: next.savedAtLocal ?? formatSavedAtLocal(),
  };

  return [saved, ...list.filter((entry) => entry.id !== id)].sort((left, right) =>
    right.savedAtLocal.localeCompare(left.savedAtLocal),
  );
}

export function findSavedRecommendation(
  list: SavedRecommendation[],
  context: { track: string | null; weather: WeatherMode; mode: Mode; team: string | null },
): SavedRecommendation | null {
  const id = buildRecommendationId(context);
  if (!id) {
    return null;
  }
  return list.find((entry) => entry.id === id) ?? null;
}

export function removeSavedRecommendation(list: SavedRecommendation[], id: string): SavedRecommendation[] {
  return list.filter((entry) => entry.id !== id);
}

export function normalizeLapComparisonState(value: unknown): LapComparisonState {
  if (!value || typeof value !== "object") {
    return { before: null, after: null };
  }

  const raw = value as Partial<LapComparisonState>;
  return {
    before: normalizeLapComparisonSnapshot(raw.before, "before"),
    after: normalizeLapComparisonSnapshot(raw.after, "after"),
  };
}

function normalizeLapComparisonSnapshot(
  value: unknown,
  slot: "before" | "after",
): LapComparisonSnapshot | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<LapComparisonSnapshot>;
  const weather = candidate.weather === "dry" || candidate.weather === "rain" ? candidate.weather : null;
  const source = candidate.source === "race-result" ? "race-result" : "live";
  return {
    slot,
    source,
    capturedAtLocal: candidate.capturedAtLocal || formatSavedAtLocal(),
    track: candidate.track ?? null,
    weather,
    team: candidate.team ?? null,
    setupKey: candidate.setupKey ?? null,
    setupLabel: candidate.setupLabel ?? null,
    sessionType: candidate.sessionType ?? null,
    trackTemp: typeof candidate.trackTemp === "number" ? candidate.trackTemp : null,
    bestLapTime: typeof candidate.bestLapTime === "number" ? candidate.bestLapTime : null,
    lastLapTime: typeof candidate.lastLapTime === "number" ? candidate.lastLapTime : null,
    topSpeed: typeof candidate.topSpeed === "number" ? candidate.topSpeed : null,
  };
}
