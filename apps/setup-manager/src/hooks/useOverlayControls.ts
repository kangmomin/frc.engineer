import { useEffect, useState } from "react";

import { errorMessage, normalizeSenderUrl } from "../lib/senderApi";
import type { OverlayHotkeys, SenderStatus } from "../lib/senderTypes";

export interface OverlayState {
  radar: boolean;
  weather: boolean;
  strategy: boolean;
  radio: boolean;
}

export type OverlayKind = keyof OverlayState;

const DEFAULT_OVERLAY_STATE: OverlayState = { radar: false, weather: false, strategy: false, radio: false };

const DEFAULT_OVERLAY_HOTKEYS: OverlayHotkeys = {
  radar: "Alt+Shift+1",
  weather: "Alt+Shift+2",
  strategy: "Alt+Shift+3",
  radio: "Alt+Shift+4",
};

function normalizeOverlayHotkeysInput(source?: Partial<OverlayHotkeys> | null): OverlayHotkeys {
  return {
    radar: source?.radar?.trim() || DEFAULT_OVERLAY_HOTKEYS.radar,
    weather: source?.weather?.trim() || DEFAULT_OVERLAY_HOTKEYS.weather,
    strategy: source?.strategy?.trim() || DEFAULT_OVERLAY_HOTKEYS.strategy,
    radio: source?.radio?.trim() || DEFAULT_OVERLAY_HOTKEYS.radio,
  };
}

/** 네이티브 오버레이 켜기/끄기와 전역 핫키(Electron globalShortcut + Sender local-ops 저장). */
export function useOverlayControls(senderUrl: string, senderStatus: SenderStatus | null) {
  const [overlayState, setOverlayState] = useState<OverlayState>(DEFAULT_OVERLAY_STATE);
  const [hotkeys, setHotkeys] = useState<OverlayHotkeys>(DEFAULT_OVERLAY_HOTKEYS);
  const [draftHotkeys, setDraftHotkeys] = useState<OverlayHotkeys>(DEFAULT_OVERLAY_HOTKEYS);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingHotkeys, setSavingHotkeys] = useState(false);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    setOverlayState({
      radar: Boolean(senderStatus?.radarActive),
      weather: Boolean(senderStatus?.weatherActive),
      strategy: Boolean(senderStatus?.strategyActive),
      radio: Boolean(senderStatus?.radioActive),
    });
  }, [senderStatus?.radarActive, senderStatus?.weatherActive, senderStatus?.strategyActive, senderStatus?.radioActive]);

  const syncElectronHotkeys = async (next: OverlayHotkeys, options?: { silent?: boolean }): Promise<boolean> => {
    if (!window.electronAPI?.setOverlayHotkeys) {
      return true;
    }
    try {
      const result = await window.electronAPI.setOverlayHotkeys(next);
      if (result.errors.length) {
        if (!options?.silent) {
          setError(`Hotkey registration failed: ${result.errors.join(", ")}`);
        }
        return false;
      }
      return true;
    } catch (syncError) {
      if (!options?.silent) {
        setError(errorMessage(syncError, "Failed to register overlay hotkeys."));
      }
      return false;
    }
  };

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch(`${normalizeSenderUrl(senderUrl)}/api/local-ops`);
        const data = (await response.json().catch(() => null)) as { overlayHotkeys?: OverlayHotkeys } | null;
        if (!response.ok || !data || !active) {
          return;
        }
        const next = normalizeOverlayHotkeysInput(data.overlayHotkeys);
        setHotkeys(next);
        setDraftHotkeys(next);
        setError(null);
        void syncElectronHotkeys(next, { silent: !active });
      } catch {
        // Sender 미기동 — 기본 핫키를 유지한다.
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [senderUrl]);

  const saveHotkeys = async () => {
    const next = normalizeOverlayHotkeysInput(draftHotkeys);
    setSavingHotkeys(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`${normalizeSenderUrl(senderUrl)}/api/local-ops`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overlayHotkeys: next }),
      });
      const data = (await response.json().catch(() => null)) as { overlayHotkeys?: OverlayHotkeys; error?: string } | null;
      if (!response.ok) {
        throw new Error(data?.error || "Failed to save overlay hotkeys.");
      }
      const saved = normalizeOverlayHotkeysInput(data?.overlayHotkeys ?? next);
      setHotkeys(saved);
      setDraftHotkeys(saved);
      await syncElectronHotkeys(saved);
      setNotice("Overlay hotkeys saved.");
    } catch (saveError) {
      setError(errorMessage(saveError, "Failed to save overlay hotkeys."));
    } finally {
      setSavingHotkeys(false);
    }
  };

  const toggle = async (kind: OverlayKind) => {
    const nextState = { ...overlayState, [kind]: !overlayState[kind] };
    setApplying(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`${normalizeSenderUrl(senderUrl)}/api/overlay/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextState),
      });
      const data = (await response.json().catch(() => null)) as (Partial<OverlayState> & { error?: string }) | null;
      if (!response.ok) {
        throw new Error(data?.error || "Failed to apply overlay state.");
      }
      setOverlayState({
        radar: Boolean(data?.radar),
        weather: Boolean(data?.weather),
        strategy: Boolean(data?.strategy),
        radio: Boolean(data?.radio),
      });
      setNotice(`${kind[0].toUpperCase()}${kind.slice(1)} overlay ${overlayState[kind] ? "closed" : "opened"}.`);
    } catch (applyError) {
      setError(errorMessage(applyError, "Failed to apply overlay state."));
    } finally {
      setApplying(false);
    }
  };

  return {
    overlayState,
    hotkeys,
    draftHotkeys,
    notice,
    error,
    savingHotkeys,
    applying,
    setDraftHotkey: (kind: OverlayKind, value: string) => setDraftHotkeys((current) => ({ ...current, [kind]: value })),
    saveHotkeys,
    toggle,
  };
}

export type OverlayControls = ReturnType<typeof useOverlayControls>;
