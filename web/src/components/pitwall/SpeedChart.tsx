import { useMemo } from 'react';
import type { AlignedData } from 'uplot';
import { TelemetryChart } from './TelemetryChart';
import type { TelemetryPoint } from '../../types/telemetry';

interface SpeedChartProps {
  bestLapPoints: TelemetryPoint[] | null;
  currentLapPoints: TelemetryPoint[] | null;
  height?: number;
}

export function SpeedChart({
  bestLapPoints,
  currentLapPoints,
  height = 250,
}: SpeedChartProps) {
  const data = useMemo<AlignedData>(() => {
    // Build a merged distance axis from both datasets
    const distanceSet = new Set<number>();

    if (bestLapPoints) {
      bestLapPoints.forEach(p => distanceSet.add(Math.round(p.lapDistance)));
    }
    if (currentLapPoints) {
      currentLapPoints.forEach(p => distanceSet.add(Math.round(p.lapDistance)));
    }

    const distances = Array.from(distanceSet).sort((a, b) => a - b);

    if (distances.length === 0) {
      return [[], [], []];
    }

    // Create lookup maps for fast interpolation
    const bestMap = new Map<number, number>();
    const currentMap = new Map<number, number>();

    if (bestLapPoints) {
      bestLapPoints.forEach(p => bestMap.set(Math.round(p.lapDistance), p.speed));
    }
    if (currentLapPoints) {
      currentLapPoints.forEach(p => currentMap.set(Math.round(p.lapDistance), p.speed));
    }

    // Build aligned arrays
    const bestSpeeds: (number | null)[] = [];
    const currentSpeeds: (number | null)[] = [];

    for (const d of distances) {
      bestSpeeds.push(bestMap.get(d) ?? null);
      currentSpeeds.push(currentMap.get(d) ?? null);
    }

    return [distances, bestSpeeds, currentSpeeds];
  }, [bestLapPoints, currentLapPoints]);

  const series = useMemo(() => [
    { label: 'Best Lap', stroke: 'var(--accent-purple)', width: 2 },
    { label: 'Current', stroke: 'var(--accent-green)', width: 2 },
  ], []);

  return (
    <TelemetryChart
      title="Speed vs Distance"
      data={data}
      series={series}
      height={height}
      xAxisLabel="Distance (m)"
      yAxisLabel="Speed (km/h)"
    />
  );
}
