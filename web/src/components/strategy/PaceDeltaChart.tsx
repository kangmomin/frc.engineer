import { useEffect, useRef, useState, useMemo } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { useTelemetryStore } from '../../store/telemetryStore';
import styles from './PaceDeltaChart.module.css';

interface GapPoint {
  lap: number;
  gap: number;
}

export function PaceDeltaChart() {
  const pitwallState = useTelemetryStore((state) => state.pitwallState);
  const [history, setHistory] = useState<GapPoint[]>([]);
  const chartRef = useRef<HTMLDivElement>(null);
  const uPlotRef = useRef<uPlot>();
  const lastProcessedLap = useRef<number>(-1);

  // Track the gap at the end of each lap
  useEffect(() => {
    if (!pitwallState) return;

    const player = pitwallState.drivers[pitwallState.playerIndex];
    if (!player) return;

    // Check if a lap has been completed
    if (player.currentLapNum > lastProcessedLap.current && player.currentLapNum > 1) {
      const ahead = pitwallState.drivers.find(d => d.position === player.position - 1);
      if (ahead) {
        // Gap to car ahead at the moment of crossing the line (or close enough)
        // We use the deltaToCarInFront which is provided by the game
        const currentGap = (ahead.deltaToCarInFront ?? 0) / 1000;
        
        setHistory(prev => {
          const newHistory = [...prev, { lap: player.currentLapNum - 1, gap: currentGap }];
          return newHistory.slice(-10); // Keep last 10 laps
        });
        
        lastProcessedLap.current = player.currentLapNum;
      }
    }
  }, [pitwallState]);

  // Chart data formatting
  const chartData = useMemo(() => {
    if (history.length < 2) return null;
    return [
      history.map(p => p.lap),
      history.map(p => p.gap)
    ] as uPlot.AlignedData;
  }, [history]);

  // Initialize and update uPlot
  useEffect(() => {
    if (!chartRef.current || !chartData) return;

    if (!uPlotRef.current) {
      const opts: uPlot.Options = {
        width: chartRef.current.clientWidth,
        height: 250,
        title: "GAP TREND (LAST 10 LAPS)",
        scales: {
          x: { time: false },
          y: { range: (_u, _min, max) => [0, max * 1.1] }
        },
        series: [
          {},
          {
            label: "Gap (s)",
            stroke: (u) => {
              const data = u.data[1] as number[];
              if (data.length < 2) return "#4caf50";
              // If last gap is smaller than previous, it's green (catching)
              return data[data.length - 1] < data[data.length - 2] ? "#4caf50" : "#f44336";
            },
            width: 3,
            fill: "rgba(255, 255, 255, 0.05)",
            points: { show: true, size: 8, stroke: "#fff", width: 2 }
          }
        ],
        axes: [
          { stroke: "#666", grid: { stroke: "#333" }, label: "LAP" },
          { stroke: "#666", grid: { stroke: "#333" }, label: "GAP (S)" }
        ],
        cursor: { show: true },
        legend: { show: false }
      };

      uPlotRef.current = new uPlot(opts, chartData, chartRef.current);
    } else {
      uPlotRef.current.setData(chartData);
    }

    return () => {
      if (uPlotRef.current) {
        uPlotRef.current.destroy();
        uPlotRef.current = undefined;
      }
    };
  }, [chartData]);

  // Handle resize
  useEffect(() => {
    const handleResize = () => {
      if (uPlotRef.current && chartRef.current) {
        uPlotRef.current.setSize({
          width: chartRef.current.clientWidth,
          height: 250
        });
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  if (history.length < 2) {
    return (
      <div className={styles.container}>
        <div className={styles.sectionHeader}>📉 PACE DELTA TREND</div>
        <div className={styles.placeholder}>
          Waiting for more lap data... ({history.length}/2)
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.sectionHeader}>📉 PACE DELTA TREND</div>
      <div ref={chartRef} className={styles.chart} />
      <div className={styles.legend}>
        <span className={styles.catching}>GREEN = CATCHING</span>
        <span className={styles.falling}>RED = FALLING BACK</span>
      </div>
    </div>
  );
}
