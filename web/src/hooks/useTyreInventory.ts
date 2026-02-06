import { useMemo, useCallback } from 'react';
import { useLocalStorage } from './useLocalStorage';
import type { StintInfo } from '../types/telemetry';
import {
  TyreInventoryState,
  DEFAULT_TYRE_ALLOCATION,
  InventoryCompound,
  INVENTORY_COMPOUNDS,
} from '../types/tyreInventory';

const STORAGE_KEY = 'frc-engineer-tyre-inventory';

/**
 * Validate and normalize stored inventory data
 * Ensures all compound keys exist and have valid numeric values
 */
function validateInventoryState(parsed: unknown): TyreInventoryState | null {
  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }

  const obj = parsed as Record<string, unknown>;
  const result: TyreInventoryState = { ...DEFAULT_TYRE_ALLOCATION };

  for (const compound of INVENTORY_COMPOUNDS) {
    const value = obj[compound];
    if (typeof value === 'number' && !isNaN(value) && value >= 0 && value <= 20) {
      result[compound] = Math.floor(value);
    }
    // If invalid or missing, keep default value from spread above
  }

  return result;
}

export interface TyreInventoryResult {
  /** User-configured total sets per compound */
  allocated: TyreInventoryState;
  /** Sets used (calculated from stint history) */
  used: TyreInventoryState;
  /** Remaining sets (allocated - used) */
  remaining: TyreInventoryState;
  /** Set allocation for a specific compound */
  setCompoundAllocation: (compound: InventoryCompound, value: number) => void;
  /** Reset all allocations to default */
  resetToDefault: () => void;
}

/**
 * Calculate used tyre sets from stint history
 */
function calculateUsedSets(stintHistory: StintInfo[] | undefined): TyreInventoryState {
  const used: TyreInventoryState = {
    soft: 0,
    medium: 0,
    hard: 0,
    inter: 0,
    wet: 0,
  };

  if (!stintHistory) return used;

  for (const stint of stintHistory) {
    const compound = stint.compound.toLowerCase() as InventoryCompound;
    if (INVENTORY_COMPOUNDS.includes(compound)) {
      used[compound]++;
    }
  }

  return used;
}

/**
 * Hook for managing tyre inventory state
 * @param stintHistory - Stint history from driver info to calculate used sets
 */
export function useTyreInventory(stintHistory: StintInfo[] | undefined): TyreInventoryResult {
  const [allocated, setAllocated, resetToDefault] = useLocalStorage<TyreInventoryState>(
    STORAGE_KEY,
    DEFAULT_TYRE_ALLOCATION,
    validateInventoryState
  );

  // Calculate used sets from stint history
  const used = useMemo(() => calculateUsedSets(stintHistory), [stintHistory]);

  // Calculate remaining sets
  const remaining = useMemo(() => {
    const result: TyreInventoryState = { soft: 0, medium: 0, hard: 0, inter: 0, wet: 0 };
    for (const compound of INVENTORY_COMPOUNDS) {
      result[compound] = Math.max(0, allocated[compound] - used[compound]);
    }
    return result;
  }, [allocated, used]);

  // Set allocation for a specific compound
  const setCompoundAllocation = useCallback(
    (compound: InventoryCompound, value: number) => {
      const clampedValue = Math.max(0, Math.min(20, value));
      setAllocated((prev) => ({
        ...prev,
        [compound]: clampedValue,
      }));
    },
    [setAllocated]
  );

  return {
    allocated,
    used,
    remaining,
    setCompoundAllocation,
    resetToDefault,
  };
}
