export type DriverDisplayMode = 'full' | 'car' | 'hidden';
export type DriverVisibility = Partial<Record<number, DriverDisplayMode>>;

// Stable by recorded car index, including teammates and sparse participant lists.
const DRIVER_COLORS = [
  '#dc2626', '#2563eb', '#16a34a', '#9333ea', '#ea580c', '#0891b2',
  '#db2777', '#65a30d', '#4f46e5', '#0d9488', '#b45309', '#c026d3',
  '#be123c', '#0284c7', '#15803d', '#7c3aed', '#c2410c', '#0e7490',
  '#be185d', '#4d7c0f', '#4338ca', '#047857', '#a16207', '#a21caf',
];

export function replayDriverColor(idx: number): string {
  return DRIVER_COLORS[idx % DRIVER_COLORS.length] ?? '#64748b';
}
