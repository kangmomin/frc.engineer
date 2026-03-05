import { create } from 'zustand';
import type { CarSetup } from '../types/telemetry';
import type { DiagnosisResult } from '../components/setup-analysis/diagnosis/scoring';

// ── Types ──

export interface LapFeedback {
  id: string;
  lapNum: number;
  timestamp: number;
  note: string;
  rating: 'good' | 'neutral' | 'bad';
}

export interface SetupChangeRecord {
  id: string;
  timestamp: number;
  lapNum: number;
  previousSetup: CarSetup;
  newSetup: CarSetup;
  recommendations: SavedRecommendation[];
}

export interface SavedRecommendation {
  title: string;
  severity: string;
  adjustments: { label: string; current?: string; target?: string; delta: string }[];
}

interface SetupFeedbackState {
  feedbacks: LapFeedback[];
  setupChanges: SetupChangeRecord[];
  lastKnownSetup: CarSetup | null;

  addFeedback: (lapNum: number, note: string, rating: LapFeedback['rating']) => void;
  deleteFeedback: (id: string) => void;
  resetFeedbacks: () => void;

  checkSetupChange: (currentSetup: CarSetup | undefined, lapNum: number, diagnosisResults: DiagnosisResult[]) => void;
  deleteSetupChange: (id: string) => void;
  resetSetupChanges: () => void;

  resetAll: () => void;
}

// ── LocalStorage helpers ──

const LS_KEY_FEEDBACKS = 'setupFeedbacks';
const LS_KEY_SETUP_CHANGES = 'setupChangeHistory';

function loadFromLS<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function saveToLS<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota errors
  }
}

function genId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function setupsEqual(a: CarSetup, b: CarSetup): boolean {
  if (a.frontWing !== b.frontWing) return false;
  if (a.rearWing !== b.rearWing) return false;
  if (a.frontCamber !== b.frontCamber) return false;
  if (a.rearCamber !== b.rearCamber) return false;
  if (a.frontToe !== b.frontToe) return false;
  if (a.rearToe !== b.rearToe) return false;
  if (a.frontSuspension !== b.frontSuspension) return false;
  if (a.rearSuspension !== b.rearSuspension) return false;
  if (a.frontAntiRollBar !== b.frontAntiRollBar) return false;
  if (a.rearAntiRollBar !== b.rearAntiRollBar) return false;
  if (a.frontRideHeight !== b.frontRideHeight) return false;
  if (a.rearRideHeight !== b.rearRideHeight) return false;
  if (a.brakePressure !== b.brakePressure) return false;
  if (a.engineBraking !== b.engineBraking) return false;
  if (!a.tyrePressures || !b.tyrePressures) return a.tyrePressures === b.tyrePressures;
  if (a.tyrePressures.length !== b.tyrePressures.length) return false;
  for (let i = 0; i < a.tyrePressures.length; i++) {
    if (a.tyrePressures[i] !== b.tyrePressures[i]) return false;
  }
  return true;
}

// ── Store ──

export const useSetupFeedbackStore = create<SetupFeedbackState>((set, get) => ({
  feedbacks: loadFromLS<LapFeedback[]>(LS_KEY_FEEDBACKS, []),
  setupChanges: loadFromLS<SetupChangeRecord[]>(LS_KEY_SETUP_CHANGES, []),
  lastKnownSetup: null,

  addFeedback: (lapNum, note, rating) =>
    set((state) => {
      const entry: LapFeedback = {
        id: genId(),
        lapNum,
        timestamp: Date.now(),
        note,
        rating,
      };
      const updated = [...state.feedbacks, entry];
      saveToLS(LS_KEY_FEEDBACKS, updated);
      return { feedbacks: updated };
    }),

  deleteFeedback: (id) =>
    set((state) => {
      const updated = state.feedbacks.filter((f) => f.id !== id);
      saveToLS(LS_KEY_FEEDBACKS, updated);
      return { feedbacks: updated };
    }),

  resetFeedbacks: () =>
    set(() => {
      saveToLS(LS_KEY_FEEDBACKS, []);
      return { feedbacks: [] };
    }),

  checkSetupChange: (currentSetup, lapNum, diagnosisResults) => {
    if (!currentSetup) return;
    const { lastKnownSetup } = get();

    if (!lastKnownSetup) {
      set({ lastKnownSetup: { ...currentSetup } });
      return;
    }

    if (setupsEqual(lastKnownSetup, currentSetup)) return;

    const recommendations: SavedRecommendation[] = diagnosisResults.map((r) => ({
      title: r.title,
      severity: r.severity,
      adjustments: r.adjustments.map((a) => ({
        label: a.label,
        current: a.current,
        target: a.target,
        delta: a.delta,
      })),
    }));

    const record: SetupChangeRecord = {
      id: genId(),
      timestamp: Date.now(),
      lapNum,
      previousSetup: { ...lastKnownSetup },
      newSetup: { ...currentSetup },
      recommendations,
    };

    set((state) => {
      const updated = [...state.setupChanges, record];
      saveToLS(LS_KEY_SETUP_CHANGES, updated);
      return {
        setupChanges: updated,
        lastKnownSetup: { ...currentSetup },
      };
    });
  },

  deleteSetupChange: (id) =>
    set((state) => {
      const updated = state.setupChanges.filter((c) => c.id !== id);
      saveToLS(LS_KEY_SETUP_CHANGES, updated);
      return { setupChanges: updated };
    }),

  resetSetupChanges: () =>
    set(() => {
      saveToLS(LS_KEY_SETUP_CHANGES, []);
      return { setupChanges: [] };
    }),

  resetAll: () =>
    set(() => {
      saveToLS(LS_KEY_FEEDBACKS, []);
      saveToLS(LS_KEY_SETUP_CHANGES, []);
      return { feedbacks: [], setupChanges: [], lastKnownSetup: null };
    }),
}));
