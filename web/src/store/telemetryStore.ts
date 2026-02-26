import { create } from 'zustand';
import type { PitwallState, ConnectionState, RaceControlNotification, BattleAlert } from '../types/telemetry';

interface TelemetryState {
  // Connection
  connectionState: ConnectionState;
  setConnectionState: (state: ConnectionState) => void;
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

  // Actions
  clearNotifications: () => void;
}

const MAX_NOTIFICATIONS = 50;
const MAX_BATTLE_ALERTS = 10;

export const useTelemetryStore = create<TelemetryState>((set) => ({
  connectionState: 'disconnected',
  setConnectionState: (state) => set({ connectionState: state }),
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

  clearNotifications: () =>
    set({
      raceControlNotifications: [],
      battleAlerts: [],
    }),
}));
