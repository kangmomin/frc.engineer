// Base URL for the hosted platform service (cmd/platform): Steam accounts,
// sessions, leaderboards, marketplace, economy. Distinct from the local desktop
// backend (apiBase.ts / cmd/server). Configured via VITE_PLATFORM_URL; when
// unset the platform is considered unavailable and the leaderboard/market
// screens render an explicit "not connected" state (no demo data).

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

export function getPlatformBase(): string {
  const configured = import.meta.env.VITE_PLATFORM_URL?.trim();
  return configured ? normalizeBaseUrl(configured) : '';
}

export function isPlatformConfigured(): boolean {
  return getPlatformBase() !== '';
}

export function getPlatformUrl(path: string): string {
  const base = getPlatformBase();
  if (!base) return '';
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}
