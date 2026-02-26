import { useEffect, useMemo, useState } from 'react';
import { CommandCenter } from '../components/command-center/CommandCenter';
import { useTelemetryStore } from '../store/telemetryStore';
import type {
  BattleAlert,
  DataStorageMode,
  RaceControlNotification,
  RaceListItem,
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

export function RacesView() {
  const [races, setRaces] = useState<RaceListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RaceSummary | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);

  const setPlaybackActive = useTelemetryStore((state) => state.setPlaybackActive);
  const applyReplayFrame = useTelemetryStore((state) => state.applyReplayFrame);
  const clearNotifications = useTelemetryStore((state) => state.clearNotifications);

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

    fetch(`/api/races/${encodeURIComponent(selectedId)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`failed to load race detail (${res.status})`);
        return res.json();
      })
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
  }, [selectedId]);

  const replayFrames = useMemo(() => detail?.replay?.frames ?? [], [detail?.replay?.frames]);
  const replayTrackMap = detail?.replay?.trackMap;
  const hasReplay = replayFrames.length > 0;

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
    const mergedPitwall =
      replayTrackMap && !frame.pitwall.trackMap
        ? { ...frame.pitwall, trackMap: replayTrackMap }
        : frame.pitwall;

    applyReplayFrame({
      pitwall: mergedPitwall,
      raceControl: normalizeRaceControlList(frame.raceControl),
      battleAlerts: normalizeBattleAlertList(frame.battleAlerts),
    });
  }, [applyReplayFrame, frameIndex, hasReplay, replayFrames, replayTrackMap]);

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
              <button
                key={race.id}
                className={`${styles.listItem} ${selectedId === race.id ? styles.listItemActive : ''}`}
                onClick={() => setSelectedId(race.id)}
              >
                <div className={styles.listTop}>
                  <span className={styles.track}>{race.trackName || 'Unknown Track'}</span>
                  <span className={styles.pos}>P{race.finalPosition || '-'}</span>
                </div>
                <div className={styles.listMeta}>{race.savedAtLocal}</div>
                <div className={styles.listMeta}>{race.sessionType || 'Unknown Session'}</div>
                <div className={styles.listModeRow}>
                  <span className={styles.modeBadge}>{formatStorageMode(race.dataStorageMode)}</span>
                  {(race.hasReplay ?? false) && <span className={styles.replayBadge}>{race.frameCount ?? 0} frames</span>}
                </div>
              </button>
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

            <div className={styles.replayPanel}>
              <CommandCenter />
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
