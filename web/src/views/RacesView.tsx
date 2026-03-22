import { useEffect, useMemo, useState } from 'react';
import { CommandCenter } from '../components/command-center/CommandCenter';
import { LeaderboardSection } from '../components/command-center/sections/LeaderboardSection';
import { TrackMapSection } from '../components/command-center/sections/TrackMapSection';
import { useTelemetryStore } from '../store/telemetryStore';
import type {
  BattleAlert,
  DataStorageMode,
  DriverInfo,
  RaceControlNotification,
  RaceListItem,
  SessionInfo,
  RaceSummary,
} from '../types/telemetry';
import styles from './RacesView.module.css';

function formatLap(ms: number): string {
  if (!ms || ms <= 0) return '-';
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const millis = ms % 1000;
  return `${minutes}:${seconds.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`;
}

function formatStorageMode(mode?: DataStorageMode): string {
  if (mode === 'advanced') return 'Advanced';
  if (mode === 'summary') return 'Summary';
  return 'Result Only';
}

function formatReplayClock(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '00:00';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function formatFileSize(bytes: number | undefined): string {
  if (!Number.isFinite(bytes) || !bytes || bytes <= 0) return '-';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(1)} GB`;
}

function normalizeRaceControlList(list: RaceControlNotification[] | undefined): RaceControlNotification[] {
  if (!list || list.length === 0) return [];
  return list.map((item, idx) => {
    const timestamp = Number.isFinite(item.timestamp) ? item.timestamp : Date.now();
    return {
      ...item,
      id: item.id || `rc-${timestamp}-${idx}`,
      timestamp,
      category: item.category ?? 'info',
      severity: item.severity ?? 'info',
      message: item.message ?? '',
    };
  });
}

function normalizeBattleAlertList(list: BattleAlert[] | undefined): BattleAlert[] {
  if (!list || list.length === 0) return [];
  return list.map((item, idx) => {
    const timestamp = Number.isFinite(item.timestamp) ? item.timestamp : Date.now();
    return {
      ...item,
      id: item.id || `ba-${timestamp}-${idx}`,
      timestamp,
      driverAhead: item.driverAhead ?? 'Unknown',
      driverBehind: item.driverBehind ?? 'Unknown',
      gapSeconds: item.gapSeconds ?? 0,
      closingRatePerLap: item.closingRatePerLap ?? 0,
      estOvertakeLap: item.estOvertakeLap ?? 0,
      side: item.side === 'behind' ? 'behind' : 'ahead',
    };
  });
}

function mergeReplaySession(
  frameSession: SessionInfo | null | undefined,
  replaySession: SessionInfo | undefined,
): SessionInfo | null {
  if (!frameSession && !replaySession) return null;
  if (!frameSession && replaySession) return replaySession;
  if (!frameSession) return null;
  if (!replaySession) return frameSession;
  return {
    ...replaySession,
    ...frameSession,
    marshalZones: frameSession.marshalZones?.length
      ? frameSession.marshalZones
      : replaySession.marshalZones,
    weatherForecast: frameSession.weatherForecast?.length
      ? frameSession.weatherForecast
      : replaySession.weatherForecast,
  };
}

const RACE_DETAIL_FETCH_RETRIES = 2;
const RACE_DETAIL_RETRY_BASE_DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function isRetryableDetailError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return (
    msg.includes('unexpected end of json input') ||
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('socket hang up') ||
    msg.includes('response body was truncated')
  );
}

function parseJsonInWorker<T>(raw: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const source = `
      self.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data);
          self.postMessage({ ok: true, parsed });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          self.postMessage({ ok: false, message });
        }
      };
    `;

    const blob = new Blob([source], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    const worker = new Worker(url);

    const cleanup = () => {
      worker.terminate();
      URL.revokeObjectURL(url);
    };

    worker.onmessage = (event) => {
      cleanup();
      if (event.data?.ok) {
        resolve(event.data.parsed as T);
        return;
      }
      reject(new Error(event.data?.message ?? 'failed to parse JSON'));
    };

    worker.onerror = () => {
      cleanup();
      reject(new Error('worker parse failed'));
    };

    worker.postMessage(raw);
  });
}

async function fetchRaceSummary(url: string, label: string): Promise<RaceSummary> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`failed to load ${label} (${res.status})`);
  }

  const raw = await res.text();
  if (!raw) {
    throw new Error('response body was truncated');
  }

  return parseJsonInWorker<RaceSummary>(raw);
}

async function fetchRaceSummaryWithRetry(url: string, label: string): Promise<RaceSummary> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= RACE_DETAIL_FETCH_RETRIES; attempt++) {
    try {
      return await fetchRaceSummary(url, label);
    } catch (error) {
      lastError = error;
      if (!isRetryableDetailError(error) || attempt === RACE_DETAIL_FETCH_RETRIES) {
        break;
      }
      const backoff = RACE_DETAIL_RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
      await sleep(backoff);
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error(`failed to load ${label}`);
}

function buildReplaySummaryFromStream(
  id: string,
  raceMeta: RaceListItem,
  streamMeta: ReplayStreamMetaRecord,
  frames: ReplayFrame[],
): RaceSummary {
  const session = streamMeta.session;
  return {
    id,
    savedAtLocal: raceMeta.savedAtLocal,
    sessionUID: 0,
    dataStorageMode: raceMeta.dataStorageMode ?? 'summary',
    track: {
      trackId: session?.trackId ?? -1,
      trackName: session?.trackName ?? raceMeta.trackName ?? '',
    },
    session: {
      sessionType: session?.sessionType ?? raceMeta.sessionType ?? '',
      totalLaps: session?.totalLaps ?? 0,
      safetyCar: session?.safetyCar ?? '',
      weather: session?.weather ?? '',
      airTemp: session?.airTemp ?? 0,
      trackTemp: session?.trackTemp ?? 0,
    },
    player: {
      driverIndex: -1,
      name: raceMeta.playerName ?? '',
      teamId: -1,
      finalPosition: raceMeta.finalPosition ?? 0,
      completedLaps: 0,
      bestLapMs: 0,
      lastLapMs: 0,
      pitStops: 0,
    },
    drivers: [],
    highlights: {
      notifications: {
        penalty: 0,
        warning: 0,
        info: 0,
      },
    },
    replay: {
      frameIntervalMs: streamMeta.frameIntervalMs > 0 ? streamMeta.frameIntervalMs : 250,
      trackMap: streamMeta.trackMap,
      session: streamMeta.session,
      frames,
    },
  };
}

function parseReplayStreamLine(line: string): ReplayStreamRecord {
  const parsed = JSON.parse(line) as ReplayStreamRecord;
  if (!parsed || typeof parsed !== 'object' || !('type' in parsed)) {
    throw new Error('invalid replay stream payload');
  }
  return parsed;
}

async function fetchReplaySummaryFromStream(id: string, raceMeta: RaceListItem): Promise<RaceSummary> {
  const res = await fetch(`/api/replay/${encodeURIComponent(id)}`, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`failed to load replay stream (${res.status})`);
  }
  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('application/x-ndjson')) {
    throw new Error('replay stream endpoint unavailable (restart backend)');
  }
  if (!res.body) {
    throw new Error('replay stream body unavailable');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let meta: ReplayStreamMetaRecord | null = null;
  const frames: ReplayFrame[] = [];

  const consumeLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    const record = parseReplayStreamLine(trimmed);
    if (record.type === 'meta') {
      meta = record;
      return;
    }
    if (record.type === 'frame') {
      frames.push(record.frame);
      return;
    }
    if (record.type === 'error') {
      throw new Error(record.message || 'replay stream failed');
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    let newlineIdx = buffer.indexOf('\n');
    while (newlineIdx >= 0) {
      const line = buffer.slice(0, newlineIdx);
      buffer = buffer.slice(newlineIdx + 1);
      consumeLine(line);
      newlineIdx = buffer.indexOf('\n');
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    consumeLine(buffer);
  }

  if (!meta) {
    throw new Error('missing replay stream metadata');
  }

  return buildReplaySummaryFromStream(id, raceMeta, meta, frames);
}

async function fetchReplaySummaryFromStreamWithRetry(
  id: string,
  raceMeta: RaceListItem,
  label: string,
): Promise<RaceSummary> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= RACE_DETAIL_FETCH_RETRIES; attempt++) {
    try {
      return await fetchReplaySummaryFromStream(id, raceMeta);
    } catch (error) {
      lastError = error;
      if (!isRetryableDetailError(error) || attempt === RACE_DETAIL_FETCH_RETRIES) {
        break;
      }
      const backoff = RACE_DETAIL_RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
      await sleep(backoff);
    }
  }

  if (lastError instanceof Error) {
    throw new Error(lastError.message || `failed to load ${label}`);
  }
  throw new Error(`failed to load ${label}`);
}

const MAX_ERS_ENERGY = 4_000_000;
const PRIMARY_SERIES_COLOR = '#00d2ff';
const COMPARE_SERIES_COLOR = '#ff9f43';

type ReplayTab = 'pitwall' | 'telemetry';

type ReplayFrame = NonNullable<RaceSummary['replay']>['frames'][number];

interface ReplayStreamMetaRecord {
  type: 'meta';
  frameIntervalMs: number;
  trackMap?: NonNullable<RaceSummary['replay']>['trackMap'];
  session?: SessionInfo;
}

interface ReplayStreamFrameRecord {
  type: 'frame';
  frame: ReplayFrame;
}

interface ReplayStreamErrorRecord {
  type: 'error';
  message?: string;
}

type ReplayStreamRecord =
  | ReplayStreamMetaRecord
  | ReplayStreamFrameRecord
  | ReplayStreamErrorRecord;

interface ReplayTelemetrySample {
  timeSec: number;
  ers: number;
  throttle: number;
  brake: number;
  gear: number;
  speed: number;
  steering: number;
}

type ReplayMetricKey = keyof Omit<ReplayTelemetrySample, 'timeSec'>;

interface ReplayMetricDef {
  key: ReplayMetricKey;
  title: string;
  unit: string;
  min?: number;
  max?: number;
  midline?: number;
  format: (value: number) => string;
}

const TELEMETRY_METRICS: ReplayMetricDef[] = [
  { key: 'ers', title: 'ERS', unit: '%', min: 0, max: 100, format: (value) => `${value.toFixed(1)}%` },
  { key: 'throttle', title: 'Throttle', unit: '%', min: 0, max: 100, format: (value) => `${value.toFixed(1)}%` },
  { key: 'brake', title: 'Brake', unit: '%', min: 0, max: 100, format: (value) => `${value.toFixed(1)}%` },
  { key: 'gear', title: 'Gear', unit: '', min: -1, max: 8, format: formatGearValue },
  { key: 'speed', title: 'Speed', unit: 'km/h', min: 0, format: (value) => `${Math.round(value)} km/h` },
  { key: 'steering', title: 'Steering', unit: '%', min: -100, max: 100, midline: 0, format: (value) => `${value.toFixed(0)}%` },
];

function formatGearValue(value: number): string {
  const rounded = Math.round(value);
  if (rounded < 0) return 'R';
  if (rounded === 0) return 'N';
  return `${rounded}`;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function toFinite(value: number | undefined, fallback: number = 0): number {
  return Number.isFinite(value) ? Number(value) : fallback;
}

function getPlayerDriverFromFrame(frame: ReplayFrame): DriverInfo | null {
  const pitwall = frame.pitwall;
  if (!pitwall || pitwall.drivers.length === 0) return null;
  const playerIndex = pitwall.playerIndex;
  const found = pitwall.drivers.find((driver) => driver.index === playerIndex);
  if (found) return found;
  if (playerIndex >= 0 && playerIndex < pitwall.drivers.length) {
    return pitwall.drivers[playerIndex] ?? null;
  }
  return null;
}

function buildReplayTelemetrySamples(summary: RaceSummary | null): ReplayTelemetrySample[] {
  const frames = summary?.replay?.frames ?? [];
  if (frames.length === 0) return [];

  const startTimestamp = frames[0].timestamp;
  const out: ReplayTelemetrySample[] = [];

  for (const frame of frames) {
    const player = getPlayerDriverFromFrame(frame);
    if (!player) continue;

    const timeSec = Math.max(0, (toFinite(frame.timestamp) - toFinite(startTimestamp)) / 1000);
    const ersPercent = clamp((toFinite(player.ersStoreEnergy) / MAX_ERS_ENERGY) * 100, 0, 100);
    const throttlePercent = clamp(toFinite(player.throttle) * 100, 0, 100);
    const brakePercent = clamp(toFinite(player.brake) * 100, 0, 100);
    const steeringPercent = clamp(toFinite(player.steering) * 100, -100, 100);

    out.push({
      timeSec,
      ers: ersPercent,
      throttle: throttlePercent,
      brake: brakePercent,
      gear: toFinite(player.gear),
      speed: Math.max(0, toFinite(player.speed)),
      steering: steeringPercent,
    });
  }

  return out;
}

function getSampleValueAtTime(
  samples: ReplayTelemetrySample[],
  metric: ReplayMetricKey,
  timeSec: number,
): number | null {
  if (samples.length === 0) return null;
  let idx = 0;
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].timeSec <= timeSec) {
      idx = i;
      continue;
    }
    break;
  }
  return samples[idx]?.[metric] ?? null;
}

function hasTelemetrySignal(samples: ReplayTelemetrySample[]): boolean {
  return samples.some((sample) =>
    sample.speed > 0 ||
    sample.throttle > 0 ||
    sample.brake > 0 ||
    sample.gear !== 0 ||
    Math.abs(sample.steering) > 0.01,
  );
}

interface TelemetryMetricChartProps {
  metric: ReplayMetricDef;
  primarySamples: ReplayTelemetrySample[];
  compareSamples: ReplayTelemetrySample[];
  currentTimeSec: number;
  windowSec: number;
}

function TelemetryMetricChart({ metric, primarySamples, compareSamples, currentTimeSec, windowSec }: TelemetryMetricChartProps) {
  const width = 720;
  const height = 190;
  const padX = 30;
  const padY = 18;

  const xMin = Math.max(0, currentTimeSec - windowSec);
  const xEnd = currentTimeSec;

  const filterWindow = (samples: ReplayTelemetrySample[]) => {
    const pts: { x: number; y: number }[] = [];
    for (const s of samples) {
      if (s.timeSec < xMin) continue;
      if (s.timeSec > xEnd) break;
      pts.push({ x: s.timeSec, y: s[metric.key] });
    }
    return pts;
  };

  const primaryPoints = useMemo(
    () => filterWindow(primarySamples),
    [primarySamples, metric.key, xMin, xEnd],
  );
  const comparePoints = useMemo(
    () => filterWindow(compareSamples),
    [compareSamples, metric.key, xMin, xEnd],
  );

  const allPoints = useMemo(
    () => [...primaryPoints, ...comparePoints],
    [primaryPoints, comparePoints],
  );

  const yMin = useMemo(() => {
    if (metric.min !== undefined) return metric.min;
    if (allPoints.length === 0) return 0;
    return Math.min(...allPoints.map((point) => point.y));
  }, [allPoints, metric.min]);
  const yMax = useMemo(() => {
    if (metric.max !== undefined) return metric.max;
    if (allPoints.length === 0) return 1;
    return Math.max(...allPoints.map((point) => point.y));
  }, [allPoints, metric.max]);

  const normalizedY = useMemo(() => {
    if (Math.abs(yMax - yMin) < 1e-6) {
      return { min: yMin - 1, max: yMax + 1 };
    }
    return { min: yMin, max: yMax };
  }, [yMax, yMin]);

  const xRange = Math.max(windowSec, 0.001);
  const toX = (value: number) => padX + ((value - xMin) / xRange) * (width - padX * 2);
  const toY = (value: number) =>
    height - padY - ((value - normalizedY.min) / (normalizedY.max - normalizedY.min)) * (height - padY * 2);

  const buildPath = (points: { x: number; y: number }[]): string => {
    if (points.length === 0) return '';
    return points
      .map((point, index) => `${index === 0 ? 'M' : 'L'} ${toX(point.x).toFixed(2)} ${toY(point.y).toFixed(2)}`)
      .join(' ');
  };

  const primaryPath = buildPath(primaryPoints);
  const comparePath = buildPath(comparePoints);
  const primaryCurrentValue = getSampleValueAtTime(primarySamples, metric.key, currentTimeSec);
  const compareCurrentValue = getSampleValueAtTime(compareSamples, metric.key, currentTimeSec);
  const currentMarkerX = toX(clamp(currentTimeSec, xMin, xEnd));

  return (
    <div className={styles.telemetryMetricCard}>
      <div className={styles.telemetryMetricHeader}>
        <div className={styles.telemetryMetricTitleWrap}>
          <span className={styles.telemetryMetricTitle}>{metric.title}</span>
          <span className={styles.telemetryMetricUnit}>{metric.unit}</span>
        </div>
        <div className={styles.telemetryMetricValues}>
          <span className={styles.telemetryMetricPrimaryValue}>
            Main: {primaryCurrentValue === null ? '-' : metric.format(primaryCurrentValue)}
          </span>
          {compareSamples.length > 0 && (
            <span className={styles.telemetryMetricCompareValue}>
              Compare: {compareCurrentValue === null ? '-' : metric.format(compareCurrentValue)}
            </span>
          )}
        </div>
      </div>

      <svg className={styles.telemetryMetricSvg} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        <line
          x1={padX}
          y1={height - padY}
          x2={width - padX}
          y2={height - padY}
          className={styles.telemetryAxisLine}
        />
        <line
          x1={padX}
          y1={padY}
          x2={padX}
          y2={height - padY}
          className={styles.telemetryAxisLine}
        />
        {metric.midline !== undefined && (
          <line
            x1={padX}
            y1={toY(metric.midline)}
            x2={width - padX}
            y2={toY(metric.midline)}
            className={styles.telemetryMidLine}
          />
        )}

        {primaryPath && (
          <path
            d={primaryPath}
            fill="none"
            stroke={PRIMARY_SERIES_COLOR}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}
        {comparePath && (
          <path
            d={comparePath}
            fill="none"
            stroke={COMPARE_SERIES_COLOR}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}

        <line
          x1={currentMarkerX}
          y1={padY}
          x2={currentMarkerX}
          y2={height - padY}
          className={styles.telemetryCurrentLine}
        />
      </svg>
    </div>
  );
}

const TELEMETRY_WINDOW_OPTIONS = [3, 5, 10, 30, 60];

interface TelemetryReplayPanelProps {
  primarySummary: RaceSummary;
  compareSummary: RaceSummary | null;
  currentTimeSec: number;
}

function TelemetryReplayPanel({ primarySummary, compareSummary, currentTimeSec }: TelemetryReplayPanelProps) {
  const [windowSec, setWindowSec] = useState(3);
  const primarySamples = useMemo(
    () => buildReplayTelemetrySamples(primarySummary),
    [primarySummary],
  );
  const compareSamples = useMemo(
    () => buildReplayTelemetrySamples(compareSummary),
    [compareSummary],
  );
  const signalReady = hasTelemetrySignal(primarySamples);

  return (
    <div className={styles.telemetryReplayLayout}>
      <div className={styles.telemetryPrimaryGrid}>
        <div className={styles.telemetryPanelBlock}>
          <TrackMapSection />
        </div>
        <div className={styles.telemetryPanelBlock}>
          <LeaderboardSection />
        </div>
      </div>

      {signalReady ? (
        <>
          <div className={styles.telemetryWindowBar}>
            <span className={styles.telemetryWindowLabel}>Window</span>
            {TELEMETRY_WINDOW_OPTIONS.map((sec) => (
              <button
                key={sec}
                type="button"
                className={`${styles.telemetryWindowBtn} ${windowSec === sec ? styles.telemetryWindowBtnActive : ''}`}
                onClick={() => setWindowSec(sec)}
              >
                {sec}s
              </button>
            ))}
          </div>
          <div className={styles.telemetryMetricsGrid}>
            {TELEMETRY_METRICS.map((metric) => (
              <TelemetryMetricChart
                key={metric.key}
                metric={metric}
                primarySamples={primarySamples}
                compareSamples={compareSamples}
                currentTimeSec={currentTimeSec}
                windowSec={windowSec}
              />
            ))}
          </div>
        </>
      ) : (
        <div className={styles.telemetryNoData}>
          This advanced replay file does not include telemetry channels. Save a new advanced race file.
        </div>
      )}
    </div>
  );
}

export function RacesView() {
  const [races, setRaces] = useState<RaceListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RaceSummary | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [replayTab, setReplayTab] = useState<ReplayTab>('pitwall');
  const [compareRaceId, setCompareRaceId] = useState('');
  const [compareDetail, setCompareDetail] = useState<RaceSummary | null>(null);
  const [loadingCompare, setLoadingCompare] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);

  const setPlaybackActive = useTelemetryStore((state) => state.setPlaybackActive);
  const applyReplayFrame = useTelemetryStore((state) => state.applyReplayFrame);
  const clearNotifications = useTelemetryStore((state) => state.clearNotifications);
  const selectedRaceMeta = useMemo(
    () => races.find((race) => race.id === selectedId) ?? null,
    [races, selectedId],
  );

  useEffect(() => {
    let mounted = true;
    setLoadingList(true);
    fetch('/api/races')
      .then(async (res) => {
        if (!res.ok) throw new Error(`failed to load races (${res.status})`);
        return res.json();
      })
      .then((data: RaceListItem[]) => {
        if (!mounted) return;
        setRaces(data ?? []);
        if (data && data.length > 0) {
          setSelectedId((prev) => prev ?? data[0].id);
        }
      })
      .catch((e: unknown) => {
        if (!mounted) return;
        setError(e instanceof Error ? e.message : 'failed to load race list');
      })
      .finally(() => {
        if (mounted) setLoadingList(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }

    let mounted = true;
    setLoadingDetail(true);
    setError(null);
    setDetail(null);
    setPlaying(false);
    setFrameIndex(0);
    setReplayTab('pitwall');
    setCompareRaceId('');
    setCompareDetail(null);
    setCompareError(null);

    const loadDetailPromise = selectedRaceMeta?.hasReplay
      ? fetchReplaySummaryFromStreamWithRetry(selectedId, selectedRaceMeta, 'race replay')
      : fetchRaceSummaryWithRetry(`/api/races/${encodeURIComponent(selectedId)}`, 'race detail');

    loadDetailPromise
      .then((data: RaceSummary) => {
        if (!mounted) return;
        setDetail(data);
      })
      .catch((e: unknown) => {
        if (!mounted) return;
        setError(e instanceof Error ? e.message : 'failed to load race detail');
      })
      .finally(() => {
        if (mounted) setLoadingDetail(false);
      });

    return () => {
      mounted = false;
    };
  }, [selectedId, selectedRaceMeta]);

  const replayFrames = useMemo(() => detail?.replay?.frames ?? [], [detail?.replay?.frames]);
  const replayTrackMap = detail?.replay?.trackMap;
  const replaySession = detail?.replay?.session;
  const hasReplay = replayFrames.length > 0;
  const isAdvancedReplay = hasReplay && detail?.dataStorageMode === 'advanced';

  useEffect(() => {
    setPlaybackActive(hasReplay);
    if (!hasReplay) {
      clearNotifications();
    }
  }, [hasReplay, setPlaybackActive, clearNotifications]);

  useEffect(() => {
    return () => {
      setPlaybackActive(false);
    };
  }, [setPlaybackActive]);

  useEffect(() => {
    if (!hasReplay) return;
    if (frameIndex < replayFrames.length) return;
    setFrameIndex(Math.max(0, replayFrames.length - 1));
  }, [hasReplay, frameIndex, replayFrames.length]);

  useEffect(() => {
    if (!hasReplay) return;
    const frame = replayFrames[frameIndex];
    if (!frame?.pitwall) return;
    const mergedPitwall = {
      ...frame.pitwall,
      trackMap: frame.pitwall.trackMap ?? replayTrackMap,
      session: mergeReplaySession(frame.pitwall.session, replaySession),
    };

    applyReplayFrame({
      pitwall: mergedPitwall,
      raceControl: normalizeRaceControlList(frame.raceControl),
      battleAlerts: normalizeBattleAlertList(frame.battleAlerts),
    });
  }, [applyReplayFrame, frameIndex, hasReplay, replayFrames, replaySession, replayTrackMap]);

  useEffect(() => {
    if (!playing || !hasReplay || replayFrames.length <= 1) return;

    const baseInterval = detail?.replay?.frameIntervalMs ?? 250;
    const interval = Math.max(50, Math.round(baseInterval / playbackRate));
    const timer = window.setInterval(() => {
      setFrameIndex((prev) => Math.min(prev + 1, replayFrames.length - 1));
    }, interval);

    return () => window.clearInterval(timer);
  }, [detail?.replay?.frameIntervalMs, hasReplay, playbackRate, playing, replayFrames.length]);

  useEffect(() => {
    if (playing && hasReplay && frameIndex >= replayFrames.length - 1) {
      setPlaying(false);
    }
  }, [frameIndex, hasReplay, playing, replayFrames.length]);

  const selectedIndex = useMemo(
    () => races.findIndex((r) => r.id === selectedId),
    [races, selectedId],
  );
  const compareOptions = useMemo(
    () => races.filter((race) => race.id !== selectedId && race.dataStorageMode === 'advanced' && (race.hasReplay ?? false)),
    [races, selectedId],
  );
  const selectedCompareMeta = useMemo(
    () => compareOptions.find((race) => race.id === compareRaceId) ?? null,
    [compareOptions, compareRaceId],
  );

  useEffect(() => {
    if (!detail || detail.dataStorageMode !== 'advanced') {
      setReplayTab('pitwall');
      setCompareRaceId('');
      setCompareDetail(null);
      setCompareError(null);
    }
  }, [detail]);

  useEffect(() => {
    if (!compareRaceId) return;
    if (compareOptions.some((race) => race.id === compareRaceId)) return;
    setCompareRaceId('');
    setCompareDetail(null);
    setCompareError(null);
  }, [compareOptions, compareRaceId]);

  useEffect(() => {
    if (!compareRaceId) {
      setCompareDetail(null);
      setCompareError(null);
      setLoadingCompare(false);
      return;
    }

    let mounted = true;
    setLoadingCompare(true);
    setCompareError(null);

    const loadComparePromise = selectedCompareMeta
      ? fetchReplaySummaryFromStreamWithRetry(compareRaceId, selectedCompareMeta, 'compare replay')
      : fetchRaceSummaryWithRetry(`/api/races/${encodeURIComponent(compareRaceId)}`, 'compare race');

    loadComparePromise
      .then((data: RaceSummary) => {
        if (!mounted) return;
        if (!data.replay || (data.replay.frames?.length ?? 0) === 0) {
          throw new Error('selected compare race has no replay data');
        }
        setCompareDetail(data);
      })
      .catch((e: unknown) => {
        if (!mounted) return;
        setCompareDetail(null);
        setCompareError(e instanceof Error ? e.message : 'failed to load compare race');
      })
      .finally(() => {
        if (mounted) setLoadingCompare(false);
      });

    return () => {
      mounted = false;
    };
  }, [compareRaceId, selectedCompareMeta]);

  const handleDeleteRace = async (raceId: string) => {
    if (deletingId) return;
    const target = races.find((race) => race.id === raceId);
    const label = target?.trackName || raceId;
    const ok = window.confirm(`Delete race file "${label}"?\nThis action cannot be undone.`);
    if (!ok) return;

    setError(null);
    setDeletingId(raceId);
    try {
      const res = await fetch(`/api/races/${encodeURIComponent(raceId)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`failed to delete race (${res.status})`);

      setRaces((prev) => {
        const next = prev.filter((race) => race.id !== raceId);
        setSelectedId((current) => (current === raceId ? (next[0]?.id ?? null) : current));
        return next;
      });
      setDetail((current) => (current?.id === raceId ? null : current));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'failed to delete race');
    } finally {
      setDeletingId((current) => (current === raceId ? null : current));
    }
  };

  const session = detail?.session ?? {
    sessionType: '',
    totalLaps: 0,
    safetyCar: '',
    weather: '',
    airTemp: 0,
    trackTemp: 0,
  };
  const track = detail?.track ?? { trackId: -1, trackName: '' };
  const player = detail?.player ?? {
    driverIndex: -1,
    name: '',
    teamId: -1,
    finalPosition: 0,
    completedLaps: 0,
    bestLapMs: 0,
    lastLapMs: 0,
    pitStops: 0,
  };
  const highlights = detail?.highlights ?? { notifications: { penalty: 0, warning: 0, info: 0 } };
  const notifications = highlights.notifications ?? { penalty: 0, warning: 0, info: 0 };
  const drivers = detail?.drivers ?? [];

  const replayStart = replayFrames[0]?.timestamp ?? 0;
  const replayEnd = replayFrames[replayFrames.length - 1]?.timestamp ?? replayStart;
  const replayDuration = Math.max(0, replayEnd - replayStart);
  const replayCurrent = Math.max(0, (replayFrames[frameIndex]?.timestamp ?? replayStart) - replayStart);

  return (
    <div className={styles.container}>
      <aside className={styles.listPane}>
        <div className={styles.sectionTitle}>Races</div>
        {loadingList ? (
          <div className={styles.placeholder}>Loading races...</div>
        ) : races.length === 0 ? (
          <div className={styles.placeholder}>No saved races yet</div>
        ) : (
          <div className={styles.list}>
            {races.map((race) => (
              <div
                key={race.id}
                className={`${styles.listItem} ${selectedId === race.id ? styles.listItemActive : ''}`}
              >
                <button
                  type="button"
                  className={styles.listSelectBtn}
                  onClick={() => setSelectedId(race.id)}
                >
                  <div className={styles.listTop}>
                    <span className={styles.track}>{race.trackName || 'Unknown Track'}</span>
                    <span className={styles.pos}>P{race.finalPosition || '-'}</span>
                  </div>
                  <div className={styles.listMeta}>{race.savedAtLocal}</div>
                  <div className={styles.listMeta}>{race.sessionType || 'Unknown Session'}</div>
                  <div className={styles.listMeta}>
                    Size: <span className={styles.fileSize}>{formatFileSize(race.fileSizeBytes)}</span>
                  </div>
                  <div className={styles.listModeRow}>
                    <span className={styles.modeBadge}>{formatStorageMode(race.dataStorageMode)}</span>
                    {(race.hasReplay ?? false) && <span className={styles.replayBadge}>{race.frameCount ?? 0} frames</span>}
                  </div>
                </button>
                <button
                  type="button"
                  className={styles.deleteBtn}
                  onClick={() => { void handleDeleteRace(race.id); }}
                  disabled={deletingId !== null}
                  title={deletingId === race.id ? 'Deleting race file' : 'Delete race file'}
                  aria-label={deletingId === race.id ? 'Deleting race file' : 'Delete race file'}
                >
                  {deletingId === race.id ? (
                    <span className={styles.deleteSpinner} aria-hidden="true" />
                  ) : (
                    <svg
                      className={styles.deleteIcon}
                      viewBox="0 0 24 24"
                      role="img"
                      aria-hidden="true"
                    >
                      <path d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 7h2v8h-2v-8zm4 0h2v8h-2v-8zM8 10h2v8H8v-8zm-1 12a2 2 0 0 1-2-2V8h14v12a2 2 0 0 1-2 2H7z" />
                    </svg>
                  )}
                </button>
              </div>
            ))}
          </div>
        )}
      </aside>

      <section className={styles.detailPane}>
        <div className={styles.sectionTitle}>
          Race Detail
          {selectedIndex >= 0 && races[selectedIndex] && (
            <span className={styles.subtitle}>#{selectedIndex + 1}</span>
          )}
          {detail?.dataStorageMode && (
            <span className={styles.detailMode}>{formatStorageMode(detail.dataStorageMode)}</span>
          )}
        </div>

        {error && <div className={styles.error}>{error}</div>}
        {!error && loadingDetail && <div className={styles.placeholder}>Loading detail...</div>}
        {!error && !loadingDetail && !detail && <div className={styles.placeholder}>Select a race to view details</div>}

        {!error && !loadingDetail && detail && hasReplay && (
          <div className={styles.replayContainer}>
            <div className={styles.timelineControls}>
              <div className={styles.timelinePrimary}>
                <button
                  className={styles.controlBtn}
                  onClick={() => {
                    setPlaying(false);
                    setFrameIndex((prev) => Math.max(0, prev - 1));
                  }}
                  disabled={frameIndex <= 0}
                >
                  {'<'}
                </button>
                <button
                  className={styles.controlBtn}
                  onClick={() => setPlaying((prev) => !prev)}
                  disabled={replayFrames.length <= 1}
                >
                  {playing ? 'Pause' : 'Play'}
                </button>
                <button
                  className={styles.controlBtn}
                  onClick={() => {
                    setPlaying(false);
                    setFrameIndex((prev) => Math.min(replayFrames.length - 1, prev + 1));
                  }}
                  disabled={frameIndex >= replayFrames.length - 1}
                >
                  {'>'}
                </button>
                <select
                  className={styles.rateSelect}
                  value={playbackRate}
                  onChange={(e) => setPlaybackRate(Number(e.target.value))}
                >
                  <option value={0.5}>0.5x</option>
                  <option value={1}>1x</option>
                  <option value={2}>2x</option>
                </select>
              </div>

              <div className={styles.timelineSliderWrap}>
                <input
                  className={styles.timelineSlider}
                  type="range"
                  min={0}
                  max={Math.max(0, replayFrames.length - 1)}
                  value={frameIndex}
                  onChange={(e) => {
                    setPlaying(false);
                    setFrameIndex(Number(e.target.value));
                  }}
                />
                <div className={styles.timelineMeta}>
                  <span>{formatReplayClock(replayCurrent)} / {formatReplayClock(replayDuration)}</span>
                  <span>Frame {frameIndex + 1} / {replayFrames.length}</span>
                </div>
              </div>
            </div>

            {isAdvancedReplay && (
              <div className={styles.replayTabBar}>
                <div className={styles.replayTabs}>
                  <button
                    type="button"
                    className={`${styles.replayTabBtn} ${replayTab === 'pitwall' ? styles.replayTabBtnActive : ''}`}
                    onClick={() => setReplayTab('pitwall')}
                  >
                    Pitwall
                  </button>
                  <button
                    type="button"
                    className={`${styles.replayTabBtn} ${replayTab === 'telemetry' ? styles.replayTabBtnActive : ''}`}
                    onClick={() => setReplayTab('telemetry')}
                  >
                    Telemetry
                  </button>
                </div>

                {replayTab === 'telemetry' && (
                  <div className={styles.compareWrap}>
                    <label className={styles.compareLabel} htmlFor="compare-race-select">
                      Compare File
                    </label>
                    <select
                      id="compare-race-select"
                      className={styles.compareSelect}
                      value={compareRaceId}
                      onChange={(e) => setCompareRaceId(e.target.value)}
                    >
                      <option value="">None</option>
                      {compareOptions.map((race) => (
                        <option key={race.id} value={race.id}>
                          {race.savedAtLocal} - {race.trackName || 'Unknown'}
                        </option>
                      ))}
                    </select>
                    {loadingCompare && <span className={styles.compareHint}>Loading...</span>}
                    {!loadingCompare && compareError && <span className={styles.compareError}>{compareError}</span>}
                    {!loadingCompare && !compareError && selectedCompareMeta && (
                      <span className={styles.compareHint}>
                        {selectedCompareMeta.trackName || 'Unknown'} / {selectedCompareMeta.savedAtLocal}
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className={styles.replayPanel}>
              {!isAdvancedReplay || replayTab === 'pitwall' ? (
                <CommandCenter />
              ) : (
                <TelemetryReplayPanel
                  primarySummary={detail}
                  compareSummary={compareDetail}
                  currentTimeSec={replayCurrent / 1000}
                />
              )}
            </div>
          </div>
        )}

        {!error && !loadingDetail && detail && !hasReplay && (
          <div className={styles.detailContent}>
            <div className={styles.cardGrid}>
              <div className={styles.card}>
                <h4 className={styles.cardTitle}>Overview</h4>
                <div className={styles.kv}><span>Track</span><strong>{track.trackName || '-'}</strong></div>
                <div className={styles.kv}><span>Saved</span><strong>{detail.savedAtLocal}</strong></div>
                <div className={styles.kv}><span>Session</span><strong>{session.sessionType || '-'}</strong></div>
                <div className={styles.kv}><span>Total Laps</span><strong>{session.totalLaps || 0}</strong></div>
                <div className={styles.kv}><span>Weather</span><strong>{session.weather || '-'}</strong></div>
                <div className={styles.kv}><span>Temps</span><strong>{Math.round(session.airTemp || 0)}C / {Math.round(session.trackTemp || 0)}C</strong></div>
              </div>

              <div className={styles.card}>
                <h4 className={styles.cardTitle}>Player Result</h4>
                <div className={styles.kv}><span>Name</span><strong>{player.name || '-'}</strong></div>
                <div className={styles.kv}><span>Position</span><strong>P{player.finalPosition || '-'}</strong></div>
                <div className={styles.kv}><span>Completed Laps</span><strong>{player.completedLaps || 0}</strong></div>
                <div className={styles.kv}><span>Best Lap</span><strong>{formatLap(player.bestLapMs)}</strong></div>
                <div className={styles.kv}><span>Last Lap</span><strong>{formatLap(player.lastLapMs)}</strong></div>
                <div className={styles.kv}><span>Pit Stops</span><strong>{player.pitStops || 0}</strong></div>
              </div>

              <div className={styles.card}>
                <h4 className={styles.cardTitle}>Highlights</h4>
                <div className={styles.kv}><span>Fastest Lap</span><strong>{highlights.fastestLapHolder || '-'}</strong></div>
                <div className={styles.kv}><span>Fastest Time</span><strong>{formatLap(highlights.fastestLapMs ?? 0)}</strong></div>
                <div className={styles.kv}><span>Penalty Msg</span><strong>{notifications.penalty}</strong></div>
                <div className={styles.kv}><span>Warning Msg</span><strong>{notifications.warning}</strong></div>
                <div className={styles.kv}><span>Info Msg</span><strong>{notifications.info}</strong></div>
              </div>
            </div>

            <div className={styles.tableWrap}>
              <h4 className={styles.tableTitle}>All Drivers Summary</h4>
              <div className={styles.tableScroll}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Pos</th>
                      <th>Driver</th>
                      <th>Laps</th>
                      <th>Best</th>
                      <th>Last</th>
                      <th>Pits</th>
                      <th>Tire</th>
                      <th>Age</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drivers.map((driver) => (
                      <tr key={driver.driverIndex}>
                        <td>{driver.position || '-'}</td>
                        <td>{driver.name || '-'}</td>
                        <td>{driver.completedLaps || 0}</td>
                        <td>{formatLap(driver.bestLapMs)}</td>
                        <td>{formatLap(driver.lastLapMs)}</td>
                        <td>{driver.pitStops || 0}</td>
                        <td>{driver.tireCompound || '-'}</td>
                        <td>{driver.tireAge || 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        )}
      </section>
    </div>
  );
}
