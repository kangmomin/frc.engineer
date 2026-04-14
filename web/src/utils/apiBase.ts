const DEFAULT_LOCAL_API_URL = 'http://localhost:8081';
const STORAGE_KEY = 'pitwall.localApiUrl';

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

function readStoredApiBase(): string {
  if (typeof window === 'undefined') return '';
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored ? normalizeBaseUrl(stored) : '';
}

export function setStoredApiBase(value: string): void {
  if (typeof window === 'undefined') return;
  const normalized = normalizeBaseUrl(value);
  window.localStorage.setItem(STORAGE_KEY, normalized);
}

export function getApiBase(): string {
  const stored = readStoredApiBase();
  if (stored) return stored;

  const configured = import.meta.env.VITE_API_URL?.trim();
  if (configured) return normalizeBaseUrl(configured);

  if (import.meta.env.DEV) return '';

  return DEFAULT_LOCAL_API_URL;
}

export function getApiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const base = getApiBase();
  return base ? `${base}${normalizedPath}` : normalizedPath;
}

