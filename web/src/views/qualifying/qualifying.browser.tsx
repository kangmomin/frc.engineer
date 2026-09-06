import { createRoot } from 'react-dom/client';
import { QualifyingView } from './QualifyingView';
import { BroadcastView } from '../broadcast/BroadcastView';
import { PitWallView } from '../pitwall/PitWallView';
import { useTelemetryStore } from '../../store/telemetryStore';
import { startRaceMetaTracker, useRaceMetaStore } from '../../store/raceMetaStore';
import { startLapHistoryTracker, useLapHistoryStore } from '../../store/lapHistoryStore';
import { startReplayDerivedTracker, useDisplayedLapHistory, useDisplayedRaceMeta, useReplayDerivedStore } from '../../store/replayDerivedStore';
import type { DriverInfo, PitwallState, ReplayFrame } from '../../types/telemetry';
import type { ShellControls } from '../../shell/types';

const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 25));
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function until(predicate: () => boolean, message: string) {
  const deadline = Date.now() + 3000;
  while (!predicate()) { check(Date.now() < deadline, message); await pause(); }
}
const controls: ShellControls = {
  view: 'qualifying', onNavigate() {}, onOpenRooms() {}, onOpenArchive() {},
  onOpenSetup() {}, onGoHome() {}, onReconnect() {},
};
function driver(values: Partial<DriverInfo> = {}): DriverInfo {
  return {
    index: 0, name: 'Alpha', teamId: 0, aiControlled: false, position: 1, currentLapNum: 1,
    speed: 100, topSpeed: 100, throttle: 0, brake: 0, gear: 1, steering: 0, drsActivated: false,
    lastLapTime: 0, bestLapTime: 0, tireCompound: 'soft', tireAge: 0, tireWear: [], tireSurfaceTemp: [], tireInnerTemp: [], brakeTemp: [],
    brakeBias: 55, diffOnThrottle: 0, diffOffThrottle: 0, fuelInTank: 10, fuelRemainingLaps: 5, fuelMix: 1,
    ersStoreEnergy: 0, ersDeployMode: 0, ersDeployedThisLap: 0, ersHarvestedThisLap: 0, ersEstimateReady: false, ersActualReady: false,
    penalties: 0, totalWarnings: 0, cornerCuttingWarnings: 0, numUnservedDriveThroughs: 0, numUnservedStopGoPenalties: 0,
    lapInvalid: false, pitStatus: 0, driverStatus: 1, resultStatus: 2, numPitStops: 0, lapDistance: 0, pitStopTimer: 0,
    sector1TimeMs: 0, sector2TimeMs: 0, currentSector: 0, ...values,
  };
}
function state(drivers: DriverInfo[], sessionType = 'Q1', uid = '100'): PitwallState {
  return {
    sessionUid: uid, session: { sessionUid: uid, formula: 13, qualifyingGridSize: 22,
      weather: 'clear', trackTemp: 30, airTemp: 25, safetyCar: 'none', sessionType, totalLaps: 20,
      sessionTimeLeft: 600, sessionDuration: 1080, trackId: 0, trackName: 'Australia', trackLength: 5000 },
    drivers, positions: [], playerIndex: drivers[0]?.index ?? -1, gameFormat: 2026, ersEstimateEnabled: false, ersComparisonEnabled: false,
  };
}

export async function run() {
  function DerivedProbe() {
    const history = useDisplayedLapHistory((s) => s.history);
    const grid = useDisplayedRaceMeta((s) => s.grid);
    const sectors = useReplayDerivedStore((s) => s.sectors);
    return <output id="derived">{JSON.stringify({ history: [...history], grid, sectors: [...sectors] })}</output>;
  }

  startRaceMetaTracker(); startLapHistoryTracker(); startReplayDerivedTracker();
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  const store = useTelemetryStore.getState(); store.resetRoom();
  const feed = async (frame: PitwallState) => { store.setPitwallState(frame); await pause(); };
  const row = () => container.querySelector('[role="rowgroup"] [role="row"]');
  const cells = () => row()?.querySelectorAll('[role="cell"]');
  try {
    root.render(<><QualifyingView controls={controls} /><DerivedProbe /></>);
    // An invalid/unverified last lap may appear in Last Lap, never in Best Lap.
    await feed(state([driver({ lastLapTime: 80000, lapInvalid: true })]));
    await until(() => !!cells(), 'Qualifying view did not mount.');
    check(cells()![2].textContent === '--:--.---', 'Invalid last lap became a qualifying best.');
    // Official history replaces a lower provisional sector, then can clear it.
    await feed(state([driver({ sector1TimeMs: 20000, sector2TimeMs: 25000 })], 'Q1', '101'));
    await feed(state([driver({ currentLapNum: 2, lastLapTime: 80000 })], 'Q1', '101'));
    await until(() => cells()![4].textContent === '20.000', 'Completed provisional sector was not displayed.');
    await feed(state([driver({ currentLapNum: 2, sessionHistoryAvailable: true, bestSector1Ms: 30000, bestSector2Ms: 31000, bestSector3Ms: 32000 })], 'Q1', '101'));
    await until(() => cells()![4].textContent === '30.000', 'Official sector did not correct a provisional best.');
    await feed(state([driver({ currentLapNum: 2, sessionHistoryAvailable: true })], 'Q1', '101'));
    await until(() => cells()![4].textContent === '—', 'Official empty sector did not clear the previous record.');
    // Real hook effects: Q1 -> Q2, lap 2 -> 1, and player changes clear attempts.
    await feed(state([driver({ pitStatus: 1 })], 'Q1', '102'));
    await feed(state([driver()], 'Q1', '102'));
    await until(() => container.textContent!.includes('OUT'), 'Pit exit did not start the attempt.');
    await feed(state([driver({ currentLapNum: 2 })], 'Q1', '102'));
    await until(() => container.textContent!.includes('FLYING'), 'Lap boundary did not start flying.');
    await feed(state([driver({ currentLapNum: 2 })], 'Q2', '102'));
    check(!container.textContent!.includes('FLYING'), 'Q1 attempt leaked into Q2.');
    await feed(state([driver({ currentLapNum: 2, pitStatus: 1 })], 'Q2', '102'));
    await feed(state([driver({ currentLapNum: 2 })], 'Q2', '102'));
    await until(() => container.textContent!.includes('OUT'), 'Second attempt did not start.');
    await feed(state([driver()], 'Q2', '102'));
    check(!container.textContent!.includes('OUT'), 'Lap 2 -> 1 retained an attempt.');
    await feed(state([driver({ pitStatus: 1 })], 'Q2', '102'));
    await feed(state([driver()], 'Q2', '102'));
    await feed(state([driver({ index: 1, name: 'Bravo' })], 'Q2', '102'));
    check(!container.textContent!.includes('OUT'), 'Another player inherited an attempt.');
    // 22-entry Q1: P17 must beat P16; ties need 1 ms.
    const field = Array.from({ length: 22 }, (_, i) => driver({ index: i, name: `Car ${i}`, position: i + 1, bestLapTime: 90000 + i * 100 }));
    field[16].bestLapTime = field[15].bestLapTime;
    const cutoff = state(field); cutoff.playerIndex = 16;
    await feed(cutoff);
    await until(() => container.textContent!.includes('Need 0.001s'), 'Cutoff tie or target is incorrect.');
    check(container.textContent!.includes('Top 16 advance'), '22-entry format was not displayed.');
    // Derived display switches stores, consumes seek prefixes, and prunes same-lap rewinds.
    await feed(state([driver({ position: 3 })], 'Race', 'live'));
    await feed(state([driver({ currentLapNum: 2, lastLapTime: 99000 })], 'Race', 'live'));
    const liveHistory = useLapHistoryStore.getState().history;
    const liveGrid = useRaceMetaStore.getState().grid;
    const frames: ReplayFrame[] = [
      { timestamp: 1, pitwall: state([driver({ position: 9, sector1TimeMs: 30000, sector2TimeMs: 30000 })], 'Race', 'archive') },
      { timestamp: 2, pitwall: state([driver({ position: 8, currentLapNum: 2, lastLapTime: 90000 })], 'Race', 'archive') },
      { timestamp: 3, pitwall: state([driver({ position: 8, currentLapNum: 2, lastLapTime: 91000 })], 'Race', 'archive') },
    ];
    store.setPlaybackActive(true);
    const seek = async (index: number, sourceId = 'A', sourceFrames = frames) => {
      store.applyReplayFrame(sourceFrames[index], { sourceId, frames: sourceFrames, index }); await pause();
    };
    await seek(2);
    let displayed = JSON.parse(container.querySelector('#derived')!.textContent!);
    check(displayed.history[0][1].length === 2 && displayed.grid['0'] === 9, 'Forward seek omitted history prefix or used the live grid.');
    await seek(1);
    displayed = JSON.parse(container.querySelector('#derived')!.textContent!);
    check(displayed.history[0][1].length === 1, 'Same-lap rewind retained a future record.');
    await seek(0, 'B', [{ timestamp: 4, pitwall: state([driver({ position: 5 })], 'Race', 'archive') }]);
    displayed = JSON.parse(container.querySelector('#derived')!.textContent!);
    check(displayed.history.length === 0 && displayed.grid['0'] === 5, 'Archive B inherited archive A history.');
    store.setPlaybackActive(false); await pause();
    check(useLapHistoryStore.getState().history === liveHistory && useRaceMetaStore.getState().grid === liveGrid, 'Replay mutated live derived stores.');
    displayed = JSON.parse(container.querySelector('#derived')!.textContent!);
    check(displayed.history[0][1][0].lapMs === 99000 && displayed.grid['0'] === 3, 'Leaving replay did not restore live derived display.');

    // Actual view-local battle/modal state must also distinguish independent
    // live/replay epochs, even when track, UID and driver indices are identical.
    const request = async <T,>(): Promise<T> => { throw new Error('No strategy fixture'); };
    root.render(<><BroadcastView controls={controls} /><PitWallView controls={controls} request={request} /></>);
    const battleFrame = (gap: number) => state([
      driver({ name: 'Defender', lastLapTime: 90000 }),
      driver({ index: 1, name: 'Attacker', position: 2, lastLapTime: 90000, deltaToCarInFront: gap }),
    ], 'Race', 'shared-uid');
    await feed(battleFrame(900));
    await until(() => container.textContent!.includes('Building read'), 'Battle view did not mount.');
    await new Promise<void>((resolve) => setTimeout(resolve, 4200));
    await feed(battleFrame(500));
    await until(() => /Closing [\d.]+s\/lap/.test(container.textContent!), 'Live battle baseline was not established.');
    const openDetail = async () => {
      const button = container.querySelector<HTMLButtonElement>('button[aria-label="Open Attacker detail"]');
      check(button, 'Driver detail button is missing.'); button.click();
      await until(() => !!container.querySelector('[role="dialog"]'), 'Driver detail did not open.');
    };
    await openDetail();
    const replayBattle: ReplayFrame[] = [{ timestamp: 1000, pitwall: battleFrame(700) }];
    store.setPlaybackActive(true);
    await seek(0, 'battle-A', replayBattle);
    await until(() => container.textContent!.includes('Building read'), 'Replay inherited the live battle baseline.');
    check(!/Closing [\d.]+s\/lap/.test(container.textContent!), 'Replay kept a live battle rate.');
    check(!container.querySelector('[role="dialog"]'), 'Live driver detail remained open in replay.');
    await openDetail();
    await seek(0, 'battle-B', replayBattle);
    check(!container.querySelector('[role="dialog"]'), 'Archive B retained archive A driver detail.');
    store.setPlaybackActive(false); await pause();
    check(container.textContent!.includes('Building read'), 'Leaving replay inherited a replay battle baseline.');
    return 'Qualifying/replay Chrome: invalid best, official sectors, identity resets, 22-car cutoff, replay prefix/isolation and actual Broadcast/Pitwall source switches passed.';
  } finally { root.unmount(); container.remove(); store.resetRoom(); }
}
