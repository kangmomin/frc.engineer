import { create } from 'zustand';
import type {
  PitwallState,
  CarPosition,
  ConnectionState,
  RaceControlNotification,
  RaceSummary,
} from '../types/telemetry';

export type ConnectionMode = 'local' | 'remote';

interface TelemetryState {
  // Connection
  connectionState: ConnectionState;
  setConnectionState: (state: ConnectionState) => void;
  connectionMode: ConnectionMode;
  setConnectionMode: (mode: ConnectionMode) => void;
  playbackActive: boolean;
  setPlaybackActive: (active: boolean) => void;
  /** Explicit sender-room boundary; transient reconnects keep the same generation. */
  roomGeneration: number;
  resetRoom: () => void;

  // Telemetry core
  pitwallState: PitwallState | null;
  setPitwallState: (state: PitwallState | null) => void;
  updatePositions: (positions: CarPosition[]) => void;
  applyReplayFrame: (frame: {
    pitwall: PitwallState;
    raceControl?: RaceControlNotification[];
  }) => void;

  // Events & Notifications
  raceControlNotifications: RaceControlNotification[];
  addRaceControlNotification: (notification: RaceControlNotification) => void;
  setRaceControlNotifications: (notifications: RaceControlNotification[]) => void;

  // Race result
  raceResult: RaceSummary | null;
  setRaceResult: (result: RaceSummary) => void;
  clearRaceResult: () => void;

  // Actions
  clearNotifications: () => void;
}

const MAX_NOTIFICATIONS = 50;

// 리플레이 진입(false→true) 시점의 라이브 상태 스냅샷 — 재생 종료 시 복원해
// 리플레이 프레임이 라이브 상태를 오염시키지 않도록 한다.
let liveSnapshot: {
  pitwallState: PitwallState | null;
  raceControlNotifications: RaceControlNotification[];
} | null = null;

export const useTelemetryStore = create<TelemetryState>((set) => ({
  connectionState: 'disconnected',
  setConnectionState: (state) => set({ connectionState: state }),
  connectionMode: 'local',
  setConnectionMode: (mode) => set({ connectionMode: mode }),
  playbackActive: false,
  roomGeneration: 0,
  resetRoom: () => {
    liveSnapshot = null;
    set((state) => ({
      roomGeneration: state.roomGeneration + 1,
      connectionState: 'disconnected',
      playbackActive: false,
      pitwallState: null,
      raceControlNotifications: [],
      raceResult: null,
    }));
  },
  setPlaybackActive: (active) =>
    set((state) => {
      // 프레임마다 발화하는 중복 호출 무시 — 전이 시점에만 스냅샷/복원
      if (active === state.playbackActive) return state;
      if (active) {
        liveSnapshot = {
          pitwallState: state.pitwallState,
          raceControlNotifications: state.raceControlNotifications,
        };
        return { playbackActive: true };
      }
      const restored = liveSnapshot;
      liveSnapshot = null;
      if (!restored) return { playbackActive: false };
      return {
        playbackActive: false,
        pitwallState: restored.pitwallState,
        raceControlNotifications: restored.raceControlNotifications,
      };
    }),

  pitwallState: null,
  setPitwallState: (state) => set({ pitwallState: state }),
  updatePositions: (positions) =>
    set((state) => {
      if (!state.pitwallState) return state;
      return { pitwallState: { ...state.pitwallState, positions } };
    }),
  applyReplayFrame: (frame) =>
    set({
      pitwallState: frame.pitwall,
      raceControlNotifications: frame.raceControl ?? [],
    }),

  raceControlNotifications: [],
  addRaceControlNotification: (notification) =>
    set((state) => {
      if (state.raceControlNotifications.some((n) => n.id === notification.id)) {
        return state;
      }
      const updated = [notification, ...state.raceControlNotifications];
      return { raceControlNotifications: updated.slice(0, MAX_NOTIFICATIONS) };
    }),
  setRaceControlNotifications: (notifications) =>
    set({ raceControlNotifications: notifications.slice(0, MAX_NOTIFICATIONS) }),

  raceResult: null,
  setRaceResult: (result) => set({ raceResult: result }),
  clearRaceResult: () => set({ raceResult: null }),

  clearNotifications: () =>
    set({
      raceControlNotifications: [],
    }),
}));
