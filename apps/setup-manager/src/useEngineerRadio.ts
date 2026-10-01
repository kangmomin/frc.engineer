import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { IntercomRuntimeState } from "../../../web/src/intercom/core";
import {
  DEFAULT_RADIO_VOICE_PREFS,
  RadioVoiceQueue,
  createBrowserSpeaker,
  normalizeRadioVoicePrefs,
  type RadioCall,
  type RadioVoicePrefs,
} from "./radioClient";

const VOICE_PREFS_KEY = "frc_engineer_radio_voice";
const RECENT_LIMIT = 12;
const RECONNECT_MS = 2000;

export type RadioStreamStatus = "connecting" | "live" | "reconnecting";

async function loadPrefs(): Promise<RadioVoicePrefs> {
  try {
    if (window.electronAPI?.getSetting) {
      return normalizeRadioVoicePrefs(await window.electronAPI.getSetting<RadioVoicePrefs>(VOICE_PREFS_KEY));
    }
    const raw = localStorage.getItem(VOICE_PREFS_KEY);
    return normalizeRadioVoicePrefs(raw ? JSON.parse(raw) : null);
  } catch {
    return DEFAULT_RADIO_VOICE_PREFS;
  }
}

async function savePrefs(prefs: RadioVoicePrefs): Promise<void> {
  if (window.electronAPI?.setSetting) {
    await window.electronAPI.setSetting(VOICE_PREFS_KEY, prefs);
    return;
  }
  localStorage.setItem(VOICE_PREFS_KEY, JSON.stringify(prefs));
}

/** True while anyone on the intercom (including the driver) is talking. */
export function intercomBusy(state: IntercomRuntimeState | null | undefined): boolean {
  if (!state || state.status !== "joined") return false;
  if (state.ptt) return true;
  return Boolean(state.snapshot?.participants.some((p) => p.online && (p.speaking || p.ptt)));
}

/**
 * Subscribes to the sender's engineer radio stream and speaks released calls
 * with the system voices. Mounted once at the app root so the voice keeps
 * working whichever section is open.
 */
export function useEngineerRadio(senderUrl: string, intercom: IntercomRuntimeState | null) {
  const [status, setStatus] = useState<RadioStreamStatus>("connecting");
  const [language, setLanguage] = useState<"ko" | "en">("ko");
  const [calls, setCalls] = useState<RadioCall[]>([]);
  const [prefs, setPrefsState] = useState<RadioVoicePrefs>(DEFAULT_RADIO_VOICE_PREFS);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const prefsRef = useRef(prefs);
  const languageRef = useRef(language);
  prefsRef.current = prefs;
  languageRef.current = language;
  const speechSupported = typeof window !== "undefined" && "speechSynthesis" in window;

  const queue = useMemo(
    () => (speechSupported ? new RadioVoiceQueue(createBrowserSpeaker(() => prefsRef.current, () => languageRef.current)) : null),
    [speechSupported],
  );

  useEffect(() => {
    void loadPrefs().then(setPrefsState);
  }, []);

  useEffect(() => {
    if (!speechSupported) return;
    const refresh = () => setVoices(window.speechSynthesis.getVoices());
    refresh();
    window.speechSynthesis.addEventListener("voiceschanged", refresh);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", refresh);
  }, [speechSupported]);

  const busy = intercomBusy(intercom);
  useEffect(() => {
    queue?.setHeld(busy);
  }, [busy, queue]);

  useEffect(() => {
    if (!prefs.enabled) queue?.clear();
  }, [prefs.enabled, queue]);

  useEffect(() => {
    let closed = false;
    let source: EventSource | null = null;
    let timer: number | undefined;
    const base = senderUrl.replace(/\/+$/, "");
    const connect = () => {
      if (closed) return;
      source = new EventSource(`${base}/api/radio/stream`);
      source.addEventListener("hello", (event) => {
        setStatus("live");
        try {
          const hello = JSON.parse((event as MessageEvent).data) as { language?: string };
          setLanguage(hello.language === "en" ? "en" : "ko");
        } catch {
          // keep the previous language
        }
      });
      source.addEventListener("call", (event) => {
        let call: RadioCall;
        try {
          call = JSON.parse((event as MessageEvent).data) as RadioCall;
        } catch {
          return;
        }
        setCalls((current) => [call, ...current.filter((c) => c.id !== call.id)].slice(0, RECENT_LIMIT));
        if (prefsRef.current.enabled) queue?.push(call);
      });
      source.onerror = () => {
        source?.close();
        setStatus("reconnecting");
        timer = window.setTimeout(connect, RECONNECT_MS);
      };
    };
    setStatus("connecting");
    connect();
    return () => {
      closed = true;
      window.clearTimeout(timer);
      source?.close();
    };
  }, [senderUrl, queue]);

  useEffect(() => () => queue?.clear(), [queue]);

  const setPrefs = useCallback((next: Partial<RadioVoicePrefs>) => {
    setPrefsState((current) => {
      const merged = normalizeRadioVoicePrefs({ ...current, ...next });
      void savePrefs(merged);
      return merged;
    });
  }, []);

  return { status, language, setLanguage, calls, prefs, setPrefs, voices, speechSupported, intercomBusy: busy };
}

export type EngineerRadio = ReturnType<typeof useEngineerRadio>;
