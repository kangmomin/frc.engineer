import type {
  DataStorageMode,
  DriverInfo,
  RaceControlNotification,
  RaceListItem,
  RaceSummary,
  ReplayFrame,
  ReplayStreamFrame,
  ReplayStreamMeta,
  TrackMapData,
} from '../../types/telemetry';

export interface RaceArchiveFilters {
  search: string;
  track: string;
  session: string;
  storageMode: 'all' | DataStorageMode;
  replayOnly: boolean;
}

export interface ReplayBundle {
  meta: ReplayStreamMeta | null;
  frames: ReplayFrame[];
}

export interface ReplayMarker {
  id: string;
  type: 'safety-car' | 'penalty' | 'battle';
  label: string;
  detail?: string;
  frameIndex: number;
  timestamp: number;
}

export interface RaceArchiveDataSource {
  listRaces: (signal?: AbortSignal) => Promise<RaceListItem[]>;
  loadSummary: (id: string, signal?: AbortSignal) => Promise<RaceSummary>;
  loadReplay: (id: string, signal?: AbortSignal) => Promise<ReplayBundle>;
}

export type RaceArchiveOpenMode = 'result' | 'summary' | 'replay';

const BATTLE_GAP_MS = 1_250;
const MIN_BATTLE_FRAMES = 8;

export function filterRaceArchive(races: RaceListItem[], filters: RaceArchiveFilters): RaceListItem[] {
  const searchTerms = normalizeSearch(filters.search).split(/\s+/).filter(Boolean);

  return races.filter((race) => {
    if (filters.replayOnly && !race.hasReplay) {
      return false;
    }
    if (filters.track !== 'all' && race.trackName !== filters.track) {
      return false;
    }
    if (filters.session !== 'all' && race.sessionType !== filters.session) {
      return false;
    }
    if (filters.storageMode !== 'all' && (race.dataStorageMode ?? 'resultOnly') !== filters.storageMode) {
      return false;
    }
    if (searchTerms.length === 0) {
      return true;
    }

    const haystack = normalizeSearch([
      race.id,
      race.trackName,
      race.sessionType,
      race.playerName,
      String(race.finalPosition),
      race.savedAtLocal,
    ].join(' '));

    return searchTerms.every((term) => haystack.includes(term));
  });
}

export function normalizeSearch(value: string): string {
  return value.trim().toLowerCase();
}

export function formatRaceFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '--';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ['KB', 'MB', 'GB'];
  let size = bytes / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size >= 100 ? 0 : 1)} ${units[unitIndex]}`;
}

export function formatReplayClock(startTimestamp: number, currentTimestamp: number): string {
  if (!startTimestamp || !currentTimestamp || currentTimestamp < startTimestamp) {
    return '00:00.000';
  }

  const delta = currentTimestamp - startTimestamp;
  const totalSeconds = Math.floor(delta / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const milliseconds = delta % 1000;

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`;
}

export async function loadRaceArchiveList(signal?: AbortSignal): Promise<RaceListItem[]> {
  const response = await fetch('/api/races', { signal });
  if (!response.ok) {
    throw new Error(`Race archive request failed: ${response.status}`);
  }
  const items = await response.json() as RaceListItem[];
  return Array.isArray(items) ? items : [];
}

export async function loadRaceSummary(id: string, signal?: AbortSignal): Promise<RaceSummary> {
  const response = await fetch(`/api/races/${encodeURIComponent(id)}`, { signal });
  if (!response.ok) {
    throw new Error(`Race summary request failed: ${response.status}`);
  }
  return response.json() as Promise<RaceSummary>;
}

export async function loadReplayStream(id: string, signal?: AbortSignal): Promise<ReplayBundle> {
  const response = await fetch(`/api/replay/${encodeURIComponent(id)}`, { signal });
  if (!response.ok) {
    throw new Error(`Replay request failed: ${response.status}`);
  }

  const ct = response.headers.get('content-type') ?? '';
  if (!ct.includes('ndjson')) {
    throw new Error('Replay endpoint did not return NDJSON.');
  }

  const metaRef: { current: ReplayStreamMeta | null } = { current: null };
  const frames: ReplayFrame[] = [];

  if (!response.body) {
    const text = await response.text();
    parseReplayChunk(text, metaRef, frames);
    return { meta: metaRef.current, frames };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      parseReplayLine(line, metaRef, frames);
    }

    if (done) {
      break;
    }
  }

  if (buffer.trim().length > 0) {
    parseReplayLine(buffer, metaRef, frames);
  }

  return { meta: metaRef.current, frames };
}

export function resolveRaceArchiveOpenMode(race: RaceListItem): RaceArchiveOpenMode {
  const storageMode = race.dataStorageMode ?? 'resultOnly';

  if (storageMode === 'advanced' && race.hasReplay) {
    return 'replay';
  }
  if (storageMode === 'summary' || storageMode === 'advanced') {
    return 'summary';
  }
  return 'result';
}

function parseReplayChunk(
  chunk: string,
  metaRef: { current: ReplayStreamMeta | null },
  frames: ReplayFrame[],
) {
  for (const line of chunk.split('\n')) {
    parseReplayLine(line, metaRef, frames);
  }
}

function parseReplayLine(
  line: string,
  metaRef: { current: ReplayStreamMeta | null },
  frames: ReplayFrame[],
) {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }

  const parsed = JSON.parse(trimmed) as ReplayStreamMeta | ReplayStreamFrame;
  if (parsed.type === 'meta') {
    metaRef.current = parsed;
    return;
  }
  if (parsed.type === 'frame' && parsed.frame?.pitwall) {
    frames.push(parsed.frame);
  }
}

export function mergeReplayTrackMap(frame: ReplayFrame, trackMap?: TrackMapData): ReplayFrame {
  if (!trackMap || frame.pitwall.trackMap) {
    return frame;
  }
  return {
    ...frame,
    pitwall: {
      ...frame.pitwall,
      trackMap,
    },
  };
}

export function buildReplayMarkers(frames: ReplayFrame[]): ReplayMarker[] {
  const markers: ReplayMarker[] = [];
  const seenPenalty = new Set<string>();

  let lastSafetyCar = 'none';
  let battleStart = -1;
  let battleLabel: string | null = null;
  let battleCount = 0;

  frames.forEach((frame, frameIndex) => {
    const safetyCar = frame.pitwall.session?.safetyCar ?? lastSafetyCar;
    if (safetyCar !== lastSafetyCar && safetyCar !== 'none') {
      markers.push({
        id: `sc-${frameIndex}-${safetyCar}`,
        type: 'safety-car',
        label: formatSafetyCarLabel(safetyCar),
        frameIndex,
        timestamp: frame.timestamp,
      });
    }
    lastSafetyCar = safetyCar;

    for (const notification of frame.raceControl ?? []) {
      if (!isPenaltyMarker(notification)) {
        continue;
      }

      const key = notification.id || `${notification.category}-${notification.timestamp}-${notification.message}`;
      if (seenPenalty.has(key)) {
        continue;
      }
      seenPenalty.add(key);

      markers.push({
        id: `penalty-${key}`,
        type: 'penalty',
        label: notification.category === 'penalty' ? 'Penalty' : 'Warning',
        detail: notification.message,
        frameIndex,
        timestamp: notification.timestamp || frame.timestamp,
      });
    }

    const currentBattleLabel = getBattleLabel(frame);
    if (currentBattleLabel) {
      if (battleStart === -1) {
        battleStart = frameIndex;
        battleLabel = currentBattleLabel;
        battleCount = 1;
      } else {
        battleCount += 1;
      }
      return;
    }

    if (battleStart >= 0 && battleLabel && battleCount >= MIN_BATTLE_FRAMES) {
      const markerIndex = Math.floor((battleStart + frameIndex - 1) / 2);
      markers.push({
        id: `battle-${battleStart}-${markerIndex}`,
        type: 'battle',
        label: battleLabel,
        detail: 'Gap under 1.25s',
        frameIndex: markerIndex,
        timestamp: frames[markerIndex]?.timestamp ?? frame.timestamp,
      });
    }

    battleStart = -1;
    battleLabel = null;
    battleCount = 0;
  });

  if (battleStart >= 0 && battleLabel && battleCount >= MIN_BATTLE_FRAMES) {
    const markerIndex = Math.floor((battleStart + frames.length - 1) / 2);
    markers.push({
      id: `battle-${battleStart}-${markerIndex}`,
      type: 'battle',
      label: battleLabel,
      detail: 'Gap under 1.25s',
      frameIndex: markerIndex,
      timestamp: frames[markerIndex]?.timestamp ?? 0,
    });
  }

  return markers.sort((a, b) => a.frameIndex - b.frameIndex);
}

export function getPlayerDriver(frame: ReplayFrame): DriverInfo | null {
  const playerIndex = frame.pitwall.playerIndex;
  return frame.pitwall.drivers.find((driver) => driver.index === playerIndex) ?? null;
}

export function getBehindGap(frame: ReplayFrame, player: DriverInfo | null): number | null {
  if (!player) {
    return null;
  }

  const behind = frame.pitwall.drivers.find((driver) => driver.position === player.position + 1);
  if (!behind) {
    return null;
  }

  const gap = behind.deltaToCarInFront ?? 0;
  return gap > 0 ? gap : null;
}

function isPenaltyMarker(notification: RaceControlNotification): boolean {
  return notification.category === 'penalty'
    || notification.category === 'warning'
    || notification.severity === 'warning'
    || notification.severity === 'critical';
}

function getBattleLabel(frame: ReplayFrame): string | null {
  const player = getPlayerDriver(frame);
  if (!player) {
    return null;
  }

  const aheadGap = player.deltaToCarInFront ?? 0;
  const behindGap = getBehindGap(frame, player) ?? 0;
  const ahead = aheadGap > 0 && aheadGap <= BATTLE_GAP_MS;
  const behind = behindGap > 0 && behindGap <= BATTLE_GAP_MS;

  if (ahead && behind) {
    return 'Sandwich';
  }
  if (ahead) {
    return 'Attack';
  }
  if (behind) {
    return 'Defend';
  }
  return null;
}

function formatSafetyCarLabel(value: string): string {
  if (value === 'full') {
    return 'SC';
  }
  if (value === 'virtual') {
    return 'VSC';
  }
  if (value === 'virtual_ending' || value === 'virtual_standing') {
    return 'VSC End';
  }
  if (value === 'formation') {
    return 'Formation';
  }
  return value.toUpperCase();
}
