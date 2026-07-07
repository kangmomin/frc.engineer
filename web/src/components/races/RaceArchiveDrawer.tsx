import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { useTelemetryStore } from '../../store/telemetryStore';
import type {
  DataStorageMode,
  RaceListItem,
  RaceSummary,
  ReplayFrame,
  ReplayStreamMeta,
} from '../../types/telemetry';
import { formatLapTime, formatPosition } from '../../utils/formatters';
import { PostRaceDebrief } from '../debrief/PostRaceDebrief';
import {
  buildReplayMarkers,
  filterRaceArchive,
  formatRaceFileSize,
  formatReplayClock,
  getBehindGap,
  getPlayerDriver,
  loadRaceArchiveList,
  loadRaceSummary,
  loadReplayStream,
  mergeReplayTrackMap,
  resolveRaceArchiveOpenMode,
  type RaceArchiveDataSource,
  type RaceArchiveFilters,
  type RaceArchiveOpenMode,
  type ReplayMarker,
} from './replayArchive';
import styles from './RaceArchiveDrawer.module.css';

interface RaceArchiveDrawerProps {
  onClose: () => void;
  dataSource?: RaceArchiveDataSource;
}

const DEFAULT_FILTERS: RaceArchiveFilters = {
  search: '',
  track: 'all',
  session: 'all',
  storageMode: 'all',
  replayOnly: false,
};

const PLAYBACK_RATES = [0.5, 1, 2, 4];
const REPLAY_CHROME_IDLE_MS = 2600;

const httpRaceArchiveDataSource: RaceArchiveDataSource = {
  listRaces: loadRaceArchiveList,
  loadSummary: loadRaceSummary,
  loadReplay: loadReplayStream,
};

export function RaceArchiveDrawer({ onClose, dataSource }: RaceArchiveDrawerProps) {
  const applyReplayFrame = useTelemetryStore((state) => state.applyReplayFrame);
  const setPlaybackActive = useTelemetryStore((state) => state.setPlaybackActive);
  const source = dataSource ?? httpRaceArchiveDataSource;

  const [races, setRaces] = useState<RaceListItem[]>([]);
  const [filters, setFilters] = useState<RaceArchiveFilters>(DEFAULT_FILTERS);
  const [selectedRaceId, setSelectedRaceId] = useState('');
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState('');
  const [browserOpen, setBrowserOpen] = useState(true);
  const [activeMode, setActiveMode] = useState<RaceArchiveOpenMode | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState('');
  const [selectedSummary, setSelectedSummary] = useState<RaceSummary | null>(null);
  const [replayLoading, setReplayLoading] = useState(false);
  const [replayError, setReplayError] = useState('');
  const [replayMeta, setReplayMeta] = useState<ReplayStreamMeta | null>(null);
  const [replayFrames, setReplayFrames] = useState<ReplayFrame[]>([]);
  const [replayMarkers, setReplayMarkers] = useState<ReplayMarker[]>([]);
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [replayChromeVisible, setReplayChromeVisible] = useState(true);
  const replayChromeHideTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);

  const deferredSearch = useDeferredValue(filters.search);

  const clearReplayChromeHideTimer = useCallback(() => {
    if (replayChromeHideTimerRef.current) {
      window.clearTimeout(replayChromeHideTimerRef.current);
      replayChromeHideTimerRef.current = null;
    }
  }, []);

  const showReplayChrome = useCallback(() => {
    setReplayChromeVisible(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setListLoading(true);
    setListError('');

    source.listRaces(controller.signal)
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
      controller.abort();
    };
  }, [source]);

  const filteredRaces = useMemo(
    () => filterRaceArchive(races, { ...filters, search: deferredSearch }),
    [deferredSearch, filters, races],
  );

  const selectedRace = useMemo(
    () => races.find((race) => race.id === selectedRaceId) ?? null,
    [races, selectedRaceId],
  );

  const trackOptions = useMemo(
    () => Array.from(new Set(races.map((race) => race.trackName).filter(Boolean))).sort(),
    [races],
  );
  const sessionOptions = useMemo(
    () => Array.from(new Set(races.map((race) => race.sessionType).filter(Boolean))).sort(),
    [races],
  );
  const storageModes = useMemo<DataStorageMode[]>(
    () => Array.from(new Set(races.map((race) => race.dataStorageMode ?? 'resultOnly'))).sort() as DataStorageMode[],
    [races],
  );

  useEffect(() => {
    if (races.length === 0) {
      setSelectedRaceId('');
      setActiveMode(null);
      return;
    }
    if (selectedRaceId && races.some((race) => race.id === selectedRaceId)) {
      return;
    }
    const nextRace = filteredRaces[0] ?? races[0];
    if (nextRace) {
      setSelectedRaceId(nextRace.id);
    }
  }, [filteredRaces, races, selectedRaceId]);

  useEffect(() => {
    if (selectedRaceId && !selectedRace) {
      setActiveMode(null);
      setSelectedSummary(null);
      setSummaryError('');
      setReplayMeta(null);
      setReplayFrames([]);
      setReplayMarkers([]);
      setFrameIndex(0);
      setPlaybackActive(false);
    }
  }, [selectedRace, selectedRaceId, setPlaybackActive]);

  useEffect(() => {
    if (!selectedRace || !activeMode || activeMode === 'replay') {
      setSummaryLoading(false);
      setSummaryError('');
      setSelectedSummary(null);
      return;
    }

    const controller = new AbortController();
    setSummaryLoading(true);
    setSummaryError('');
    setSelectedSummary(null);

    source.loadSummary(selectedRace.id, controller.signal)
      .then((summary) => {
        setSelectedSummary(summary);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        setSummaryError(error instanceof Error ? error.message : 'Failed to load race summary.');
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setSummaryLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [activeMode, selectedRace, source]);

  useEffect(() => {
    setPlaying(false);

    if (activeMode !== 'replay' || !selectedRace?.hasReplay) {
      setReplayLoading(false);
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

    source.loadReplay(selectedRace.id, controller.signal)
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
  }, [activeMode, applyReplayFrame, selectedRace, setPlaybackActive, source]);

  useEffect(() => {
    if (replayFrames.length === 0 || activeMode !== 'replay') {
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
  }, [activeMode, applyReplayFrame, frameIndex, replayFrames, setPlaybackActive]);

  useEffect(() => {
    if (!playing || replayFrames.length === 0 || activeMode !== 'replay') {
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
  }, [activeMode, frameIndex, playbackRate, playing, replayFrames.length, replayMeta?.frameIntervalMs]);

  useEffect(() => () => setPlaybackActive(false), [setPlaybackActive]);

  useEffect(() => () => clearReplayChromeHideTimer(), [clearReplayChromeHideTimer]);

  const canAutoHideReplayChrome = activeMode === 'replay'
    && !browserOpen
    && !replayLoading
    && !replayError
    && replayFrames.length > 0;

  useEffect(() => {
    clearReplayChromeHideTimer();

    if (!canAutoHideReplayChrome) {
      setReplayChromeVisible(true);
      return;
    }

    replayChromeHideTimerRef.current = window.setTimeout(() => {
      setReplayChromeVisible(false);
    }, REPLAY_CHROME_IDLE_MS);

    return () => clearReplayChromeHideTimer();
  }, [canAutoHideReplayChrome, clearReplayChromeHideTimer]);

  useEffect(() => {
    if (activeMode !== 'replay') {
      setReplayChromeVisible(true);
      return;
    }

    const revealReplayChrome = () => {
      setReplayChromeVisible(true);
      clearReplayChromeHideTimer();

      if (!canAutoHideReplayChrome) {
        return;
      }

      replayChromeHideTimerRef.current = window.setTimeout(() => {
        setReplayChromeVisible(false);
      }, REPLAY_CHROME_IDLE_MS);
    };

    revealReplayChrome();

    window.addEventListener('mousemove', revealReplayChrome);
    window.addEventListener('mousedown', revealReplayChrome);
    window.addEventListener('touchstart', revealReplayChrome, { passive: true });
    window.addEventListener('keydown', revealReplayChrome);

    return () => {
      window.removeEventListener('mousemove', revealReplayChrome);
      window.removeEventListener('mousedown', revealReplayChrome);
      window.removeEventListener('touchstart', revealReplayChrome);
      window.removeEventListener('keydown', revealReplayChrome);
    };
  }, [activeMode, canAutoHideReplayChrome, clearReplayChromeHideTimer]);

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

  function openRace(race: RaceListItem) {
    setSelectedRaceId(race.id);
    setSummaryError('');
    setSelectedSummary(null);
    const nextMode = resolveRaceArchiveOpenMode(race);
    setActiveMode(nextMode);
    setBrowserOpen(nextMode !== 'replay');
    if (nextMode !== 'replay') {
      setPlaying(false);
      setPlaybackActive(false);
    }
  }

  function closeSummaryModal() {
    setActiveMode(null);
    setSummaryLoading(false);
    setSummaryError('');
    setSelectedSummary(null);
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
    setActiveMode(null);
    setBrowserOpen(true);
    setSummaryLoading(false);
    setSummaryError('');
    setSelectedSummary(null);
    setPlaybackActive(false);
    onClose();
  }

  return (
    <>
      <div className={styles.overlay}>
        {activeMode === 'replay' ? (
          <ReplayStage
            selectedRace={selectedRace}
            replayLoading={replayLoading}
            replayError={replayError}
            replayFrames={replayFrames}
            replayMeta={replayMeta}
            replayMarkers={replayMarkers}
            frameIndex={frameIndex}
            currentFrame={currentFrame}
            player={player}
            behindGap={behindGap}
            currentClock={currentClock}
            totalClock={totalClock}
            replayStart={replayStart}
            playing={playing}
            playbackRate={playbackRate}
            activeMarkerIds={activeMarkerIds}
            browserOpen={browserOpen}
            replayChromeVisible={replayChromeVisible}
            onOpenArchive={() => setBrowserOpen(true)}
            onShowChrome={showReplayChrome}
            onHideChrome={() => {
              clearReplayChromeHideTimer();
              setReplayChromeVisible(false);
            }}
            onClose={closeArchive}
            setFrameIndex={setFrameIndex}
            setPlaying={setPlaying}
            setPlaybackRate={setPlaybackRate}
            jumpToMarker={jumpToMarker}
          />
        ) : null}

        {browserOpen ? (
          <ArchiveBrowser
            filteredRaces={filteredRaces}
            listError={listError}
            listLoading={listLoading}
            trackOptions={trackOptions}
            sessionOptions={sessionOptions}
            storageModes={storageModes}
            filters={filters}
            selectedRaceId={selectedRaceId}
            updateFilter={updateFilter}
            openRace={openRace}
            replayActive={activeMode === 'replay'}
            onResumeReplay={() => setBrowserOpen(false)}
            onClose={closeArchive}
          />
        ) : null}

        {activeMode !== 'replay' && summaryLoading ? (
          <ModalMessage
            title={activeMode === 'summary' ? 'Loading saved summary...' : 'Loading saved result...'}
            copy={selectedRace ? `${selectedRace.trackName} · ${selectedRace.sessionType}` : 'Loading archive details.'}
          />
        ) : null}

        {activeMode !== 'replay' && summaryError ? (
          <ModalMessage
            title="Archive details unavailable"
            copy={summaryError}
            tone="error"
            actions={(
              <>
                {selectedRace ? (
                  <button type="button" className={styles.markerButton} onClick={() => openRace(selectedRace)}>
                    Retry
                  </button>
                ) : null}
                <button type="button" className={styles.closeButton} onClick={closeSummaryModal}>
                  Back To Archive
                </button>
              </>
            )}
          />
        ) : null}
      </div>

      {selectedSummary && activeMode && activeMode !== 'replay' ? (
        <PostRaceDebrief
          result={selectedSummary}
          onClose={closeSummaryModal}
          eyebrow={activeMode === 'summary' ? 'Saved Summary' : 'Saved Result'}
          closeLabel="Back To Archive"
        />
      ) : null}
    </>
  );
}

interface ArchiveBrowserProps {
  filteredRaces: RaceListItem[];
  listError: string;
  listLoading: boolean;
  trackOptions: string[];
  sessionOptions: string[];
  storageModes: DataStorageMode[];
  filters: RaceArchiveFilters;
  selectedRaceId: string;
  updateFilter: <K extends keyof RaceArchiveFilters>(key: K, value: RaceArchiveFilters[K]) => void;
  openRace: (race: RaceListItem) => void;
  replayActive: boolean;
  onResumeReplay: () => void;
  onClose: () => void;
}

function ArchiveBrowser({
  filteredRaces,
  listError,
  listLoading,
  trackOptions,
  sessionOptions,
  storageModes,
  filters,
  selectedRaceId,
  updateFilter,
  openRace,
  replayActive,
  onResumeReplay,
  onClose,
}: ArchiveBrowserProps) {
  return (
    <aside className={styles.browserPanel}>
      <div className={styles.archive}>
        <section className={styles.hero}>
          <div>
            <span className={styles.eyebrow}>Race Archive</span>
            <h2 className={styles.title}>Replay Browser</h2>
            <p className={styles.subtitle}>
              Result-only saves open a result modal, summary saves open a debrief modal, and advanced saves open full replay mode.
            </p>
          </div>
          <div className={styles.heroActions}>
            {replayActive ? (
              <button type="button" className={styles.actionButton} onClick={onResumeReplay}>
                Resume Replay
              </button>
            ) : null}
            <button type="button" className={styles.actionButton} onClick={() => window.location.reload()}>
              Refresh
            </button>
            <button type="button" className={styles.closeButton} onClick={onClose}>
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
            <span>{listError ? 'Unavailable' : 'Tap to open'}</span>
          </div>
          {listError ? <div className={styles.errorState}>{listError}</div> : null}
          {!listError && filteredRaces.length === 0 ? (
            <div className={styles.emptyState}>No saved races matched the current filters.</div>
          ) : null}
          <div className={styles.raceList}>
            {filteredRaces.map((race) => {
              const selected = race.id === selectedRaceId;
              const openMode = resolveRaceArchiveOpenMode(race);
              return (
                <button
                  key={race.id}
                  type="button"
                  className={`${styles.listButton} ${selected ? styles.listButtonActive : ''}`}
                  onClick={() => openRace(race)}
                >
                  <div className={styles.listTop}>
                    <div className={styles.listTitle}>
                      <strong>{race.trackName} · {race.sessionType}</strong>
                      <span className={styles.summaryMeta}>{race.savedAtLocal}</span>
                    </div>
                    <div className={styles.listChips}>
                      <span className={`${styles.chip} ${race.hasReplay ? styles.chipAccent : ''}`}>
                        {race.hasReplay ? `${race.frameCount ?? 0}f` : 'No Replay'}
                      </span>
                      <span className={`${styles.chip} ${getOpenModeClass(openMode)}`}>
                        {formatOpenMode(openMode)}
                      </span>
                    </div>
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
      </div>
    </aside>
  );
}

interface ReplayStageProps {
  selectedRace: RaceListItem | null;
  replayLoading: boolean;
  replayError: string;
  replayFrames: ReplayFrame[];
  replayMeta: ReplayStreamMeta | null;
  replayMarkers: ReplayMarker[];
  frameIndex: number;
  currentFrame: ReplayFrame | null;
  player: ReturnType<typeof getPlayerDriver>;
  behindGap: number | null;
  currentClock: string;
  totalClock: string;
  replayStart: number;
  playing: boolean;
  playbackRate: number;
  activeMarkerIds: Set<string>;
  browserOpen: boolean;
  replayChromeVisible: boolean;
  onOpenArchive: () => void;
  onShowChrome: () => void;
  onHideChrome: () => void;
  onClose: () => void;
  setFrameIndex: (value: number | ((current: number) => number)) => void;
  setPlaying: (value: boolean | ((current: boolean) => boolean)) => void;
  setPlaybackRate: (value: number) => void;
  jumpToMarker: (direction: -1 | 1) => void;
}

function ReplayStage({
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
  browserOpen,
  replayChromeVisible,
  onOpenArchive,
  onShowChrome,
  onHideChrome,
  onClose,
  setFrameIndex,
  setPlaying,
  setPlaybackRate,
  jumpToMarker,
}: ReplayStageProps) {
  return (
    <>
      {!replayChromeVisible ? (
        <button
          type="button"
          className={styles.replayPeekButton}
          onClick={onShowChrome}
        >
          Show Replay HUD
        </button>
      ) : null}

      <section className={`${styles.replayHero} ${!replayChromeVisible ? styles.replayChromeHidden : ''}`}>
        <div>
          <span className={styles.eyebrow}>Full Replay</span>
          <h2 className={styles.title}>{selectedRace ? `${selectedRace.trackName} · ${selectedRace.sessionType}` : 'Replay'}</h2>
          <div className={styles.summaryMeta}>
            <span>{selectedRace?.playerName ?? 'Driver'}</span>
            <span>{selectedRace ? formatPosition(selectedRace.finalPosition) : '--'}</span>
            <span>{selectedRace?.savedAtLocal ?? '--'}</span>
            {browserOpen ? <span>Archive open</span> : null}
          </div>
        </div>
        <div className={styles.heroActions}>
          {!browserOpen ? (
            <button type="button" className={styles.actionButton} onClick={onHideChrome}>
              Hide HUD
            </button>
          ) : null}
          <button type="button" className={styles.actionButton} onClick={onOpenArchive}>
            Archive
          </button>
          <button type="button" className={styles.closeButton} onClick={onClose}>
            Return Live
          </button>
        </div>
      </section>

      <section className={`${styles.replayHud} ${!replayChromeVisible ? styles.replayChromeHidden : ''}`}>
        {!selectedRace ? (
          <div className={styles.emptyState}>Select an advanced archive to enter full replay mode.</div>
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
                <strong className={styles.statValue}>{player ? `${Math.round(player.speed ?? 0)} km/h` : '--'}</strong>
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
      </section>
    </>
  );
}

interface ModalMessageProps {
  title: string;
  copy: string;
  tone?: 'default' | 'error';
  actions?: ReactNode;
}

function ModalMessage({ title, copy, tone = 'default', actions }: ModalMessageProps) {
  return (
    <div className={styles.modalShell}>
      <section className={`${styles.modalCard} ${tone === 'error' ? styles.modalCardError : ''}`}>
        <span className={styles.eyebrow}>Archive Detail</span>
        <h3 className={styles.modalTitle}>{title}</h3>
        <p className={styles.subtitle}>{copy}</p>
        {actions ? <div className={styles.modalActions}>{actions}</div> : null}
      </section>
    </div>
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

function formatOpenMode(mode: RaceArchiveOpenMode): string {
  if (mode === 'replay') {
    return 'Replay';
  }
  if (mode === 'summary') {
    return 'Summary';
  }
  return 'Result';
}

function getOpenModeClass(mode: RaceArchiveOpenMode): string {
  if (mode === 'replay') {
    return styles.chipReplay;
  }
  if (mode === 'summary') {
    return styles.chipSummary;
  }
  return styles.chipResult;
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
