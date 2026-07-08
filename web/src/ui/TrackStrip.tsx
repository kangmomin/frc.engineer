import type { Tone } from './types';
import type { TrackStripCorner } from './TrackStrip.derive';
import { buildCornerMarks, clampPct, monotonicBounds, wrapPct } from './TrackStrip.derive';
import styles from './TrackStrip.module.css';
import toneStyles from './tone.module.css';

export type { TrackStripCorner, CornerMark } from './TrackStrip.derive';

export interface TrackStripDriver {
  /** 드라이버 약어 코드 (예: 'VER'). focused일 때 마커 아래 라벨로 노출. */
  code: string;
  /** 현재 lapDistance (m). 음수(라인 통과 전)는 한 랩 기준으로 래핑된다. */
  distance: number;
  /** 마커 색 (팀 컬러 등). 생략 시 tone 액센트. */
  color?: string;
  /** 강조 마커 — tone 링 + 코드 라벨. */
  focused?: boolean;
  /** 핏레인 주행 중 — 반투명 표시. */
  inPit?: boolean;
}

export interface TrackStripProps {
  /** 트랙 총 길이 (m) — 막대 좌표계의 기준. */
  trackLength: number;
  /** 섹터 경계 lapDistance [S1 끝, S2 끝] (m). S3은 trackLength에서 끝난다. */
  sectorSplits: [number, number];
  /** 코너 마커 목록 (막대 위 T{n} 라벨 + 틱). */
  corners?: TrackStripCorner[];
  /** 트랙 위 드라이버 마커 목록. */
  drivers?: TrackStripDriver[];
  /** focused 링·스타트/피니시 마커의 액센트. */
  tone?: Tone;
  className?: string;
}

const SECTOR_CLASSES = ['sector1', 'sector2', 'sector3'] as const;

export function TrackStrip({
  trackLength,
  sectorSplits,
  corners,
  drivers,
  tone = 'primary',
  className,
}: TrackStripProps) {
  const classes = [styles.strip, toneStyles[tone]];
  if (className) classes.push(className);

  // 좌표계가 성립하지 않으면(트랙 길이 미상) 마커 없는 빈 프레임으로 강등한다.
  if (!Number.isFinite(trackLength) || trackLength <= 0) {
    return (
      <div className={classes.join(' ')}>
        <div className={styles.cornerBand} />
        <div className={styles.bar} />
      </div>
    );
  }

  const bounds = monotonicBounds(sectorSplits, trackLength);
  const cornerMarks = buildCornerMarks(corners ?? [], trackLength);

  return (
    <div className={classes.join(' ')}>
      <div className={styles.cornerBand}>
        {cornerMarks.map(({ corner, pct, raised }, i) => (
          <div
            key={`${corner.number}-${i}`}
            className={raised ? `${styles.corner} ${styles.raised}` : styles.corner}
            style={{ left: `${pct}%` }}
          >
            <span className={styles.cornerLabel}>T{corner.number}</span>
            <span className={styles.cornerTick} />
          </div>
        ))}
      </div>
      <div className={styles.bar}>
        {SECTOR_CLASSES.map((sectorClass, i) => {
          const left = clampPct(bounds[i], trackLength);
          const width = Math.max(0, clampPct(bounds[i + 1], trackLength) - left);
          return (
            <div
              key={sectorClass}
              className={`${styles.sector} ${styles[sectorClass]}`}
              style={{ left: `${left}%`, width: `${width}%` }}
            >
              <span className={styles.sectorLabel}>S{i + 1}</span>
            </div>
          );
        })}
        <span className={styles.startFinish} />
        {drivers?.map((driver, i) => {
          const markerClasses = [styles.driver];
          if (driver.focused) markerClasses.push(styles.focused);
          if (driver.inPit) markerClasses.push(styles.inPit);
          return (
            <span
              key={`${driver.code}-${i}`}
              className={markerClasses.join(' ')}
              style={{ left: `${wrapPct(driver.distance, trackLength)}%`, background: driver.color }}
              title={driver.inPit ? `${driver.code} (PIT)` : driver.code}
            >
              {driver.focused ? <span className={styles.driverCode}>{driver.code}</span> : null}
            </span>
          );
        })}
      </div>
    </div>
  );
}
