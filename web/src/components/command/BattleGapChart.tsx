import { useMemo } from 'react';
import type { PitwallState } from '../../types/telemetry';
import { useGapHistory } from '../../hooks/useGapHistory';
import { TelemetryChart } from '../pitwall/TelemetryChart';
import type { ChartSeries } from '../pitwall/TelemetryChart';
import styles from './BattleGapChart.module.css';

interface BattleGapChartProps {
  pitwallState: PitwallState | null;
}

const COLORS = ['#ff4444', '#ffdd00', '#44cc44', '#4488ff', '#cc44ff'];

function getDriverShortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? parts[parts.length - 1].substring(0, 3).toUpperCase() : name.substring(0, 3).toUpperCase();
}

export function BattleGapChart({ pitwallState }: BattleGapChartProps) {
  const { history, nearby } = useGapHistory(pitwallState);

  const { data, series } = useMemo(() => {
    if (history.length < 2 || nearby.length === 0) {
      return { data: null, series: [] };
    }

    const laps = history.map(h => h.lap);
    const seriesData: number[][] = nearby.map(driver => {
      return history.map(h => {
        const gapMs = h.gaps.get(driver.index) ?? 0;
        return gapMs / 1000; // Convert to seconds
      });
    });

    const chartSeries: ChartSeries[] = nearby.map((driver, i) => ({
      label: getDriverShortName(driver.name),
      stroke: COLORS[i % COLORS.length],
      width: 2,
    }));

    const alignedData: (number[])[] = [laps, ...seriesData];

    return { data: alignedData as unknown as uPlot.AlignedData, series: chartSeries };
  }, [history, nearby]);

  if (!data || history.length < 2) {
    return (
      <div className={styles.chart}>
        <span className={styles.title}>Battle Gap Chart</span>
        <span className={styles.noData}>
          {history.length === 0 ? 'Waiting for lap data...' : 'Need at least 2 laps...'}
        </span>
      </div>
    );
  }

  return (
    <div className={styles.chart}>
      <TelemetryChart
        title="Battle Gap (seconds)"
        data={data}
        series={series}
        height={250}
        xAxisLabel="Lap"
        yAxisLabel="Gap (s)"
        scales={{
          x: { time: false },
          y: { auto: true },
        }}
      />
    </div>
  );
}
