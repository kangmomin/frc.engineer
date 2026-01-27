import { useMemo } from 'react';
import type { AlignedData } from 'uplot';
import { TelemetryChart } from '../pitwall/TelemetryChart';
import type { SectorBoundaryMarkers } from '../pitwall/TelemetryChart';
import type { TelemetryPoint } from '../../types/telemetry';

interface EnhancedSpeedChartProps {
  bestLapPoints: TelemetryPoint[] | null;
  currentLapPoints: TelemetryPoint[] | null;
  sectorBoundaries?: SectorBoundaryMarkers;
  height?: number;
}

export function EnhancedSpeedChart({
  bestLapPoints,
  currentLapPoints,
  sectorBoundaries,
  height = 300,
}: EnhancedSpeedChartProps) {
  const data = useMemo<AlignedData>(() => {
    const distanceSet = new Set<number>();
    if (bestLapPoints) bestLapPoints.forEach(p => distanceSet.add(Math.round(p.lapDistance)));
    if (currentLapPoints) currentLapPoints.forEach(p => distanceSet.add(Math.round(p.lapDistance)));

    const distances = Array.from(distanceSet).sort((a, b) => a - b);
    if (distances.length === 0) return [[], [], []];

    const bestMap = new Map<number, number>();
    const currentMap = new Map<number, number>();
    if (bestLapPoints) bestLapPoints.forEach(p => bestMap.set(Math.round(p.lapDistance), p.speed));
    if (currentLapPoints) currentLapPoints.forEach(p => currentMap.set(Math.round(p.lapDistance), p.speed));

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
      sectorBoundaries={sectorBoundaries}
    />
  );
}
