import { useRef, useMemo, useEffect } from 'react';
import type { PitwallState } from '../types/telemetry';

export interface GapSnapshot {
  lap: number;
  gaps: Map<number, number>; // driverIndex -> gap in ms to player
}

const MAX_LAPS = 20;

export function useGapHistory(pitwallState: PitwallState | null) {
  const historyRef = useRef<GapSnapshot[]>([]);
  const lastLapRef = useRef<number>(0);

  const playerLap = pitwallState?.drivers?.[pitwallState.playerIndex]?.currentLapNum ?? 0;

  // Record gap snapshot on lap change (side effect in useEffect, not useMemo)
  useEffect(() => {
    if (!pitwallState?.drivers?.length || playerLap <= 1) return;
    if (playerLap <= lastLapRef.current) return;

    const player = pitwallState.drivers[pitwallState.playerIndex];
    if (!player) return;

    const sorted = [...pitwallState.drivers]
      .filter(d => d.position > 0)
      .sort((a, b) => a.position - b.position);

    const playerDelta = player.deltaToRaceLeader ?? 0;
    const gaps = new Map<number, number>();
    for (const d of sorted) {
      const gap = (d.deltaToRaceLeader ?? 0) - playerDelta;
      gaps.set(d.index, gap);
    }

    historyRef.current.push({ lap: playerLap - 1, gaps });
    if (historyRef.current.length > MAX_LAPS) {
      historyRef.current.shift();
    }
    lastLapRef.current = playerLap;
  }, [pitwallState, playerLap]);

  // Pure computation: determine nearby drivers
  const nearby = useMemo(() => {
    if (!pitwallState?.drivers?.length) return [];

    const player = pitwallState.drivers[pitwallState.playerIndex];
    if (!player) return [];

    const playerPos = player.position;
    const sorted = [...pitwallState.drivers]
      .filter(d => d.position > 0 && d.index !== player.index)
      .sort((a, b) => a.position - b.position);

    const ahead = sorted.filter(d => d.position < playerPos).slice(-3);
    const behind = sorted.filter(d => d.position > playerPos).slice(0, 2);
    return [...ahead, ...behind];
  }, [pitwallState]);

  return { history: historyRef.current, nearby };
}
