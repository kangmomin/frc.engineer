import { useEffect, useMemo, type CSSProperties } from 'react';
import { getTyreColor } from '../../constants/tyreCompounds';
import { resolveSummarySchema } from '../../types/telemetry';
import type { RaceControlNotification, RaceSummary } from '../../types/telemetry';
import { formatLapTime, formatPosition } from '../../utils/formatters';
import styles from './PostRaceDebrief.module.css';

interface PostRaceDebriefProps {
  result: RaceSummary;
  onClose: () => void;
  eyebrow?: string;
  closeLabel?: string;
}

function formatGap(position: number, gapToWinnerMs?: number): string {
  if (position === 1) {
    return 'Winner';
  }
  if (!gapToWinnerMs) {
    return '--';
  }
  return `+${(gapToWinnerMs / 1000).toFixed(3)}s`;
}

function formatLoss(ms?: number): string {
  if (!ms) {
    return '--';
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatWear(value?: number): string {
  if (typeof value !== 'number') {
    return '--';
  }
  return `${value}%`;
}

function formatTemperature(value?: number): string {
  if (typeof value !== 'number') {
    return '--';
  }
  return `${Math.round(value)}°C`;
}

function formatLapCount(value?: number): string {
  if (typeof value !== 'number') {
    return '--';
  }
  return `${value} laps`;
}

function formatSector(ms: number): string {
  if (!ms) {
    return '--';
  }
  return (ms / 1000).toFixed(3);
}

function formatStintRange(startLap?: number, endLap?: number): string {
  if (!startLap || !endLap) {
    return '';
  }
  return `L${startLap}–${endLap} · `;
}

function formatTimestamp(timestamp: number): string {
  if (!timestamp) {
    return '--:--:--';
  }
  return new Intl.DateTimeFormat('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(timestamp));
}

function getTimelineTone(notification: RaceControlNotification): string {
  if (notification.severity === 'critical') {
    return styles.timelineCritical;
  }
  if (notification.category === 'warning' || notification.severity === 'warning') {
    return styles.timelineWarning;
  }
  return styles.timelineInfo;
}

export function PostRaceDebrief({
  result,
  onClose,
  eyebrow = 'Post-Race Debrief',
  closeLabel = 'Return To Live',
}: PostRaceDebriefProps) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const sortedDrivers = useMemo(
    () => [...result.drivers].sort((a, b) => a.position - b.position),
    [result.drivers],
  );
  const leaders = sortedDrivers.slice(0, 5);
  // Rich sections render only for versioned (schemaVersion>=1) summaries that carry a
  // detail block. Legacy (v0) summaries lack detail and fall through unchanged; an
  // unknown-future version still renders the fields it recognises here.
  const schema = resolveSummarySchema(result);
  const detail = result.detail;
  const showRich = schema !== 'legacy' && !!detail;
  const lapTimings = detail?.laps ?? [];
  const dynamics = detail?.dynamics ?? [];
  const issues = detail?.events ?? [];
  const stints = result.player.stints ?? [];
  const lastStint = stints.length > 0 ? stints[stints.length - 1] : undefined;
  const totalStintLaps = stints.reduce((sum, stint) => sum + stint.laps, 0);
  const timeline = result.debrief?.timeline ?? [];
  const playerPosition = result.player.finalPosition;
  const playerName = result.player.name || 'Driver';
  const notificationTotals = result.highlights.notifications;
  const winnerName = result.debrief?.winnerName || leaders[0]?.name || '--';
  const fastestLapLabel = result.debrief?.fastestLapDeltaMs
    ? formatLoss(result.debrief.fastestLapDeltaMs)
    : (result.player.bestLapMs > 0 && result.player.bestLapMs === (result.highlights.fastestLapMs ?? 0) ? 'Session Best' : '--');

  return (
    <div className={styles.overlay}>
      <button
        type="button"
        className={styles.backdrop}
        onClick={onClose}
        aria-label="Close post-race debrief"
      />
      <section className={styles.panel} role="dialog" aria-modal="true" aria-labelledby="post-race-debrief-title">
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>{eyebrow}</p>
            <h2 id="post-race-debrief-title" className={styles.title}>
              {formatPosition(playerPosition)} · {playerName}
            </h2>
            <p className={styles.subtitle}>
              {result.track.trackName || 'Unknown Track'} · {result.session.sessionType || 'Race'} · Saved {result.savedAtLocal}
            </p>
          </div>
          <div className={styles.headerActions}>
            <div className={styles.notificationStrip}>
              <span>{notificationTotals.penalty} penalties</span>
              <span>{notificationTotals.warning} warnings</span>
              <span>{notificationTotals.info} race control</span>
            </div>
            <button type="button" className={styles.closeButton} onClick={onClose}>
              {closeLabel}
            </button>
          </div>
        </header>

        <div className={styles.heroGrid}>
          <article className={styles.heroCard}>
            <span className={styles.cardLabel}>Best Lap</span>
            <strong className={styles.heroValue}>{formatLapTime(result.player.bestLapMs)}</strong>
            <span className={styles.cardMeta}>
              Overall fastest: {formatLapTime(result.highlights.fastestLapMs ?? 0)}
            </span>
          </article>
          <article className={styles.heroCard}>
            <span className={styles.cardLabel}>Gap To Winner</span>
            <strong className={styles.heroValue}>{formatGap(playerPosition, result.debrief?.gapToWinnerMs)}</strong>
            <span className={styles.cardMeta}>
              Winner: {winnerName}
            </span>
          </article>
          <article className={styles.heroCard}>
            <span className={styles.cardLabel}>Fastest Lap Delta</span>
            <strong className={styles.heroValue}>{fastestLapLabel}</strong>
            <span className={styles.cardMeta}>To session benchmark</span>
          </article>
          <article className={styles.heroCard}>
            <span className={styles.cardLabel}>Pit Loss</span>
            <strong className={styles.heroValue}>{formatLoss(result.debrief?.pit.estimatedTimeLostMs)}</strong>
            <span className={styles.cardMeta}>
              {result.debrief?.pit.stops ?? result.player.pitStops} stop{(result.debrief?.pit.stops ?? result.player.pitStops) === 1 ? '' : 's'}
            </span>
          </article>
        </div>

        <div className={styles.metaRow}>
          {result.gameFormat ? <div className={styles.metaPill}>{result.gameFormat}</div> : null}
          <div className={styles.metaPill}>Classified {result.debrief?.classifiedDrivers ?? result.drivers.length}</div>
          <div className={styles.metaPill}>Weather {result.session.weather || '--'}</div>
          <div className={styles.metaPill}>Track {formatTemperature(result.session.trackTemp)}</div>
          <div className={styles.metaPill}>Air {formatTemperature(result.session.airTemp)}</div>
          <div className={styles.metaPill}>Safety Car {result.session.safetyCar || '--'}</div>
        </div>

        <div className={styles.contentGrid}>
          <div className={styles.primaryColumn}>
            <section className={styles.sectionCard}>
              <div className={styles.sectionHeader}>
                <h3>Classification Snapshot</h3>
                <span>Top 5 finishers</span>
              </div>
              <div className={styles.leaderboard}>
                {leaders.map((driver) => (
                  <div
                    key={`${driver.driverIndex}-${driver.position}`}
                    className={`${styles.driverRow} ${driver.driverIndex === result.player.driverIndex ? styles.driverRowActive : ''}`}
                  >
                    <div className={styles.driverIdentity}>
                      <span className={styles.driverPosition}>{formatPosition(driver.position)}</span>
                      <div>
                        <strong>{driver.name || 'Unknown Driver'}</strong>
                        <span>{driver.completedLaps} laps completed</span>
                      </div>
                    </div>
                    <div className={styles.driverMetrics}>
                      <span>{formatLapTime(driver.bestLapMs)}</span>
                      <span>{driver.pitStops} pit</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className={styles.sectionCard}>
              <div className={styles.sectionHeader}>
                <h3>Race Timeline</h3>
                <span>{timeline.length} captured events</span>
              </div>
              {timeline.length > 0 ? (
                <div className={styles.timeline}>
                  {timeline.map((entry) => (
                    <article key={entry.id} className={`${styles.timelineEntry} ${getTimelineTone(entry)}`}>
                      <div className={styles.timelineStamp}>
                        <span>{formatTimestamp(entry.timestamp)}</span>
                        <small>{entry.category}</small>
                      </div>
                      <div className={styles.timelineBody}>
                        <strong>{entry.driverName || entry.category.toUpperCase()}</strong>
                        <p>{entry.message}</p>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p className={styles.emptyState}>No race control timeline was captured for this finish.</p>
              )}
            </section>
          </div>

          <div className={styles.sideColumn}>
            <section className={styles.sectionCard}>
              <div className={styles.sectionHeader}>
                <h3>Stints</h3>
                <span>{totalStintLaps || result.player.completedLaps} laps</span>
              </div>
              {stints.length > 0 ? (
                <div className={styles.stints}>
                  <div className={styles.stintBar}>
                    {stints.map((stint, index) => (
                      <div
                        key={`${stint.compound}-${index}`}
                        className={styles.stintSegment}
                        style={{
                          flex: Math.max(stint.laps, 1),
                          '--stint-color': getTyreColor(stint.compound),
                        } as CSSProperties}
                      />
                    ))}
                  </div>
                  <div className={styles.stintLegend}>
                    {stints.map((stint, index) => (
                      <div key={`${stint.compound}-legend-${index}`} className={styles.stintLegendItem}>
                        <span
                          className={styles.stintSwatch}
                          style={{ backgroundColor: getTyreColor(stint.compound) }}
                        />
                        <strong>{stint.compound}</strong>
                        <span>
                          {formatStintRange(stint.startLap, stint.endLap)}
                          {stint.laps} laps
                          {typeof stint.tireWearPct === 'number' ? ` · ${stint.tireWearPct}% wear` : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className={styles.emptyState}>Stint history is not available for this race result.</p>
              )}
            </section>

            <section className={styles.sectionCard}>
              <div className={styles.sectionHeader}>
                <h3>Penalty Summary</h3>
                <span>Player only</span>
              </div>
              <dl className={styles.detailList}>
                <div>
                  <dt>Time penalties</dt>
                  <dd>{result.debrief?.penalties.timePenaltySeconds ? `+${result.debrief.penalties.timePenaltySeconds}s` : 'Clear'}</dd>
                </div>
                <div>
                  <dt>Warnings</dt>
                  <dd>{result.debrief?.penalties.warnings ?? 0}</dd>
                </div>
                <div>
                  <dt>Corner cuts</dt>
                  <dd>{result.debrief?.penalties.cornerCutWarnings ?? 0}</dd>
                </div>
                <div>
                  <dt>Unserved penalties</dt>
                  <dd>{(result.debrief?.penalties.unservedDriveThrough ?? 0) + (result.debrief?.penalties.unservedStopGo ?? 0)}</dd>
                </div>
              </dl>
            </section>

            <section className={styles.sectionCard}>
              <div className={styles.sectionHeader}>
                <h3>Tyre Summary</h3>
                <span>{result.debrief?.tyres.finalCompound || lastStint?.compound || '--'}</span>
              </div>
              <dl className={styles.detailList}>
                <div>
                  <dt>Final age</dt>
                  <dd>{formatLapCount(result.debrief?.tyres.finalAge)}</dd>
                </div>
                <div>
                  <dt>Average wear</dt>
                  <dd>{formatWear(result.debrief?.tyres.averageWearPct)}</dd>
                </div>
                <div>
                  <dt>Peak wear</dt>
                  <dd>{formatWear(result.debrief?.tyres.peakWearPct)}</dd>
                </div>
                <div>
                  <dt>Set wear</dt>
                  <dd>{formatWear(result.debrief?.tyres.finalSetWearPct)}</dd>
                </div>
                <div>
                  <dt>Projected life</dt>
                  <dd>{formatLapCount(result.debrief?.tyres.lifeSpan)}</dd>
                </div>
                <div>
                  <dt>Life remaining</dt>
                  <dd>{formatWear(result.debrief?.tyres.lifeRemainingPct)}</dd>
                </div>
              </dl>
            </section>
          </div>
        </div>

        {showRich && (lapTimings.length > 0 || dynamics.length > 0 || issues.length > 0) ? (
          <div className={styles.richGrid}>
            {lapTimings.length > 0 ? (
              <section className={styles.sectionCard}>
                <div className={styles.sectionHeader}>
                  <h3>Lap Timing</h3>
                  <span>{lapTimings.length} laps</span>
                </div>
                <div className={styles.tableScroll}>
                  <table className={styles.dataTable}>
                    <thead>
                      <tr>
                        <th>Lap</th>
                        <th>Time</th>
                        <th>S1</th>
                        <th>S2</th>
                        <th>S3</th>
                        <th>Tyre</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lapTimings.map((lap) => (
                        <tr key={lap.lapNumber} className={lap.valid ? '' : styles.invalidLap}>
                          <td>{lap.lapNumber}</td>
                          <td>{formatLapTime(lap.lapMs)}</td>
                          <td>{formatSector(lap.s1Ms)}</td>
                          <td>{formatSector(lap.s2Ms)}</td>
                          <td>{formatSector(lap.s3Ms)}</td>
                          <td>
                            {lap.tyre ? (
                              <span className={styles.tyreTag}>
                                <span className={styles.stintSwatch} style={{ backgroundColor: getTyreColor(lap.tyre) }} />
                                {lap.tyre}
                              </span>
                            ) : (
                              '--'
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}

            {dynamics.length > 0 ? (
              <section className={styles.sectionCard}>
                <div className={styles.sectionHeader}>
                  <h3>Lap Dynamics</h3>
                  <span>Understeer / oversteer balance</span>
                </div>
                <div className={styles.tableScroll}>
                  <table className={styles.dataTable}>
                    <thead>
                      <tr>
                        <th>Lap</th>
                        <th>Understeer</th>
                        <th>Oversteer</th>
                        <th>Lockups</th>
                        <th>Spins</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dynamics.map((lap) => (
                        <tr key={lap.lapNum}>
                          <td>{lap.lapNum}</td>
                          <td>{lap.understeerPct.toFixed(1)}%</td>
                          <td>{lap.oversteerPct.toFixed(1)}%</td>
                          <td>{lap.lockupCount}</td>
                          <td>{lap.spinCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}

            {issues.length > 0 ? (
              <section className={styles.sectionCard}>
                <div className={styles.sectionHeader}>
                  <h3>Issues &amp; Incidents</h3>
                  <span>{issues.length} events</span>
                </div>
                <div className={styles.timeline}>
                  {issues.map((entry, index) => (
                    <article
                      key={entry.id || `issue-${index}`}
                      className={`${styles.timelineEntry} ${getTimelineTone(entry)}`}
                    >
                      <div className={styles.timelineStamp}>
                        <span>{entry.lap ? `Lap ${entry.lap}` : formatTimestamp(entry.timestamp)}</span>
                        <small>{entry.category}</small>
                      </div>
                      <div className={styles.timelineBody}>
                        <strong>{entry.driverName || entry.category.toUpperCase()}</strong>
                        <p>{entry.message}</p>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
