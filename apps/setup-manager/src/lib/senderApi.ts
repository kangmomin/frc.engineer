// Driver Pack은 항상 같은 PC의 내장 Sender API와 통신한다.
export const DEFAULT_SENDER_URL = "http://localhost:8099";
export const DEFAULT_PLATFORM_BASE_URL = "https://pitwall.up.railway.app";

export function normalizeSenderUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return DEFAULT_SENDER_URL;
  }

  try {
    const parsed = new URL(trimmed.includes("://") ? trimmed : `http://${trimmed}`);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return DEFAULT_SENDER_URL;
    }
    if (!parsed.host) {
      return DEFAULT_SENDER_URL;
    }
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return DEFAULT_SENDER_URL;
  }
}

// 데스크톱 앱은 Electron 설정 파일(업데이트 후에도 유지), 브라우저 개발 모드는 localStorage를 쓴다.
export async function readStoredValue<T>(key: string, fallback: T): Promise<T> {
  if (window.electronAPI?.getSetting) {
    const value = await window.electronAPI.getSetting<T>(key);
    return (value ?? fallback) as T;
  }

  const raw = localStorage.getItem(key);
  if (raw == null) {
    return fallback;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return raw as T;
  }
}

export async function writeStoredValue(key: string, value: unknown): Promise<void> {
  if (window.electronAPI?.setSetting) {
    await window.electronAPI.setSetting(key, value);
    return;
  }

  if (typeof value === "string") {
    localStorage.setItem(key, value);
    return;
  }

  localStorage.setItem(key, JSON.stringify(value));
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
