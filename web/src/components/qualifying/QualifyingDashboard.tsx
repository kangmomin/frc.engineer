import { useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { getTeamColor } from '../../constants/teamColors';
import { getTyreColor, getTyreShortLabel } from '../../constants/tyreCompounds';
import { useQualifyingState } from '../../hooks/useQualifyingState';
import type { QualifyingPhase } from '../../hooks/useQualifyingState';
import { useTrackGaps } from '../../hooks/useTrackGaps';
import { useTelemetryStore } from '../../store/telemetryStore';
import type { DriverInfo, SessionInfo } from '../../types/telemetry';
import { getConnectionBadgeLabel } from '../../utils/connectionStatus';
import { formatLapTime } from '../../utils/formatters';
import { sortQualifyingDrivers } from './leaderboardOrder';
import styles from './QualifyingDashboard.module.css';

// ── Props ──

interface QualifyingDashboardProps {
  onSwitchToCockpit: () => void;
  onSwitchToCommentary?: () => void;
  onGoHome?: () => void;
  remoteAction?: {
    label: string;
    onClick: () => void;
    active?: boolean;
  };
}

// ── Accumulator for best sectors ──

interface SectorAcc {
  bestS1: number;
  bestS2: number;
  bestS3: number;
}

interface PrevSnap {
  currentLapNum: number;
  lastLapTime: number;
  sector1TimeMs: number;
  sector2TimeMs: number;
}

function useSectorAccumulator(drivers: DriverInfo[], session: SessionInfo | null) {
  const [accMap, setAccMap] = useState<Map<number, SectorAcc>>(() => new Map());
  const prevRef = useRef<Map<number, PrevSnap>>(new Map());
  const sessionKeyRef = useRef('');

  const sessionKey = `${session?.trackId ?? ''}|${session?.sessionType ?? ''}`;
  useEffect(() => {
    if (sessionKeyRef.current && sessionKeyRef.current !== sessionKey) {
      setAccMap(new Map());
      prevRef.current = new Map();
    }
    sessionKeyRef.current = sessionKey;
  }, [sessionKey]);

  useEffect(() => {
    if (drivers.length === 0) return;

    // Capture previous snapshots BEFORE the state update — not inside the updater
    const capturedPrev = prevRef.current;

    let changed = false;
    setAccMap((prev) => {
      const next = new Map(prev);
      for (const d of drivers) {
        const snap = capturedPrev.get(d.index);
        let acc = next.get(d.index) ?? { bestS1: 0, bestS2: 0, bestS3: 0 };
        let accChanged = false;

        if (d.sector1TimeMs > 0 && (acc.bestS1 === 0 || d.sector1TimeMs < acc.bestS1)) {
          acc = { ...acc, bestS1: d.sector1TimeMs };
          accChanged = true;
        }
        if (d.sector2TimeMs > 0 && (acc.bestS2 === 0 || d.sector2TimeMs < acc.bestS2)) {
          acc = { ...acc, bestS2: d.sector2TimeMs };
          accChanged = true;
        }
        if (snap && d.currentLapNum > snap.currentLapNum && snap.lastLapTime > 0 && snap.sector1TimeMs > 0 && snap.sector2TimeMs > 0) {
          const s3 = snap.lastLapTime - snap.sector1TimeMs - snap.sector2TimeMs;
          if (s3 > 0 && (acc.bestS3 === 0 || s3 < acc.bestS3)) {
            acc = { ...acc, bestS3: s3 };
            accChanged = true;
          }
        }

        if (accChanged || !next.has(d.index)) {
          next.set(d.index, acc);
          changed = true;
        }
      }
      return changed ? next : prev;
    });

    // Advance ref AFTER state update, outside the updater
    const nextPrev = new Map<number, PrevSnap>();
    for (const d of drivers) {
      nextPrev.set(d.index, {
        currentLapNum: d.currentLapNum,
        lastLapTime: d.lastLapTime,
        sector1TimeMs: d.sector1TimeMs,
        sector2TimeMs: d.sector2TimeMs,
      });
    }
    prevRef.current = nextPrev;
  }, [drivers]);

  return accMap;
}

// ── Helpers ──

function formatSectorTime(ms: number): string {
  if (ms <= 0) return '--';
  return (ms / 1000).toFixed(3);
}

function formatGapToLeader(driverBest: number, leaderBest: number): string {
  if (driverBest <= 0 || leaderBest <= 0) return '--';
  if (driverBest === leaderBest) return '';
  const delta = driverBest - leaderBest;
  return `+${(delta / 1000).toFixed(3)}`;
}

function formatDistance(meters: number | null): string {
  if (meters == null) return '--';
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)}km`;
  return `${Math.round(meters)}m`;
}

function getGapTone(meters: number | null): string {
  if (meters == null) return '';
  if (meters < 150) return styles.gapClose;
  if (meters < 400) return styles.gapMedium;
  return styles.gapFar;
}

function getPhaseClass(phase: QualifyingPhase): string {
  switch (phase) {
    case 'FLYING': return styles.phaseFlying;
    case 'OUT': return styles.phaseOut;
    case 'COOLDOWN': return styles.phaseCooldown;
    case 'GARAGE': return styles.phaseGarage;
    case 'PIT': return styles.phasePit;
    default: return styles.phaseUnknown;
  }
}

function getPitLabel(pitStatus: number): { label: string; className: string } {
  if (pitStatus === 0) return { label: 'ON TRACK', className: styles.pitOut };
  if (pitStatus === 1) return { label: 'PITTING', className: styles.pitIn };
  return { label: 'IN PIT', className: styles.pitIn };
}

// ── Main Component ──

export function QualifyingDashboard({
  onSwitchToCockpit,
  onSwitchToCommentary,
  onGoHome,
  remoteAction,
}: QualifyingDashboardProps) {
  const { pitwallState, connectionState } = useTelemetryStore(
    useShallow((s) => ({
      pitwallState: s.pitwallState,
      connectionState: s.connectionState,
    })),
  );

  const session = pitwallState?.session ?? null;
  const allDrivers = pitwallState?.drivers ?? [];
  const playerIndex = pitwallState?.playerIndex ?? 0;

  const isQualifying = /^(Q[1-3]|Short Q|OSQ|SS[1-3]|Short SS|OSS)$/i.test(session?.sessionType ?? '');
  const trackLength = session?.trackLength ?? 0;

  // Sort by best lap time for qualifying leaderboard
  const sortedDrivers = useMemo(() => {
    return sortQualifyingDrivers(allDrivers, session?.sessionType);
  }, [allDrivers, session?.sessionType]);

  const player = allDrivers.find((d) => d.index === playerIndex) ?? null;
  const leaderBest = sortedDrivers.length > 0 && sortedDrivers[0].bestLapTime > 0 ? sortedDrivers[0].bestLapTime : 0;

  // Sector accumulator
  const accMap = useSectorAccumulator(allDrivers, session);

  // Overall best sectors (across all drivers)
  const overallBestSectors = useMemo(() => {
    let s1 = 0, s2 = 0, s3 = 0;
    for (const [, acc] of accMap) {
      if (acc.bestS1 > 0 && (s1 === 0 || acc.bestS1 < s1)) s1 = acc.bestS1;
      if (acc.bestS2 > 0 && (s2 === 0 || acc.bestS2 < s2)) s2 = acc.bestS2;
      if (acc.bestS3 > 0 && (s3 === 0 || acc.bestS3 < s3)) s3 = acc.bestS3;
    }
    return { s1, s2, s3 };
  }, [accMap]);

  // Qualifying state machine
  const qualiState = useQualifyingState(player, player?.lapInvalid ?? false, isQualifying);

  // Track gaps
  const trackGap = useTrackGaps(allDrivers, trackLength, playerIndex);

  // Player sector data
  const playerAcc = player ? accMap.get(player.index) : null;

  const pitInfo = player ? getPitLabel(player.pitStatus) : { label: '--', className: '' };

  return (
    <div className={styles.qualifying}>
      <div className={styles.backdropGlow} />

      {/* Utility dock */}
      <div className={styles.utilityDock}>
        {onGoHome && (
          <button type="button" className={styles.dockButton} onClick={onGoHome}>
            Home
          </button>
        )}
        <button type="button" className={styles.dockButton} onClick={onSwitchToCockpit}>
          Cockpit
        </button>
        {onSwitchToCommentary && (
          <button type="button" className={styles.dockButton} onClick={onSwitchToCommentary}>
            Live
          </button>
        )}
        {remoteAction && (
          <button
            type="button"
            className={`${styles.dockButton} ${remoteAction.active ? styles.dockButtonActive : ''}`}
            onClick={remoteAction.onClick}
          >
            {remoteAction.label}
          </button>
        )}
      </div>

      {/* Top strip */}
      <div className={styles.topStrip}>
        <div className={`${styles.stripCard} ${styles.primary}`}>
          <span className={styles.stripLabel}>Session</span>
          <strong>{session?.sessionType ?? 'No Session'}</strong>
        </div>
        <div className={`${styles.stripCard} ${styles.neutral}`}>
          <span className={styles.stripLabel}>Track</span>
          <strong>{session?.trackName ?? '--'}</strong>
        </div>
        <div className={`${styles.stripCard} ${styles.neutral}`}>
          <span className={styles.stripLabel}>Time Left</span>
          <strong>{formatTimeLeft(session?.sessionTimeLeft)}</strong>
        </div>
        <div className={`${styles.stripCard} ${styles.tertiary}`}>
          <span className={styles.stripLabel}>Best</span>
          <strong>{player ? formatLapTime(player.bestLapTime) : '--:--.---'}</strong>
        </div>
        <div className={`${styles.stripCard} ${styles.secondary}`}>
          <span className={styles.stripLabel}>Connection</span>
          <strong>{getConnectionBadgeLabel(connectionState)}</strong>
        </div>
      </div>

      {/* Leaderboard */}
      <div className={styles.leaderboardWrap}>
        <table className={styles.leaderboard}>
          <thead>
            <tr>
              <th>Pos</th>
              <th>Driver</th>
              <th>Best Lap</th>
              <th>S1</th>
              <th>S2</th>
              <th>S3</th>
              <th>Gap</th>
              <th>Tyre</th>
              <th>Laps</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {sortedDrivers.map((d, i) => {
              const acc = accMap.get(d.index);
              const isPlayer = d.index === playerIndex;
              return (
                <tr key={d.index} className={isPlayer ? styles.playerRow : undefined}>
                  <td className={styles.posCell}>{i + 1}</td>
                  <td>
                    <div className={styles.driverCell}>
                      <span className={styles.teamStripe} style={{ background: getTeamColor(d.teamId) }} />
                      {d.name || `Driver ${d.index}`}
                      {d.aiControlled && <span className={styles.driverBadge}>AI</span>}
                    </div>
                  </td>
                  <td className={d.bestLapTime === leaderBest && leaderBest > 0 ? styles.fastestCell : undefined}>
                    {d.bestLapTime > 0 ? formatLapTime(d.bestLapTime) : '--:--.---'}
                  </td>
                  <td className={`${styles.sectorCell} ${acc?.bestS1 === overallBestSectors.s1 && acc?.bestS1 > 0 ? styles.sectorBest : ''}`}>
                    {formatSectorTime(acc?.bestS1 ?? 0)}
                  </td>
                  <td className={`${styles.sectorCell} ${acc?.bestS2 === overallBestSectors.s2 && acc?.bestS2 > 0 ? styles.sectorBest : ''}`}>
                    {formatSectorTime(acc?.bestS2 ?? 0)}
                  </td>
                  <td className={`${styles.sectorCell} ${acc?.bestS3 === overallBestSectors.s3 && acc?.bestS3 > 0 ? styles.sectorBest : ''}`}>
                    {formatSectorTime(acc?.bestS3 ?? 0)}
                  </td>
                  <td className={styles.gapCell}>
                    {formatGapToLeader(d.bestLapTime, leaderBest)}
                  </td>
                  <td>
                    <span className={styles.tyreBadge}>
                      <span className={styles.tyreDot} style={{ background: getTyreColor(d.tireCompound) }} />
                      {getTyreShortLabel(d.tireCompound)}
                    </span>
                  </td>
                  <td>{d.currentLapNum}</td>
                  <td><DriverStatusBadge pitStatus={d.pitStatus} driverStatus={d.driverStatus} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Sidebar */}
      <div className={styles.sidebar}>
        {/* Phase Indicator */}
        <div className={`${styles.panel} ${styles.phasePanel}`}>
          <span className={styles.panelTitle}>Lap Phase</span>
          <div className={`${styles.phaseBadge} ${getPhaseClass(qualiState.phase)}`}>
            {qualiState.phase}
          </div>
          <div className={styles.phaseDetail}>
            Run #{qualiState.attemptNumber} &middot; Push Streak: {qualiState.consecutivePushLaps}
          </div>
        </div>

        {/* Track Gap */}
        <div className={`${styles.panel} ${styles.gapPanel}`}>
          <span className={styles.panelTitle}>Track Gap</span>
          <div className={styles.gapRow}>
            <div>
              <div className={styles.gapLabel}>Ahead</div>
              <div className={styles.gapDriver}>{trackGap.aheadDriver?.name ?? '--'}</div>
            </div>
            <div className={`${styles.gapValue} ${getGapTone(trackGap.gapAheadM)}`}>
              {formatDistance(trackGap.gapAheadM)}
            </div>
          </div>
          <div className={styles.gapRow}>
            <div>
              <div className={styles.gapLabel}>Behind</div>
              <div className={styles.gapDriver}>{trackGap.behindDriver?.name ?? '--'}</div>
            </div>
            <div className={`${styles.gapValue} ${getGapTone(trackGap.gapBehindM)}`}>
              {formatDistance(trackGap.gapBehindM)}
            </div>
          </div>
        </div>

        {/* Sector Times */}
        <div className={`${styles.panel} ${styles.sectorPanel}`}>
          <span className={styles.panelTitle}>Sectors</span>
          <div className={styles.sectorGrid}>
            <span className={styles.sectorGridLabel}>S1</span>
            <span className={styles.sectorGridTime}>
              {player && player.sector1TimeMs > 0 ? formatSectorTime(player.sector1TimeMs) : '--'}
            </span>
            <span className={styles.sectorGridBest}>
              Best: {formatSectorTime(playerAcc?.bestS1 ?? 0)}
            </span>

            <span className={styles.sectorGridLabel}>S2</span>
            <span className={styles.sectorGridTime}>
              {player && player.sector2TimeMs > 0 ? formatSectorTime(player.sector2TimeMs) : '--'}
            </span>
            <span className={styles.sectorGridBest}>
              Best: {formatSectorTime(playerAcc?.bestS2 ?? 0)}
            </span>

            <span className={styles.sectorGridLabel}>S3</span>
            <span className={styles.sectorGridTime}>--</span>
            <span className={styles.sectorGridBest}>
              Best: {formatSectorTime(playerAcc?.bestS3 ?? 0)}
            </span>
          </div>
        </div>

        {/* Status Panel */}
        <div className={`${styles.panel} ${styles.statusPanel}`}>
          <span className={styles.panelTitle}>Status</span>
          <div className={styles.statusGrid}>
            <div className={styles.statusTile}>
              <div className={styles.statusTileLabel}>Pit</div>
              <div className={`${styles.statusTileValue} ${pitInfo.className}`}>
                {pitInfo.label}
              </div>
            </div>
            <div className={styles.statusTile}>
              <div className={styles.statusTileLabel}>Run</div>
              <div className={styles.statusTileValue}>
                {qualiState.attemptNumber || '--'}
              </div>
            </div>
            <div className={styles.statusTile}>
              <div className={styles.statusTileLabel}>Lap</div>
              <div className={styles.statusTileValue}>
                {player?.currentLapNum ?? '--'}
              </div>
            </div>
            <div className={styles.statusTile}>
              <div className={styles.statusTileLabel}>Pos</div>
              <div className={styles.statusTileValue}>
                P{player?.position ?? '--'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Driver Status Badge ──

function getDriverStatusInfo(pitStatus: number, driverStatus: number): { label: string; className: string } {
  if (pitStatus === 1) return { label: 'PIT', className: styles.statusPit };
  if (pitStatus === 2) return { label: 'PIT', className: styles.statusPit };
  switch (driverStatus) {
    case 1: return { label: 'FLY', className: styles.statusFlying };
    case 2: return { label: 'IN', className: styles.statusInLap };
    case 3: return { label: 'OUT', className: styles.statusOutLap };
    case 0: return { label: 'GAR', className: styles.statusGarage };
    default: return { label: '--', className: styles.statusGarage };
  }
}

function formatTimeLeft(seconds?: number): string {
  if (seconds == null || seconds <= 0) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function DriverStatusBadge({ pitStatus, driverStatus }: { pitStatus: number; driverStatus: number }) {
  const { label, className } = getDriverStatusInfo(pitStatus, driverStatus);
  return <span className={`${styles.statusBadge} ${className}`}>{label}</span>;
}
