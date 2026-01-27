import { useMemo } from 'react';
import type { AlignedData } from 'uplot';
import { TelemetryChart } from '../pitwall/TelemetryChart';
import type { SectorBoundaryMarkers } from '../pitwall/TelemetryChart';
import type { TelemetryPoint } from '../../types/telemetry';

interface EnhancedInputsChartProps {
  bestLapPoints: TelemetryPoint[] | null;
  currentLapPoints: TelemetryPoint[] | null;
  sectorBoundaries?: SectorBoundaryMarkers;
  height?: number;
}

export function EnhancedInputsChart({
  bestLapPoints,
  currentLapPoints,
  sectorBoundaries,
  height = 250,
}: EnhancedInputsChartProps) {
  const data = useMemo<AlignedData>(() => {
    const distanceSet = new Set<number>();
    if (bestLapPoints) bestLapPoints.forEach(p => distanceSet.add(Math.round(p.lapDistance)));
    if (currentLapPoints) currentLapPoints.forEach(p => distanceSet.add(Math.round(p.lapDistance)));

    const distances = Array.from(distanceSet).sort((a, b) => a - b);
    if (distances.length === 0) return [[], [], [], [], []];

    const bestThrottleMap = new Map<number, number>();
    const bestBrakeMap = new Map<number, number>();
    const currentThrottleMap = new Map<number, number>();
    const currentBrakeMap = new Map<number, number>();

    if (bestLapPoints) {
      bestLapPoints.forEach(p => {
        const d = Math.round(p.lapDistance);
        bestThrottleMap.set(d, p.throttle * 100);
        bestBrakeMap.set(d, p.brake * 100);
      });
    }
    if (currentLapPoints) {
      currentLapPoints.forEach(p => {
        const d = Math.round(p.lapDistance);
        currentThrottleMap.set(d, p.throttle * 100);
        currentBrakeMap.set(d, p.brake * 100);
      });
    }

    const bestThrottle: (number | null)[] = [];
    const bestBrake: (number | null)[] = [];
    const currentThrottle: (number | null)[] = [];
    const currentBrake: (number | null)[] = [];

    for (const d of distances) {
      bestThrottle.push(bestThrottleMap.get(d) ?? null);
      bestBrake.push(bestBrakeMap.get(d) ?? null);
      currentThrottle.push(currentThrottleMap.get(d) ?? null);
      currentBrake.push(currentBrakeMap.get(d) ?? null);
    }

    return [distances, bestThrottle, bestBrake, currentThrottle, currentBrake];
  }, [bestLapPoints, currentLapPoints]);

  const series = useMemo(() => [
    { label: 'Best Throttle', stroke: 'rgba(0, 255, 0, 0.5)', width: 1 },
    { label: 'Best Brake', stroke: 'rgba(255, 0, 0, 0.5)', width: 1 },
    { label: 'Current Throttle', stroke: 'var(--throttle-color)', width: 2 },
    { label: 'Current Brake', stroke: 'var(--brake-color)', width: 2 },
  ], []);

  const scales = useMemo(() => ({
    x: { time: false },
    y: { auto: false, range: [0, 100] as [number, number] },
  }), []);

  return (
    <TelemetryChart
      title="Throttle / Brake"
      data={data}
      series={series}
      height={height}
      xAxisLabel="Distance (m)"
      yAxisLabel="%"
      scales={scales}
      sectorBoundaries={sectorBoundaries}
    />
  );
}
