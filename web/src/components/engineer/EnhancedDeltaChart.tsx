import { useMemo } from 'react';
import type { AlignedData, Options } from 'uplot';
import { TelemetryChart } from '../pitwall/TelemetryChart';
import type { SectorBoundaryMarkers } from '../pitwall/TelemetryChart';
import type { TelemetryPoint } from '../../types/telemetry';

interface EnhancedDeltaChartProps {
  bestLapPoints: TelemetryPoint[] | null;
  currentLapPoints: TelemetryPoint[] | null;
  sectorBoundaries?: SectorBoundaryMarkers;
  height?: number;
}

export function EnhancedDeltaChart({
  bestLapPoints,
  currentLapPoints,
  sectorBoundaries,
  height = 200,
}: EnhancedDeltaChartProps) {
  const data = useMemo<AlignedData>(() => {
    if (!bestLapPoints || !currentLapPoints || bestLapPoints.length < 2) {
      return [[], []];
    }

    const bestTimeMap = new Map<number, number>();
    bestLapPoints.forEach(p => bestTimeMap.set(Math.round(p.lapDistance), p.lapTime));

    const distances: number[] = [];
    const deltas: number[] = [];

    for (const p of currentLapPoints) {
      const roundedDist = Math.round(p.lapDistance);
      const bestTime = bestTimeMap.get(roundedDist);
      if (bestTime !== undefined) {
        distances.push(roundedDist);
        deltas.push((p.lapTime - bestTime) / 1000);
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
      sectorBoundaries={sectorBoundaries}
    />
  );
}
