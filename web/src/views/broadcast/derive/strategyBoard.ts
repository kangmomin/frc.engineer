import type { SessionInfo } from '../../../types/telemetry';

export interface StrategyCrossover {
  dryGroup: string;
  wetGroup: string;
  deltaMs: number;
  trendMsPerLap: number;
}

export interface StrategyBoard {
  rejoinPosition: number | null;
  windowIdealLap: number | null;
  windowLatestLap: number | null;
  crossover: StrategyCrossover | null;
}

/**
 * Strategy / Pit Window 패널의 실데이터 파생 (예측/조작 없음).
 * 게임이 직접 제공하는 pitStopRejoinPosition / pitStopWindow* / crossoverPrediction만 읽는다.
 */
export function deriveStrategyBoard(session: SessionInfo | null): StrategyBoard {
  const cp = session?.crossoverPrediction;

  return {
    rejoinPosition: session?.pitStopRejoinPosition ?? null,
    windowIdealLap: session?.pitStopWindowIdealLap ?? null,
    windowLatestLap: session?.pitStopWindowLatestLap ?? null,
    crossover: cp?.available
      ? {
          dryGroup: cp.dryGroup,
          wetGroup: cp.wetGroup,
          deltaMs: cp.currentDeltaMs,
          trendMsPerLap: cp.trendDeltaMsPerLap,
        }
      : null,
  };
}
