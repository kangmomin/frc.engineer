import { create } from 'zustand';
import type {
  PitwallState,
  CarPosition,
  ConnectionState,
  RaceControlNotification,
  RaceSummary,
  FeaturePermissions,
} from '../types/telemetry';

export type ConnectionMode = 'local' | 'remote';

interface TelemetryState {
  // Connection
  connectionState: ConnectionState;
  setConnectionState: (state: ConnectionState) => void;
  connectionMode: ConnectionMode;
  setConnectionMode: (mode: ConnectionMode) => void;
  featurePermissions: FeaturePermissions;
  setFeaturePermissions: (permissions: FeaturePermissions) => void;
  playbackActive: boolean;
  setPlaybackActive: (active: boolean) => void;

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

export const NO_FEATURE_PERMISSIONS: FeaturePermissions = {
  viewERSEstimate: false,
  viewERSActual: false,
  viewAdvancedStrategy: false,
  viewPitStatus: false,
  viewTopSpeed: false,
  viewPlayerDelta: false,
  viewQualifying: false,
  pitwall: false,
  overlay: false,
  setupSupport: false,
};

export const FULL_FEATURE_PERMISSIONS: FeaturePermissions = {
  viewERSEstimate: true,
  viewERSActual: true,
  viewAdvancedStrategy: true,
  viewPitStatus: true,
  viewTopSpeed: true,
  viewPlayerDelta: true,
  viewQualifying: true,
  pitwall: true,
  overlay: true,
  setupSupport: true,
};

export const useTelemetryStore = create<TelemetryState>((set) => ({
  connectionState: 'disconnected',
  setConnectionState: (state) => set({ connectionState: state }),
  connectionMode: 'local',
  setConnectionMode: (mode) => set({ connectionMode: mode }),
  featurePermissions: FULL_FEATURE_PERMISSIONS,
  setFeaturePermissions: (permissions) => set({ featurePermissions: permissions }),
  playbackActive: false,
  setPlaybackActive: (active) => set({ playbackActive: active }),

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
