import { useState, useMemo, useRef, useEffect } from 'react';
import type { PitwallState } from '../../types/telemetry';
import styles from './StrategyBoard.module.css';

interface StrategyBoardProps {
  pitwallState: PitwallState | null;
}

function formatTime(ms: number): string {
  if (ms <= 0) return '-';
  const totalSec = ms / 1000;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min > 0) return `${min}:${sec.toFixed(3).padStart(6, '0')}`;
  return sec.toFixed(3);
}

function getTireClass(compound: string): string {
  switch (compound) {
    case 'soft': return styles.soft;
    case 'medium': return styles.medium;
    case 'hard': return styles.hard;
    case 'inter': return styles.inter;
    case 'wet': return styles.wet;
    default: return '';
  }
}

function getTireLabel(compound: string): string {
  switch (compound) {
    case 'soft': return 'S';
    case 'medium': return 'M';
    case 'hard': return 'H';
    case 'inter': return 'I';
    case 'wet': return 'W';
    default: return '?';
  }
}

export function StrategyBoard({ pitwallState }: StrategyBoardProps) {
  const prevLapTimesRef = useRef<Map<number, number>>(new Map());
  const [flashingSet, setFlashingSet] = useState<Set<number>>(new Set());

  const sorted = useMemo(() => {
    if (!pitwallState?.drivers?.length) return [];
    return [...pitwallState.drivers]
      .filter(d => d.position > 0)
      .sort((a, b) => a.position - b.position);
  }, [pitwallState]);

  const playerIndex = pitwallState?.playerIndex ?? -1;
  const playerBest = sorted.find(d => d.index === playerIndex)?.bestLapTime ?? 0;

  // Detect rival faster laps
  useEffect(() => {
    if (!sorted.length) return;
    const newFlashing = new Set<number>();
    for (const d of sorted) {
      const prev = prevLapTimesRef.current.get(d.index);
      if (prev !== undefined && d.lastLapTime !== prev && d.lastLapTime > 0 && playerBest > 0) {
        if (d.index !== playerIndex && d.lastLapTime < playerBest) {
          newFlashing.add(d.index);
        }
      }
      prevLapTimesRef.current.set(d.index, d.lastLapTime);
    }
    setFlashingSet(newFlashing);
  }, [sorted, playerIndex, playerBest]);

  if (!sorted.length) {
    return (
      <div className={styles.board}>
        <span className={styles.title}>Strategy Board</span>
        <span className={styles.noData}>Waiting for data...</span>
      </div>
    );
  }

  return (
    <div className={styles.board}>
      <span className={styles.title}>Strategy Board</span>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>POS</th>
            <th>DRIVER</th>
            <th>TIRE</th>
            <th>LAST</th>
            <th>BEST</th>
            <th>PITS</th>
            <th>GAP</th>
            <th>INT</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((d, idx) => {
            const isPlayer = d.index === playerIndex;
            const isPitting = d.pitStatus === 1 || d.pitStatus === 2;
            const isRivalFaster = flashingSet.has(d.index);

            const rowClass = [
              isPlayer ? styles.player : '',
              isPitting ? styles.pitActive : '',
              isRivalFaster ? styles.rivalFaster : '',
            ].filter(Boolean).join(' ');

            const gap = d.deltaToRaceLeader != null ? (d.deltaToRaceLeader / 1000).toFixed(3) : '-';
            const interval = idx === 0 ? '-' :
              (d.deltaToCarInFront != null ? (Math.abs(d.deltaToCarInFront) / 1000).toFixed(3) : '-');

            const name = d.name.trim().split(/\s+/);
            const shortName = name.length > 1 ? name[name.length - 1].substring(0, 3).toUpperCase() : d.name.substring(0, 3).toUpperCase();

            return (
              <tr key={d.index} className={rowClass}>
                <td>{d.position}</td>
                <td>{shortName}</td>
                <td>
                  <span className={getTireClass(d.tireCompound)}>
                    {getTireLabel(d.tireCompound)}
                  </span>
                  <span style={{ opacity: 0.6 }}>{d.tireAge}L</span>
                </td>
                <td>{formatTime(d.lastLapTime)}</td>
                <td>{formatTime(d.bestLapTime)}</td>
                <td>{d.numPitStops}</td>
                <td className={styles.gap}>{idx === 0 ? 'LEADER' : `+${gap}`}</td>
                <td className={styles.gap}>{interval}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
