import { useMemo } from 'react';
import type { DriverInfo } from '../types/telemetry';

export interface TrackGap {
  gapAheadM: number | null;
  gapBehindM: number | null;
  aheadDriver: DriverInfo | null;
  behindDriver: DriverInfo | null;
}

const EMPTY_GAP: TrackGap = {
  gapAheadM: null,
  gapBehindM: null,
  aheadDriver: null,
  behindDriver: null,
};

export function useTrackGaps(
  drivers: DriverInfo[],
  trackLength: number,
  focusDriverIndex: number,
): TrackGap {
  return useMemo(() => {
    if (trackLength <= 0 || drivers.length === 0) return EMPTY_GAP;

    // Filter out cars in pit
    const onTrack = drivers.filter((d) => d.pitStatus === 0 && d.lapDistance >= 0);
    if (onTrack.length < 2) return EMPTY_GAP;

    // Sort by lapDistance ascending
    const sorted = [...onTrack].sort((a, b) => a.lapDistance - b.lapDistance);
    const focusIdx = sorted.findIndex((d) => d.index === focusDriverIndex);
    if (focusIdx === -1) return EMPTY_GAP;

    const focus = sorted[focusIdx];
    const n = sorted.length;

    // Car ahead on track = next higher lapDistance (with wrap)
    const aheadIdx = (focusIdx + 1) % n;
    const ahead = sorted[aheadIdx];
    const gapAheadM = aheadIdx !== focusIdx
      ? (ahead.lapDistance - focus.lapDistance + trackLength) % trackLength
      : null;

    // Car behind on track = previous lower lapDistance (with wrap)
    const behindIdx = (focusIdx - 1 + n) % n;
    const behind = sorted[behindIdx];
    const gapBehindM = behindIdx !== focusIdx
      ? (focus.lapDistance - behind.lapDistance + trackLength) % trackLength
      : null;

    return {
      gapAheadM,
      gapBehindM,
      aheadDriver: aheadIdx !== focusIdx ? ahead : null,
      behindDriver: behindIdx !== focusIdx ? behind : null,
    };
  }, [drivers, trackLength, focusDriverIndex]);
}
