import { create } from 'zustand';
import type {
  PitwallState,
  ConnectionState,
  RaceControlNotification,
  BattleAlert,
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
  applyReplayFrame: (frame: {
    pitwall: PitwallState;
    raceControl?: RaceControlNotification[];
    battleAlerts?: BattleAlert[];
  }) => void;

  // Events & Notifications
  raceControlNotifications: RaceControlNotification[];
  addRaceControlNotification: (notification: RaceControlNotification) => void;
  setRaceControlNotifications: (notifications: RaceControlNotification[]) => void;

  battleAlerts: BattleAlert[];
  addBattleAlert: (alert: BattleAlert) => void;
  setBattleAlerts: (alerts: BattleAlert[]) => void;

  // Race result
  raceResult: RaceSummary | null;
  setRaceResult: (result: RaceSummary) => void;
  clearRaceResult: () => void;

  // Actions
  clearNotifications: () => void;
}

const MAX_NOTIFICATIONS = 50;
const MAX_BATTLE_ALERTS = 10;

export const NO_FEATURE_PERMISSIONS: FeaturePermissions = {
  viewERSActual: false,
  viewAdvancedStrategy: false,
  viewPitStatus: false,
  viewTopSpeed: false,
  viewPlayerDelta: false,
  viewCommentary: false,
};

export const FULL_FEATURE_PERMISSIONS: FeaturePermissions = {
  viewERSActual: true,
  viewAdvancedStrategy: true,
  viewPitStatus: true,
  viewTopSpeed: true,
  viewPlayerDelta: true,
  viewCommentary: true,
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
  applyReplayFrame: (frame) =>
    set({
      pitwallState: frame.pitwall,
      raceControlNotifications: frame.raceControl ?? [],
      battleAlerts: frame.battleAlerts ?? [],
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

  battleAlerts: [],
  addBattleAlert: (alert) =>
    set((state) => {
      const updated = [alert, ...state.battleAlerts];
      return { battleAlerts: updated.slice(0, MAX_BATTLE_ALERTS) };
    }),
  setBattleAlerts: (alerts) =>
    set({ battleAlerts: alerts.slice(0, MAX_BATTLE_ALERTS) }),

  raceResult: null,
  setRaceResult: (result) => set({ raceResult: result }),
  clearRaceResult: () => set({ raceResult: null }),

  clearNotifications: () =>
    set({
      raceControlNotifications: [],
      battleAlerts: [],
    }),
}));
