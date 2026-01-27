import { useRef, useEffect, useCallback } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

export interface ChartSeries {
  label: string;
  stroke: string;
  width?: number;
  scale?: string;
  fill?: string;
}

export interface TelemetryChartProps {
  title: string;
  data: uPlot.AlignedData;
  series: ChartSeries[];
  height?: number;
  xAxisLabel?: string;
  yAxisLabel?: string;
  scales?: uPlot.Options['scales'];
  axes?: uPlot.Options['axes'];
}

export function TelemetryChart({
  title,
  data,
  series,
  height = 200,
  xAxisLabel = 'Distance (m)',
  yAxisLabel,
  scales,
  axes,
}: TelemetryChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<uPlot | null>(null);

  // Responsive resize handler
  const handleResize = useCallback(() => {
    if (!containerRef.current || !chartRef.current) return;
    const width = containerRef.current.clientWidth;
    chartRef.current.setSize({ width, height });
  }, [height]);

  useEffect(() => {
    if (!containerRef.current) return;

    const width = containerRef.current.clientWidth;

    const defaultScales: uPlot.Options['scales'] = {
      x: { time: false },
      y: { auto: true },
    };

    const defaultAxes: uPlot.Options['axes'] = [
      {
        label: xAxisLabel,
        stroke: '#888',
        grid: { stroke: 'rgba(255,255,255,0.1)' },
        ticks: { stroke: 'rgba(255,255,255,0.2)' },
      },
      {
        label: yAxisLabel,
        stroke: '#888',
        grid: { stroke: 'rgba(255,255,255,0.1)' },
        ticks: { stroke: 'rgba(255,255,255,0.2)' },
        scale: 'y',
      },
    ];

    const uplotSeries: uPlot.Series[] = [
      { label: xAxisLabel }, // X-axis series
      ...series.map((s) => ({
        label: s.label,
        stroke: s.stroke,
        width: s.width || 2,
        scale: s.scale || 'y',
        fill: s.fill,
      })),
    ];

    const opts: uPlot.Options = {
      title,
      width,
      height,
      scales: scales || defaultScales,
      axes: axes || defaultAxes,
      series: uplotSeries,
      legend: { show: true },
      cursor: {
        drag: { x: false, y: false },
        sync: { key: 'telemetry' },
      },
    };

    chartRef.current = new uPlot(opts, data, containerRef.current);

    // Add resize listener
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [title, series, height, xAxisLabel, yAxisLabel, scales, axes, handleResize]);

  // Update data when it changes
  useEffect(() => {
    if (chartRef.current && data && data.length > 0 && data[0].length > 0) {
      chartRef.current.setData(data);
    }
  }, [data]);

  return (
    <div
      ref={containerRef}
      className="telemetry-chart"
      style={{
        width: '100%',
        minHeight: height,
        backgroundColor: 'var(--bg-panel)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--spacing-sm)',
      }}
    />
  );
}
