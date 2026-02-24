import { create } from 'zustand';
import type { PitwallState, ConnectionState, RaceControlNotification, BattleAlert } from '../types/telemetry';

interface TelemetryState {
  // Connection
  connectionState: ConnectionState;
  setConnectionState: (state: ConnectionState) => void;

  // Telemetry core
  pitwallState: PitwallState | null;
  setPitwallState: (state: PitwallState | null) => void;

  // Events & Notifications
  raceControlNotifications: RaceControlNotification[];
  addRaceControlNotification: (notification: RaceControlNotification) => void;

  battleAlerts: BattleAlert[];
  addBattleAlert: (alert: BattleAlert) => void;

  // Actions
  clearNotifications: () => void;
}

const MAX_NOTIFICATIONS = 50;
const MAX_BATTLE_ALERTS = 10;

export const useTelemetryStore = create<TelemetryState>((set) => ({
  connectionState: 'disconnected',
  setConnectionState: (state) => set({ connectionState: state }),

  pitwallState: null,
  setPitwallState: (state) => set({ pitwallState: state }),

  raceControlNotifications: [],
  addRaceControlNotification: (notification) =>
    set((state) => {
      const updated = [notification, ...state.raceControlNotifications];
      return { raceControlNotifications: updated.slice(0, MAX_NOTIFICATIONS) };
    }),

  battleAlerts: [],
  addBattleAlert: (alert) =>
    set((state) => {
      const updated = [alert, ...state.battleAlerts];
      return { battleAlerts: updated.slice(0, MAX_BATTLE_ALERTS) };
    }),

  clearNotifications: () =>
    set({
      raceControlNotifications: [],
      battleAlerts: [],
    }),
}));
