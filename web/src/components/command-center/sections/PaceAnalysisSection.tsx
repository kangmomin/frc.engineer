import { useState, useEffect, useRef, useMemo, memo, useCallback, useSyncExternalStore } from 'react';
import type { DriverInfo } from '../../../types/telemetry';
import { formatLapTime } from '../../../utils/formatters';
import { SectionHeader } from '../shared/SectionHeader';
import { DeltaText } from '../shared/DeltaText';
import { WeatherBadge, WeatherTimeline, RaceControlLog } from './TrackMapSection';
import { useTelemetryStore } from '../../../store/telemetryStore';
import styles from './PaceAnalysisSection.module.css';

interface LapHistoryEntry {
  lapNumber: number;
  lapTime: number;
  sector1: number | null;
  sector2: number | null;
  sector3: number | null;
  timestamp: number;
}

// --- Performance Utilities ---

function useStoreWithEq<T>(
  selector: (state: ReturnType<typeof useTelemetryStore.getState>) => T,
  isEqual: (a: T, b: T) => boolean,
): T {
  const prev = useRef<T>(selector(useTelemetryStore.getState()));
  const getSnapshot = useCallback(() => {
    const next = selector(useTelemetryStore.getState());
    if (isEqual(prev.current, next)) return prev.current;
    prev.current = next;
    return next;
  }, [selector, isEqual]);
  return useSyncExternalStore(useTelemetryStore.subscribe, getSnapshot);
}

// --- Stable Selectors & Equality Fns ---

const selectPlayerIndex = (s: ReturnType<typeof useTelemetryStore.getState>) => s.pitwallState?.playerIndex ?? 0;
const selectNotifications = (s: ReturnType<typeof useTelemetryStore.getState>) => s.raceControlNotifications;

function playerPaceEqual(a: DriverInfo | null, b: DriverInfo | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.currentLapNum === b.currentLapNum && 
    a.lastLapTime === b.lastLapTime && 
    a.sector1TimeMs === b.sector1TimeMs && 
    a.sector2TimeMs === b.sector2TimeMs
  );
}

function sessionWeatherEqual(a: any, b: any): boolean {
  return a?.weather === b?.weather && a?.trackTemp === b?.trackTemp;
}

// --- Components ---

const LapRow = memo(({ entry, isBest }: { entry: LapHistoryEntry & { deltaFromBest: number }, isBest: boolean }) => (
  <tr className={`${styles.row} ${isBest ? styles.bestLapRow : ''}`}>
    <td className={styles.colLap}><span className={styles.lapNumber}>{entry.lapNumber}</span></td>
    <td className={styles.colTime}><span className={`${styles.lapTime} ${isBest ? styles.bestTime : ''}`}>{formatLapTime(entry.lapTime)}</span></td>
    <td className={styles.colSector}><span className={styles.sector}>{entry.sector1 ? (entry.sector1/1000).toFixed(3) : '--'}</span></td>
    <td className={styles.colSector}><span className={styles.sector}>{entry.sector2 ? (entry.sector2/1000).toFixed(3) : '--'}</span></td>
    <td className={styles.colSector}><span className={styles.sector}>{entry.sector3 ? (entry.sector3/1000).toFixed(3) : '--'}</span></td>
    <td className={styles.colDelta}>{isBest ? <span className={styles.bestLabel}>BEST</span> : <DeltaText deltaMs={entry.deltaFromBest} size="small" />}</td>
  </tr>
));

export function PaceAnalysisSection() {
  const playerIdx = useTelemetryStore(selectPlayerIndex);
  
  const selectPlayer = useCallback((s: ReturnType<typeof useTelemetryStore.getState>) => {
    return s.pitwallState?.drivers.find(d => d.index === playerIdx) ?? null;
  }, [playerIdx]);

  const player = useStoreWithEq(selectPlayer, playerPaceEqual);
  
  const selectSession = useCallback((s: ReturnType<typeof useTelemetryStore.getState>) => s.pitwallState?.session ?? null, []);
  const session = useStoreWithEq(selectSession, sessionWeatherEqual);
  
  const notifications = useStoreWithEq(selectNotifications, (a, b) => a === b);
  
  const { lapHistory, bestLapTime } = useLapHistory(player);
  const bestLapNum = useMemo(() => lapHistory.length > 0 ? [...lapHistory].sort((a,b) => a.lapTime - b.lapTime)[0].lapNumber : null, [lapHistory]);

  return (
    <div className={styles.container}>
      <SectionHeader title="Pace Analysis" subtitle={bestLapTime > 0 ? `BEST: ${formatLapTime(bestLapTime)}` : 'WAITING FOR DATA'} rightContent={<WeatherBadge session={session} />} />
      <div className={styles.weatherTimeline}><WeatherTimeline forecasts={session?.weatherForecast ?? []} /></div>
      <div className={styles.raceControlLog}><RaceControlLog notifications={notifications} /></div>
      
      <div className={styles.tableWrapper}>
        {lapHistory.length === 0 ? (
          <div className={styles.emptyState}><span className={styles.emptyText}>Waiting for lap data...</span></div>
        ) : (
          <table className={styles.table}>
            <thead><tr><th className={styles.colLap}>L</th><th className={styles.colTime}>TIME</th><th className={styles.colSector}>S1</th><th className={styles.colSector}>S2</th><th className={styles.colSector}>S3</th><th className={styles.colDelta}>DELTA</th></tr></thead>
            <tbody>{[...lapHistory].reverse().map(e => <LapRow key={e.lapNumber} entry={e} isBest={e.lapNumber === bestLapNum} />)}</tbody>
          </table>
        )}
      </div>

      {lapHistory.length > 0 && (
        <div className={styles.summary}>
          <div className={styles.summaryItem}><span className={styles.summaryLabel}>AVG PACE</span><span className={styles.summaryValue}>{formatLapTime(lapHistory.reduce((s,e)=>s+e.lapTime,0)/lapHistory.length)}</span></div>
          <div className={styles.summaryItem}><span className={styles.summaryLabel}>CONSISTENCY</span><span className={styles.summaryValue}>{calculateConsistency(lapHistory)}</span></div>
        </div>
      )}
    </div>
  );
}

// --- Utils ---

function useLapHistory(driver: DriverInfo | null, maxLaps: number = 50) {
  const [lapHistory, setLapHistory] = useState<LapHistoryEntry[]>([]);
  const lastLapNumRef = useRef<number>(0);
  const lastDriverIndexRef = useRef<number | null>(null);
  const cachedS1Ref = useRef<number>(0);
  const cachedS2Ref = useRef<number>(0);

  useEffect(() => {
    if (!driver) return;
    if (lastDriverIndexRef.current !== driver.index || driver.currentLapNum < lastLapNumRef.current) {
      setLapHistory([]);
      lastLapNumRef.current = 0;
      cachedS1Ref.current = 0;
      cachedS2Ref.current = 0;
    }
    lastDriverIndexRef.current = driver.index;

    if (driver.sector1TimeMs > 0) cachedS1Ref.current = driver.sector1TimeMs;
    if (driver.sector2TimeMs > 0) cachedS2Ref.current = driver.sector2TimeMs;

    if (driver.currentLapNum > lastLapNumRef.current && driver.lastLapTime > 0) {
      const s1 = cachedS1Ref.current > 0 ? cachedS1Ref.current : null;
      const s2 = cachedS2Ref.current > 0 ? cachedS2Ref.current : null;
      const s3 = s1 !== null && s2 !== null ? driver.lastLapTime - s1 - s2 : null;
      const newEntry = { lapNumber: driver.currentLapNum - 1, lapTime: driver.lastLapTime, sector1: s1, sector2: s2, sector3: s3, timestamp: Date.now() };
      
      cachedS1Ref.current = 0;
      cachedS2Ref.current = 0;
      setLapHistory(prev => {
        const next = [...prev, newEntry];
        return next.length > maxLaps ? next.slice(-maxLaps) : next;
      });
    }
    lastLapNumRef.current = driver.currentLapNum;
  }, [driver, maxLaps]);

  return useMemo(() => {
    if (lapHistory.length === 0) return { lapHistory: [], bestLapTime: 0 };
    const best = Math.min(...lapHistory.map(l => l.lapTime));
    return { lapHistory: lapHistory.map(l => ({ ...l, deltaFromBest: l.lapTime - best })), bestLapTime: best };
  }, [lapHistory]);
}

function calculateConsistency(history: any[]): string {
  if (history.length < 2) return '--';
  const avg = history.reduce((s,e)=>s+e.lapTime,0)/history.length;
  const dev = Math.sqrt(history.reduce((s,e)=>s+Math.pow(e.lapTime-avg,2),0)/history.length);
  return `\u00B1${(dev/1000).toFixed(3)}s`;
}
