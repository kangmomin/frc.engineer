import { create, useStore } from 'zustand';
import { createSectorAccumulator, type SectorAcc } from '../components/qualifying/sectorAccumulator';
import { createLapHistoryIngestor, useLapHistoryStore, type LapHistoryState } from './lapHistoryStore';
import { createRaceMetaStore, useRaceMetaStore, type RaceMetaState } from './raceMetaStore';
import { sessionIdentity } from './sessionIdentity';
import { useTelemetryStore, type ReplayContext } from './telemetryStore';

export const replayRaceMetaStore = createRaceMetaStore();
export const replayLapHistoryStore = create<LapHistoryState>(() => ({ history: new Map() }));
export const useReplayDerivedStore = create<{ generation: number; sectors: Map<number, SectorAcc> }>(() => ({
  generation: 0, sectors: new Map(),
}));

export function useDisplayedRaceMeta<T>(selector: (state: RaceMetaState) => T): T {
  const playback = useTelemetryStore((state) => state.playbackActive);
  return useStore(playback ? replayRaceMetaStore : useRaceMetaStore, selector);
}

export function useDisplayedLapHistory<T>(selector: (state: LapHistoryState) => T): T {
  const playback = useTelemetryStore((state) => state.playbackActive);
  return useStore(playback ? replayLapHistoryStore : useLapHistoryStore, selector);
}

/** Local view state must distinguish independent live/replay epochs as well. */
export function useDisplayedSourceKey(): string {
  const generation = useReplayDerivedStore((state) => state.generation);
  const epoch = useDisplayedRaceMeta((state) => state.epoch);
  return useTelemetryStore((state) => JSON.stringify([
    state.roomGeneration,
    sessionIdentity(state.pitwallState?.session, state.pitwallState?.sessionUid),
    state.playbackActive ? ['replay', state.replayContext?.sourceId, generation] : ['live'],
    epoch,
  ]));
}

let started = false;

/** Replay derivations have their own provenance. Forward seeks ingest every
 * skipped frame; archive switches and any index rewind rebuild the prefix.
 * Live stores are neither mutated nor used as a fallback for missing history. */
export function startReplayDerivedTracker(): void {
  if (started) return;
  started = true;
  let previous: ReplayContext | null = null;
  let laps = createLapHistoryIngestor();
  let sectors = createSectorAccumulator();
  const reset = () => {
    previous = null;
    laps = createLapHistoryIngestor();
    sectors = createSectorAccumulator();
    replayRaceMetaStore.setState((state) => ({ ...replayRaceMetaStore.getInitialState(), epoch: state.epoch + 1 }));
    replayLapHistoryStore.setState({ history: new Map() });
    useReplayDerivedStore.setState((state) => ({ generation: state.generation + 1, sectors: new Map() }));
  };
  const run = () => {
    const { playbackActive, replayContext: context } = useTelemetryStore.getState();
    if (!playbackActive || !context) {
      if (previous) reset();
      return;
    }
    if (!previous || previous.sourceId !== context.sourceId || previous.frames !== context.frames || context.index < previous.index) reset();
    let history = replayLapHistoryStore.getState().history;
    let sectorMap = useReplayDerivedStore.getState().sectors;
    for (let i = (previous?.index ?? -1) + 1; i <= context.index && i < context.frames.length; i++) {
      const frame = context.frames[i];
      const { session, drivers, sessionUid } = frame.pitwall;
      replayRaceMetaStore.getState().ingest(session, drivers, frame.raceControl ?? [], sessionUid);
      const key = `${sessionIdentity(session, sessionUid)}|${replayRaceMetaStore.getState().epoch}`;
      history = laps.ingest(drivers, key, history) ?? history;
      sectorMap = sectors.ingest(drivers, key);
    }
    previous = context;
    replayLapHistoryStore.setState({ history });
    useReplayDerivedStore.setState({ sectors: sectorMap });
  };
  useTelemetryStore.subscribe(run);
  run();
}
