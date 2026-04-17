export const STRATEGY_ACCESS_STORAGE_KEY = 'frc_strategy_access_key';
export const STRATEGY_ACCESS_CODE = 'mer260331';

export function normalizeStrategyAccessKey(value: string | null | undefined): string {
  return (value ?? '').trim();
}

export function hasStrategyAccessKey(value: string | null | undefined): boolean {
  return normalizeStrategyAccessKey(value) === STRATEGY_ACCESS_CODE;
}
