import { useState, useEffect, useRef, useMemo } from 'react';
import type { DriverInfo, SessionInfo, RaceControlNotification } from '../../../types/telemetry';
import { formatLapTime } from '../../../utils/formatters';
import { SectionHeader } from '../shared/SectionHeader';
import { DeltaText } from '../shared/DeltaText';
import { WeatherBadge, WeatherTimeline, RaceControlLog } from './TrackMapSection';
import styles from './PaceAnalysisSection.module.css';

interface PaceAnalysisSectionProps {
  drivers: DriverInfo[];
  playerIndex: number;
  session: SessionInfo | null;
  raceControlNotifications: RaceControlNotification[];
}

interface LapHistoryEntry {
  lapNumber: number;
  lapTime: number;
  sector1: number | null;
  sector2: number | null;
  sector3: number | null;
  timestamp: number;
}

/**
 * Hook to track lap history as the player completes laps
 */
function useLapHistory(driver: DriverInfo | null, maxLaps: number = 50) {
  const [lapHistory, setLapHistory] = useState<LapHistoryEntry[]>([]);
  const lastLapNumRef = useRef<number>(0);
  const lastDriverIndexRef = useRef<number | null>(null);

  useEffect(() => {
    if (!driver) {
      // Reset when driver is null
      setLapHistory([]);
      lastLapNumRef.current = 0;
      lastDriverIndexRef.current = null;
      return;
    }

    // Detect driver change or session reset (lap number decreased)
    const isDriverChange = lastDriverIndexRef.current !== null && lastDriverIndexRef.current !== driver.index;
    const isSessionReset = driver.currentLapNum < lastLapNumRef.current;

    if (isDriverChange || isSessionReset) {
      setLapHistory([]);
      lastLapNumRef.current = 0;
    }

    lastDriverIndexRef.current = driver.index;

    const currentLapNum = driver.currentLapNum;
    const lastLapTime = driver.lastLapTime;

    // Detect lap completion: lap number increased and we have a valid last lap time
    if (currentLapNum > lastLapNumRef.current && lastLapTime > 0) {
      const completedLapNum = currentLapNum - 1;

      const newEntry: LapHistoryEntry = {
        lapNumber: completedLapNum,
        lapTime: lastLapTime,
        sector1: null, // Sector times not available in DriverInfo
        sector2: null,
        sector3: null,
        timestamp: Date.now(),
      };

      setLapHistory(prev => {
        // Check if we already have this lap - update it if lap time changed
        const existingIndex = prev.findIndex(entry => entry.lapNumber === completedLapNum);

        if (existingIndex >= 0) {
          // Update existing entry if lap time has changed
          if (prev[existingIndex].lapTime !== lastLapTime) {
            const updated = [...prev];
            updated[existingIndex] = newEntry;
            return updated;
          }
          return prev;
        }

        const updated = [...prev, newEntry];
        // Keep only the most recent laps
        if (updated.length > maxLaps) {
          return updated.slice(-maxLaps);
        }
        return updated;
      });
    }

    lastLapNumRef.current = currentLapNum;
  }, [driver, maxLaps]);

  // Memoize derived data to prevent unnecessary re-renders
  const derivedData = useMemo(() => {
    if (lapHistory.length === 0) {
      return {
        processedHistory: [],
        bestLapTime: 0,
      };
    }

    const bestTime = Math.min(...lapHistory.map(l => l.lapTime));
    const processedHistory = lapHistory.map(entry => ({
      ...entry,
      deltaFromBest: entry.lapTime - bestTime,
    }));

    return {
      processedHistory,
      bestLapTime: bestTime,
    };
  }, [lapHistory]);

  return {
    lapHistory: derivedData.processedHistory,
    bestLapTime: derivedData.bestLapTime,
    clearHistory: () => {
      setLapHistory([]);
      lastLapNumRef.current = 0;
    },
  };
}

// Extended type for processed history with delta
interface ProcessedLapEntry extends LapHistoryEntry {
  deltaFromBest: number;
}

export function PaceAnalysisSection({ drivers, playerIndex, session, raceControlNotifications }: PaceAnalysisSectionProps) {
  const player = drivers.find(d => d.index === playerIndex) ?? null;
  const { lapHistory, bestLapTime } = useLapHistory(player);

  // Find the best lap in history for highlighting
  const bestLapNumber = lapHistory.length > 0
    ? lapHistory.reduce((best, current) =>
        current.lapTime < best.lapTime ? current : best
      ).lapNumber
    : null;

  return (
    <div className={styles.container}>
      <SectionHeader
        title="Pace Analysis"
        subtitle={bestLapTime > 0 ? `Best: ${formatLapTime(bestLapTime)}` : undefined}
        rightContent={<WeatherBadge session={session} />}
      />

      {/* Weather Timeline */}
      <div className={styles.weatherTimeline}>
        <WeatherTimeline forecasts={session?.weatherForecast ?? []} />
      </div>

      {/* Race Control Log */}
      <div className={styles.raceControlLog}>
        <RaceControlLog notifications={raceControlNotifications} />
      </div>

      <div className={styles.tableWrapper}>
        {lapHistory.length === 0 ? (
          <div className={styles.emptyState}>
            <span className={styles.emptyText}>Waiting for lap data...</span>
            <span className={styles.emptyHint}>Complete a lap to see pace analysis</span>
          </div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.colLap}>Lap</th>
                <th className={styles.colTime}>Time</th>
                <th className={styles.colSector}>S1</th>
                <th className={styles.colSector}>S2</th>
                <th className={styles.colSector}>S3</th>
                <th className={styles.colDelta}>Delta</th>
              </tr>
            </thead>
            <tbody>
              {[...lapHistory].reverse().map(entry => {
                const isBestLap = entry.lapNumber === bestLapNumber;

                return (
                  <tr
                    key={entry.lapNumber}
                    className={`${styles.row} ${isBestLap ? styles.bestLapRow : ''}`}
                  >
                    <td className={styles.colLap}>
                      <span className={styles.lapNumber}>{entry.lapNumber}</span>
                    </td>
                    <td className={styles.colTime}>
                      <span className={`${styles.lapTime} ${isBestLap ? styles.bestTime : ''}`}>
                        {formatLapTime(entry.lapTime)}
                      </span>
                    </td>
                    <td className={styles.colSector}>
                      <span className={styles.sector}>
                        {entry.sector1 !== null ? formatSectorTime(entry.sector1) : '--'}
                      </span>
                    </td>
                    <td className={styles.colSector}>
                      <span className={styles.sector}>
                        {entry.sector2 !== null ? formatSectorTime(entry.sector2) : '--'}
                      </span>
                    </td>
                    <td className={styles.colSector}>
                      <span className={styles.sector}>
                        {entry.sector3 !== null ? formatSectorTime(entry.sector3) : '--'}
                      </span>
                    </td>
                    <td className={styles.colDelta}>
                      {isBestLap ? (
                        <span className={styles.bestLabel}>BEST</span>
                      ) : (
                        <DeltaText deltaMs={entry.deltaFromBest} size="small" />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {lapHistory.length > 0 && (
        <div className={styles.summary}>
          <div className={styles.summaryItem}>
            <span className={styles.summaryLabel}>Avg Pace</span>
            <span className={styles.summaryValue}>
              {formatLapTime(calculateAverageLapTime(lapHistory))}
            </span>
          </div>
          <div className={styles.summaryItem}>
            <span className={styles.summaryLabel}>Consistency</span>
            <span className={styles.summaryValue}>
              {formatConsistency(calculateConsistency(lapHistory))}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Format sector time (seconds with milliseconds)
 */
function formatSectorTime(ms: number): string {
  const seconds = ms / 1000;
  return seconds.toFixed(3);
}

/**
 * Calculate average lap time from history
 */
function calculateAverageLapTime(history: ProcessedLapEntry[]): number {
  if (history.length === 0) return 0;
  const sum = history.reduce((acc, entry) => acc + entry.lapTime, 0);
  return Math.round(sum / history.length);
}

/**
 * Calculate consistency (standard deviation of lap times)
 */
function calculateConsistency(history: ProcessedLapEntry[]): number {
  if (history.length < 2) return 0;

  const avg = calculateAverageLapTime(history);
  const squaredDiffs = history.map(entry => Math.pow(entry.lapTime - avg, 2));
  const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / history.length;
  return Math.sqrt(avgSquaredDiff);
}

/**
 * Format consistency as a readable string
 */
function formatConsistency(stdDevMs: number): string {
  if (stdDevMs === 0) return '--';
  const seconds = stdDevMs / 1000;
  return `\u00B1${seconds.toFixed(2)}s`;
}
