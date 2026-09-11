import { useMemo } from 'react';
import type { DriverInfo } from '../types/telemetry';

export interface TrackGap {
  available: boolean;
  gapAheadM: number | null;
  gapBehindM: number | null;
  aheadDriver: DriverInfo | null;
  behindDriver: DriverInfo | null;
}

const EMPTY_GAP: TrackGap = {
  available: false,
  gapAheadM: null,
  gapBehindM: null,
  aheadDriver: null,
  behindDriver: null,
};

export function deriveTrackGaps(
  drivers: DriverInfo[],
  trackLength: number,
  focusDriverIndex: number,
): TrackGap {
  if (!Number.isFinite(trackLength) || trackLength <= 0) return EMPTY_GAP;

  const onTrack = drivers.filter((d) => {
    const status = d.driverStatus ?? 0;
    const result = d.resultStatus ?? 0;
    // Qualifying sends garage as an omitted driverStatus. Older senders also
    // omitted resultStatus for active cars, so keep 0 only with an on-track status.
    return d.pitStatus === 0 && status >= 1 && status <= 4
      && (result === 0 || result === 2 || result === 3)
      && Number.isFinite(d.lapDistance);
  });

  // The UDP distance can be negative before the first line crossing. Normalize
  // before sorting so these cars retain their actual place around the circuit.
  const distance = (driver: DriverInfo) => ((driver.lapDistance % trackLength) + trackLength) % trackLength;
  const sorted = onTrack.sort((a, b) => distance(a) - distance(b) || a.index - b.index);
  const focusIdx = sorted.findIndex((d) => d.index === focusDriverIndex);
  if (focusIdx === -1) return EMPTY_GAP;
  if (sorted.length === 1) return { ...EMPTY_GAP, available: true };

  const focus = sorted[focusIdx];
  const ahead = sorted[(focusIdx + 1) % sorted.length];
  const behind = sorted[(focusIdx - 1 + sorted.length) % sorted.length];

  return {
    available: true,
    gapAheadM: (distance(ahead) - distance(focus) + trackLength) % trackLength,
    gapBehindM: (distance(focus) - distance(behind) + trackLength) % trackLength,
    aheadDriver: ahead,
    behindDriver: behind,
  };
}

export function useTrackGaps(
  drivers: DriverInfo[],
  trackLength: number,
  focusDriverIndex: number,
): TrackGap {
  return useMemo(() => deriveTrackGaps(drivers, trackLength, focusDriverIndex), [drivers, trackLength, focusDriverIndex]);
}
