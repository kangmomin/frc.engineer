/**
 * Tyre Inventory Types and Default Values
 */

export interface TyreInventoryState {
  soft: number;
  medium: number;
  hard: number;
  inter: number;
  wet: number;
}

export const DEFAULT_TYRE_ALLOCATION: TyreInventoryState = {
  soft: 8,
  medium: 3,
  hard: 2,
  inter: 4,
  wet: 3,
};

export type InventoryCompound = keyof TyreInventoryState;

export const INVENTORY_COMPOUNDS: InventoryCompound[] = ['soft', 'medium', 'hard', 'inter', 'wet'];
