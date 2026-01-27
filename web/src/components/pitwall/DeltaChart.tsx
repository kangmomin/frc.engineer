import { useMemo } from 'react';
import type { AlignedData, Options } from 'uplot';
import { TelemetryChart } from './TelemetryChart';
import type { TelemetryPoint } from '../../types/telemetry';

interface DeltaChartProps {
  bestLapPoints: TelemetryPoint[] | null;
  currentLapPoints: TelemetryPoint[] | null;
  height?: number;
}

export function DeltaChart({
  bestLapPoints,
  currentLapPoints,
  height = 150,
}: DeltaChartProps) {
  const data = useMemo<AlignedData>(() => {
    if (!bestLapPoints || !currentLapPoints || bestLapPoints.length < 2) {
      return [[], []];
    }

    // Create a lookup map for best lap times
    const bestTimeMap = new Map<number, number>();
    bestLapPoints.forEach(p => {
      bestTimeMap.set(Math.round(p.lapDistance), p.lapTime);
    });

    // Calculate delta at each current lap point
    const distances: number[] = [];
    const deltas: number[] = [];

    for (const p of currentLapPoints) {
      const roundedDist = Math.round(p.lapDistance);
      const bestTime = bestTimeMap.get(roundedDist);

      if (bestTime !== undefined) {
        // Delta in seconds (current - best)
        // Positive = slower, negative = faster
        const deltaMs = p.lapTime - bestTime;
        distances.push(roundedDist);
        deltas.push(deltaMs / 1000); // Convert to seconds
      }
    }

    return [distances, deltas];
  }, [bestLapPoints, currentLapPoints]);

  const series = useMemo(() => [
    {
      label: 'Delta',
      stroke: 'var(--accent-blue)',
      width: 2,
      fill: 'rgba(0, 210, 255, 0.1)',
    },
  ], []);

  const axes = useMemo<Options['axes']>(() => [
    {
      label: 'Distance (m)',
      stroke: '#888',
      grid: { stroke: 'rgba(255,255,255,0.1)' },
      ticks: { stroke: 'rgba(255,255,255,0.2)' },
    },
    {
      label: 'Delta (s)',
      stroke: '#888',
      grid: { stroke: 'rgba(255,255,255,0.1)' },
      ticks: { stroke: 'rgba(255,255,255,0.2)' },
      scale: 'y',
      // Format with + for positive deltas
      values: (_u, vals) => vals.map(v => {
        if (v === null) return '';
        const num = Number(v);
        if (num > 0) return `+${num.toFixed(2)}`;
        return num.toFixed(2);
      }),
    },
  ], []);

  return (
    <TelemetryChart
      title="Delta Evolution"
      data={data}
      series={series}
      height={height}
      axes={axes}
    />
  );
}
