export interface ReplayTrackReference {
  trackId: number;
  gameFormat: string;
  trackLength: number;
  points: Array<[number, number, number]>; // measured lap distance, world X, world Z
}

const references = import.meta.glob<ReplayTrackReference>('./replayTracks/*.json', { import: 'default' });

export async function loadReplayTrack(trackId: number | undefined, gameFormat: string | undefined): Promise<ReplayTrackReference | null> {
  const year = gameFormat === 'F1 26' ? 2026 : gameFormat === 'F1 25' ? 2025 : null;
  const load = year === null ? undefined : references[`./replayTracks/${trackId}-${year}.json`];
  return load ? load() : null;
}
