import {
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { useTelemetryStore } from '../../store/telemetryStore';
import type {
  DataStorageMode,
  RaceListItem,
  ReplayFrame,
  ReplayStreamMeta,
} from '../../types/telemetry';
import { formatLapTime, formatPosition } from '../../utils/formatters';
import {
  buildReplayMarkers,
  filterRaceArchive,
  formatRaceFileSize,
  formatReplayClock,
  getBehindGap,
  getPlayerDriver,
  loadReplayStream,
  mergeReplayTrackMap,
  type RaceArchiveFilters,
  type ReplayMarker,
} from './replayArchive';
import styles from './RaceArchiveDrawer.module.css';

interface RaceArchiveDrawerProps {
  onClose: () => void;
}

const DEFAULT_FILTERS: RaceArchiveFilters = {
  search: '',
  track: 'all',
  session: 'all',
  storageMode: 'all',
  replayOnly: false,
};

const PLAYBACK_RATES = [0.5, 1, 2, 4];

export function RaceArchiveDrawer({ onClose }: RaceArchiveDrawerProps) {
  const applyReplayFrame = useTelemetryStore((state) => state.applyReplayFrame);
  const setPlaybackActive = useTelemetryStore((state) => state.setPlaybackActive);

  const [races, setRaces] = useState<RaceListItem[]>([]);
  const [filters, setFilters] = useState<RaceArchiveFilters>(DEFAULT_FILTERS);
  const [selectedRaceId, setSelectedRaceId] = useState('');
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState('');
  const [replayLoading, setReplayLoading] = useState(false);
  const [replayError, setReplayError] = useState('');
  const [replayMeta, setReplayMeta] = useState<ReplayStreamMeta | null>(null);
  const [replayFrames, setReplayFrames] = useState<ReplayFrame[]>([]);
  const [replayMarkers, setReplayMarkers] = useState<ReplayMarker[]>([]);
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);

  const deferredSearch = useDeferredValue(filters.search);

  useEffect(() => {
    let cancelled = false;
    setListLoading(true);
    setListError('');

    fetch('/api/races')
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Race archive request failed: ${response.status}`);
        }
        return response.json() as Promise<RaceListItem[]>;
      })
      .then((items) => {
        if (cancelled) {
          return;
        }
        setRaces(Array.isArray(items) ? items : []);
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        setListError(error instanceof Error ? error.message : 'Failed to load race archive.');
      })
      .finally(() => {
        if (!cancelled) {
          setListLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const filteredRaces = useMemo(
    () => filterRaceArchive(races, { ...filters, search: deferredSearch }),
    [deferredSearch, filters, races],
  );

  const trackOptions = useMemo(
    () => Array.from(new Set(races.map((race) => race.trackName).filter(Boolean))).sort(),
    [races],
  );
  const sessionOptions = useMemo(
    () => Array.from(new Set(races.map((race) => race.sessionType).filter(Boolean))).sort(),
    [races],
  );
  const storageModes = useMemo(
    () => Array.from(new Set(races.map((race) => race.dataStorageMode ?? 'resultOnly'))).sort(),
    [races],
  );

  useEffect(() => {
    if (filteredRaces.length === 0) {
      setSelectedRaceId('');
      return;
    }
    if (!filteredRaces.some((race) => race.id === selectedRaceId)) {
      setSelectedRaceId(filteredRaces[0].id);
    }
  }, [filteredRaces, selectedRaceId]);

  const selectedRace = filteredRaces.find((race) => race.id === selectedRaceId) ?? null;

  useEffect(() => {
    setPlaying(false);

    if (!selectedRace?.hasReplay) {
      setReplayMeta(null);
      setReplayFrames([]);
      setReplayMarkers([]);
      setFrameIndex(0);
      setReplayError('');
      setPlaybackActive(false);
      return;
    }

    const controller = new AbortController();
    setReplayLoading(true);
    setReplayError('');

    loadReplayStream(selectedRace.id, controller.signal)
      .then(({ meta, frames }) => {
        const mergedFrames = meta?.trackMap
          ? frames.map((frame) => mergeReplayTrackMap(frame, meta.trackMap))
          : frames;

        setReplayMeta(meta);
        setReplayFrames(mergedFrames);
        setReplayMarkers(buildReplayMarkers(mergedFrames));
        setFrameIndex(0);

        if (mergedFrames[0]) {
          applyReplayFrame({
            pitwall: mergedFrames[0].pitwall,
            raceControl: mergedFrames[0].raceControl,
          });
          setPlaybackActive(true);
        } else {
          setPlaybackActive(false);
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        setReplayMeta(null);
        setReplayFrames([]);
        setReplayMarkers([]);
        setPlaybackActive(false);
        setReplayError(error instanceof Error ? error.message : 'Failed to load replay stream.');
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setReplayLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [applyReplayFrame, selectedRace, setPlaybackActive]);

  useEffect(() => {
    if (replayFrames.length === 0) {
      return;
    }

    const safeIndex = Math.min(frameIndex, replayFrames.length - 1);
    if (safeIndex !== frameIndex) {
      setFrameIndex(safeIndex);
      return;
    }

    const frame = replayFrames[safeIndex];
    applyReplayFrame({
      pitwall: frame.pitwall,
      raceControl: frame.raceControl,
    });
    setPlaybackActive(true);
  }, [applyReplayFrame, frameIndex, replayFrames, setPlaybackActive]);

  useEffect(() => {
    if (!playing || replayFrames.length === 0) {
      return;
    }
    if (frameIndex >= replayFrames.length - 1) {
      setPlaying(false);
      return;
    }

    const baseInterval = replayMeta?.frameIntervalMs ?? 500;
    const timer = window.setTimeout(() => {
      setFrameIndex((current) => Math.min(current + 1, replayFrames.length - 1));
    }, Math.max(baseInterval / playbackRate, 16));

    return () => window.clearTimeout(timer);
  }, [frameIndex, playbackRate, playing, replayFrames.length, replayMeta?.frameIntervalMs]);

  useEffect(() => () => setPlaybackActive(false), [setPlaybackActive]);

  const currentFrame = replayFrames[frameIndex] ?? null;
  const player = currentFrame ? getPlayerDriver(currentFrame) : null;
  const behindGap = currentFrame ? getBehindGap(currentFrame, player) : null;
  const replayStart = replayFrames[0]?.timestamp ?? 0;
  const currentClock = currentFrame ? formatReplayClock(replayStart, currentFrame.timestamp) : '00:00.000';
  const totalClock = replayFrames.length > 0
    ? formatReplayClock(replayStart, replayFrames[replayFrames.length - 1].timestamp)
    : '00:00.000';
  const activeMarkerIds = new Set(
    replayMarkers
      .filter((marker) => Math.abs(marker.frameIndex - frameIndex) <= 6)
      .map((marker) => marker.id),
  );

  function updateFilter<K extends keyof RaceArchiveFilters>(key: K, value: RaceArchiveFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function jumpToMarker(direction: -1 | 1) {
    if (replayMarkers.length === 0) {
      return;
    }

    const candidates = direction < 0
      ? replayMarkers.filter((marker) => marker.frameIndex < frameIndex).sort((a, b) => b.frameIndex - a.frameIndex)
      : replayMarkers.filter((marker) => marker.frameIndex > frameIndex).sort((a, b) => a.frameIndex - b.frameIndex);

    if (candidates[0]) {
      setFrameIndex(candidates[0].frameIndex);
      setPlaying(false);
    }
  }

  function closeArchive() {
    setPlaying(false);
    setPlaybackActive(false);
    onClose();
  }

  return (
    <div className={styles.archive}>
      <section className={styles.hero}>
        <div>
          <span className={styles.eyebrow}>Race Archive</span>
          <h2 className={styles.title}>Replay Drawer</h2>
          <p className={styles.subtitle}>
            Saved races, filters, scrub playback, and SC / penalty / battle markers on top of the cockpit renderer.
          </p>
        </div>
        <div className={styles.heroActions}>
          <button type="button" className={styles.actionButton} onClick={() => window.location.reload()}>
            Refresh
          </button>
          <button type="button" className={styles.closeButton} onClick={closeArchive}>
            Return Live
          </button>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h3>Archive Filters</h3>
          <span>{listLoading ? 'Loading...' : `${filteredRaces.length} visible`}</span>
        </div>
        <div className={styles.filters}>
          <input
            className={styles.searchInput}
            type="search"
            placeholder="Search track, player, date..."
            value={filters.search}
            onChange={(event) => updateFilter('search', event.target.value)}
          />
          <select
            className={styles.select}
            value={filters.track}
            onChange={(event) => updateFilter('track', event.target.value)}
          >
            <option value="all">All Tracks</option>
            {trackOptions.map((track) => (
              <option key={track} value={track}>
                {track}
              </option>
            ))}
          </select>
          <select
            className={styles.select}
            value={filters.session}
            onChange={(event) => updateFilter('session', event.target.value)}
          >
            <option value="all">All Sessions</option>
            {sessionOptions.map((session) => (
              <option key={session} value={session}>
                {session}
              </option>
            ))}
          </select>
          <select
            className={styles.select}
            value={filters.storageMode}
            onChange={(event) => updateFilter('storageMode', event.target.value as RaceArchiveFilters['storageMode'])}
          >
            <option value="all">All Storage Modes</option>
            {storageModes.map((mode) => (
              <option key={mode} value={mode}>
                {formatStorageMode(mode)}
              </option>
            ))}
          </select>
        </div>
        <label className={styles.toggleRow}>
          <input
            type="checkbox"
            checked={filters.replayOnly}
            onChange={(event) => updateFilter('replayOnly', event.target.checked)}
          />
          Replay-ready races only
        </label>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h3>Saved Races</h3>
          <span>{listError ? 'Unavailable' : 'Newest first'}</span>
        </div>
        {listError ? <div className={styles.errorState}>{listError}</div> : null}
        {!listError && filteredRaces.length === 0 ? (
          <div className={styles.emptyState}>No saved races matched the current filters.</div>
        ) : null}
        <div className={styles.raceList}>
          {filteredRaces.map((race) => {
            const selected = race.id === selectedRaceId;
            return (
              <button
                key={race.id}
                type="button"
                className={`${styles.listButton} ${selected ? styles.listButtonActive : ''}`}
                onClick={() => setSelectedRaceId(race.id)}
              >
                <div className={styles.listTop}>
                  <div className={styles.listTitle}>
                    <strong>{race.trackName} · {race.sessionType}</strong>
                    <span className={styles.summaryMeta}>{race.savedAtLocal}</span>
                  </div>
                  <span className={`${styles.chip} ${race.hasReplay ? styles.chipAccent : ''}`}>
                    {race.hasReplay ? `${race.frameCount ?? 0}f` : 'No Replay'}
                  </span>
                </div>
                <div className={styles.listMeta}>
                  <span>{race.playerName}</span>
                  <span>{formatPosition(race.finalPosition)}</span>
                  <span>{formatStorageMode(race.dataStorageMode ?? 'resultOnly')}</span>
                  <span>{formatRaceFileSize(race.fileSizeBytes)}</span>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h3>Replay Viewer</h3>
          <span>{selectedRace ? selectedRace.id : 'No race selected'}</span>
        </div>
        {renderViewer(
          selectedRace,
          replayLoading,
          replayError,
          replayFrames,
          replayMeta,
          replayMarkers,
          frameIndex,
          currentFrame,
          player,
          behindGap,
          currentClock,
          totalClock,
          replayStart,
          playing,
          playbackRate,
          activeMarkerIds,
          setFrameIndex,
          setPlaying,
          setPlaybackRate,
          jumpToMarker,
        )}
      </section>
    </div>
  );
}

function renderViewer(
  selectedRace: RaceListItem | null,
  replayLoading: boolean,
  replayError: string,
  replayFrames: ReplayFrame[],
  replayMeta: ReplayStreamMeta | null,
  replayMarkers: ReplayMarker[],
  frameIndex: number,
  currentFrame: ReplayFrame | null,
  player: ReturnType<typeof getPlayerDriver>,
  behindGap: number | null,
  currentClock: string,
  totalClock: string,
  replayStart: number,
  playing: boolean,
  playbackRate: number,
  activeMarkerIds: Set<string>,
  setFrameIndex: (value: number) => void,
  setPlaying: (value: boolean | ((current: boolean) => boolean)) => void,
  setPlaybackRate: (value: number) => void,
  jumpToMarker: (direction: -1 | 1) => void,
) {
  if (!selectedRace) {
    return <div className={styles.emptyState}>Choose a race to inspect its replay timeline.</div>;
  }

  return (
    <>
      <div className={styles.summaryTop}>
        <div>
          <div className={styles.summaryTitle}>{selectedRace.trackName} · {selectedRace.sessionType}</div>
          <div className={styles.summaryMeta}>
            <span>{selectedRace.playerName}</span>
            <span>{formatPosition(selectedRace.finalPosition)}</span>
            <span>{selectedRace.savedAtLocal}</span>
          </div>
        </div>
        <span className={`${styles.chip} ${selectedRace.hasReplay ? styles.chipAccent : ''}`}>
          {selectedRace.hasReplay ? 'Replay Ready' : 'Summary Only'}
        </span>
      </div>

      <div className={styles.summaryGrid}>
        <article className={styles.statCard}>
          <span className={styles.statLabel}>Storage</span>
          <strong className={styles.statValue}>{formatStorageMode(selectedRace.dataStorageMode ?? 'resultOnly')}</strong>
        </article>
        <article className={styles.statCard}>
          <span className={styles.statLabel}>Frames</span>
          <strong className={styles.statValue}>{selectedRace.frameCount ?? 0}</strong>
        </article>
        <article className={styles.statCard}>
          <span className={styles.statLabel}>File Size</span>
          <strong className={styles.statValue}>{formatRaceFileSize(selectedRace.fileSizeBytes)}</strong>
        </article>
      </div>

      {!selectedRace.hasReplay ? (
        <div className={styles.emptyState}>This archive was stored without replay snapshots.</div>
      ) : replayLoading ? (
        <div className={styles.emptyState}>Streaming replay timeline...</div>
      ) : replayError ? (
        <div className={styles.errorState}>{replayError}</div>
      ) : replayFrames.length === 0 ? (
        <div className={styles.emptyState}>Replay stream contained no frames.</div>
      ) : (
        <>
          <div className={styles.timelineHeader}>
            <span>{currentClock} / {totalClock}</span>
            <span>
              Frame {frameIndex + 1} / {replayFrames.length}
              {replayMeta?.session?.trackName ? ` · ${replayMeta.session.trackName}` : ''}
            </span>
          </div>

          <div className={styles.timelineRailWrap}>
            <div className={styles.markerRail}>
              {replayMarkers.map((marker) => (
                <button
                  key={marker.id}
                  type="button"
                  className={`${styles.markerDot} ${getMarkerClass(marker.type)}`}
                  style={{ left: `${(marker.frameIndex / Math.max(replayFrames.length - 1, 1)) * 100}%` }}
                  onClick={() => {
                    setFrameIndex(marker.frameIndex);
                    setPlaying(false);
                  }}
                  title={`${marker.label}${marker.detail ? ` · ${marker.detail}` : ''}`}
                />
              ))}
            </div>
            <input
              className={styles.timelineInput}
              type="range"
              min={0}
              max={Math.max(replayFrames.length - 1, 0)}
              value={frameIndex}
              onChange={(event) => {
                setFrameIndex(Number(event.target.value));
                setPlaying(false);
              }}
            />
          </div>

          <div className={styles.controls}>
            <button type="button" className={styles.markerButton} onClick={() => jumpToMarker(-1)}>
              Prev Marker
            </button>
            <button
              type="button"
              className={styles.markerButton}
              onClick={() => {
                if (frameIndex >= replayFrames.length - 1) {
                  setFrameIndex(0);
                }
                setPlaying((current) => !current);
              }}
            >
              {playing ? 'Pause' : 'Play'}
            </button>
            <button type="button" className={styles.markerButton} onClick={() => jumpToMarker(1)}>
              Next Marker
            </button>
            {PLAYBACK_RATES.map((rate) => (
              <button
                key={rate}
                type="button"
                className={`${styles.speedButton} ${playbackRate === rate ? styles.speedButtonActive : ''}`}
                onClick={() => setPlaybackRate(rate)}
              >
                {rate}x
              </button>
            ))}
          </div>

          <div className={styles.frameStats}>
            <article className={styles.statCard}>
              <span className={styles.label}>Position</span>
              <strong className={styles.statValue}>{formatPosition(player?.position ?? 0)}</strong>
            </article>
            <article className={styles.statCard}>
              <span className={styles.label}>Lap</span>
              <strong className={styles.statValue}>{player?.currentLapNum ?? '--'}</strong>
            </article>
            <article className={styles.statCard}>
              <span className={styles.label}>Speed</span>
              <strong className={styles.statValue}>{player ? `${Math.round(player.speed)} km/h` : '--'}</strong>
            </article>
            <article className={styles.statCard}>
              <span className={styles.label}>Safety Car</span>
              <strong className={styles.statValue}>{formatSafetyCar(currentFrame?.pitwall.session?.safetyCar)}</strong>
            </article>
            <article className={styles.statCard}>
              <span className={styles.label}>Gap Ahead</span>
              <strong className={styles.statValue}>{formatGap(player?.deltaToCarInFront)}</strong>
            </article>
            <article className={styles.statCard}>
              <span className={styles.label}>Gap Behind</span>
              <strong className={styles.statValue}>{formatGap(behindGap)}</strong>
            </article>
            <article className={styles.statCard}>
              <span className={styles.label}>Best Lap</span>
              <strong className={styles.statValue}>{player ? formatLapTime(player.bestLapTime) : '--:--.---'}</strong>
            </article>
            <article className={styles.statCard}>
              <span className={styles.label}>Weather</span>
              <strong className={styles.statValue}>{currentFrame?.pitwall.session?.weather ?? '--'}</strong>
            </article>
          </div>

          <div className={styles.sectionHeader}>
            <h3>Markers</h3>
            <span>{replayMarkers.length} captured</span>
          </div>
          <div className={styles.markers}>
            {replayMarkers.length === 0 ? (
              <div className={styles.emptyState}>No SC, penalty, or battle markers were detected.</div>
            ) : (
              replayMarkers.map((marker) => (
                <button
                  key={marker.id}
                  type="button"
                  className={styles.markerButton}
                  onClick={() => {
                    setFrameIndex(marker.frameIndex);
                    setPlaying(false);
                  }}
                >
                  <span className={styles.markerCopy}>
                    <strong>{marker.label}</strong>
                    <span className={styles.summaryMeta}>{marker.detail ?? 'Marker jump'}</span>
                  </span>
                  <span className={styles.markerMeta}>
                    {formatReplayClock(replayStart, marker.timestamp)}
                    {activeMarkerIds.has(marker.id) ? ' · Now' : ''}
                  </span>
                </button>
              ))
            )}
          </div>
        </>
      )}
    </>
  );
}

function formatStorageMode(mode: DataStorageMode): string {
  if (mode === 'advanced') {
    return 'Advanced';
  }
  if (mode === 'summary') {
    return 'Summary';
  }
  return 'Result Only';
}

function formatSafetyCar(value?: string): string {
  if (!value || value === 'none') {
    return 'Green';
  }
  if (value === 'full') {
    return 'SC';
  }
  if (value === 'virtual') {
    return 'VSC';
  }
  if (value === 'virtual_ending' || value === 'virtual_standing') {
    return 'VSC End';
  }
  return value;
}

function formatGap(value?: number | null): string {
  if (!value || value <= 0) {
    return '--';
  }
  return `+${(value / 1000).toFixed(3)}s`;
}

function getMarkerClass(type: ReplayMarker['type']): string {
  if (type === 'penalty') {
    return styles.markerDotPenalty;
  }
  if (type === 'battle') {
    return styles.markerDotBattle;
  }
  return styles.markerDotSafety;
}
