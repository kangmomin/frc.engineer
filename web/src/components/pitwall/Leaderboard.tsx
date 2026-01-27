import { useMemo } from 'react';
import type { DriverInfo } from '../../types/telemetry';
import styles from './Leaderboard.module.css';

interface LeaderboardProps {
  drivers: DriverInfo[];
  playerIndex: number;
}

const TEAM_COLORS: Record<number, string> = {
  0: '#00D2BE',
  1: '#DC0000',
  2: '#3671C6',
  3: '#FF8700',
  4: '#006F62',
  5: '#0090FF',
  6: '#005AFF',
  7: '#6692FF',
  8: '#52E252',
  9: '#B6BABD',
};

const TIRE_COLORS: Record<string, string> = {
  soft: '#DC0000',
  medium: '#FFF200',
  hard: '#FFFFFF',
  inter: '#00FF00',
  wet: '#0090FF',
};

function formatDriverName(name: string): string {
  if (!name) return '---';
  const parts = name.trim().split(' ');
  const last = parts[parts.length - 1];
  return last.substring(0, 3).toUpperCase();
}

function formatLapTime(ms: number): string {
  if (!ms) return '--:--.---';
  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const whole = Math.floor(seconds);
  const frac = Math.round((seconds - whole) * 1000);
  return `${minutes}:${String(whole).padStart(2, '0')}.${String(frac).padStart(3, '0')}`;
}

export function Leaderboard({ drivers, playerIndex }: LeaderboardProps) {
  const sorted = useMemo(
    () => [...drivers].sort((a, b) => a.position - b.position),
    [drivers],
  );

  if (!drivers.length) {
    return (
      <div className={styles.panel}>
        <div className={styles.panelHeader}>LEADERBOARD</div>
        <div className={styles.empty}>Waiting for data...</div>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>LEADERBOARD</div>
      <div className={styles.header}>
        <span className={styles.colPos}>POS</span>
        <span className={styles.colDriver}>DRIVER</span>
        <span className={styles.colLap}>LAP</span>
        <span className={styles.colLast}>LAST</span>
        <span className={styles.colTire}>TIRE</span>
      </div>
      <div className={styles.body}>
        {sorted.map((d, i) => {
          const teamColor = TEAM_COLORS[d.teamId] ?? '#888';
          const isPlayer = d.index === playerIndex;
          const tireColor = TIRE_COLORS[d.tireCompound?.toLowerCase()] ?? '#888';

          return (
            <div
              key={d.index}
              className={`${styles.row} ${isPlayer ? styles.playerRow : ''} ${i % 2 === 1 ? styles.rowAlt : ''}`}
              style={{
                borderLeft: isPlayer
                  ? '3px solid #3671C6'
                  : `3px solid ${teamColor}`,
              }}
            >
              <span className={styles.colPos}>{d.position}</span>
              <span className={styles.colDriver}>{formatDriverName(d.name)}</span>
              <span className={styles.colLap}>{d.currentLapNum}</span>
              <span className={styles.colLast}>{formatLapTime(d.lastLapTime)}</span>
              <span className={styles.colTire}>
                <span className={styles.tireDot} style={{ background: tireColor }} />
                <span className={styles.tireAge}>{d.tireAge}</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
