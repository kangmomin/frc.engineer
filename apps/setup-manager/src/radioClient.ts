// Client for the sender's virtual engineer radio (/api/radio/*) and the
// voice queue that speaks released calls. The sender decides what to say and
// when; this side only plays calls in order and pauses for human radio.

export type RadioPriority = 0 | 1 | 2 | 3; // info, normal, high, urgent
export const RADIO_URGENT: RadioPriority = 3;

export interface RadioCall {
  id: number;
  key: string;
  category: string;
  priority: RadioPriority;
  text: string;
  basis?: "game" | "measured" | "heuristic";
  lap?: number;
  source: string;
  createdAt: string;
  releasedAt?: string;
  expiresAt: string;
}

export type RadioDecisionMode = "off" | "shadow" | "enforce";

export interface RadioDecisionConfig {
  mode: RadioDecisionMode;
  url: string;
  apiKey?: string;
  model?: string;
  timeoutMs: number;
  allowRemote: boolean;
  speakThreshold: number;
  logDecisions: boolean;
}

export interface RadioCategories {
  pit: boolean;
  fuel: boolean;
  tyres: boolean;
  damage: boolean;
  raceControl: boolean;
  rivals: boolean;
  weather: boolean;
  lapBriefing: boolean;
}

export interface RadioSettings {
  enabled: boolean;
  language: "ko" | "en";
  verbosity: "minimal" | "normal" | "detailed";
  categories: RadioCategories;
  brakeGate: boolean;
  briefingButton: number;
  repeatButton: number;
  tyreWearWarnPct: number;
  decision: RadioDecisionConfig;
}

export interface RadioStatus {
  enabled: boolean;
  lastStateAt?: string;
  stale: boolean;
  sessionType?: string;
  queued: number;
  released: number;
  dropped: number;
  suppressed: number;
  subscribers: number;
  decisionMode: RadioDecisionMode;
  decisionReady: boolean;
  decisionLastError?: string;
  decisionCount: number;
  decisionErrors: number;
  shadowSkipped: number;
  decisionDisagree: number;
}

export interface RadioSettingsView {
  settings: RadioSettings;
  hasApiKey: boolean;
  status: RadioStatus;
}

export interface RadioAnswer {
  question: string;
  intent: string;
  source: "keywords" | "model";
  keywordIntent: string;
  modelIntent?: string;
  modelProb?: number;
  text: string;
}

export interface RadioDecisionRecord {
  at: string;
  mode: string;
  kind: "speak" | "intent";
  callKey?: string;
  category?: string;
  input?: string;
  speakProb?: number;
  urgency?: string;
  intent?: string;
  intentProb?: number;
  ruleAction: string;
  modelAction: string;
  applied: boolean;
  latencyMs: number;
  error?: string;
}

async function radioRequest<T>(base: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${base.replace(/\/+$/, "")}${path}`, init);
  const data = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok) {
    throw new Error(data?.error || `Radio request failed (${response.status})`);
  }
  return data as T;
}

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const radioApi = {
  getSettings: (base: string) => radioRequest<RadioSettingsView>(base, "/api/radio/settings"),
  // An empty decision.apiKey keeps the stored key; clearApiKey removes it.
  putSettings: (base: string, settings: RadioSettings, clearApiKey = false) =>
    radioRequest<RadioSettingsView>(base, "/api/radio/settings", jsonInit("PUT", { ...settings, clearApiKey })),
  ask: (base: string, question: string) => radioRequest<RadioAnswer>(base, "/api/radio/ask", jsonInit("POST", { question })),
  briefing: (base: string) => radioRequest<RadioCall>(base, "/api/radio/briefing", { method: "POST" }),
  repeat: (base: string) => radioRequest<RadioCall>(base, "/api/radio/repeat", { method: "POST" }),
  test: (base: string) => radioRequest<RadioCall>(base, "/api/radio/test", { method: "POST" }),
  decisions: (base: string) =>
    radioRequest<{ decisions: RadioDecisionRecord[]; status: RadioStatus }>(base, "/api/radio/decisions"),
};

export interface RadioVoicePrefs {
  enabled: boolean;
  voiceURI: string;
  rate: number;
  volume: number;
}

export const DEFAULT_RADIO_VOICE_PREFS: RadioVoicePrefs = { enabled: false, voiceURI: "", rate: 1.1, volume: 1 };

export function normalizeRadioVoicePrefs(source: Partial<RadioVoicePrefs> | null | undefined): RadioVoicePrefs {
  const clamp = (value: unknown, lo: number, hi: number, fallback: number) =>
    typeof value === "number" && Number.isFinite(value) ? Math.min(hi, Math.max(lo, value)) : fallback;
  return {
    enabled: Boolean(source?.enabled),
    voiceURI: typeof source?.voiceURI === "string" ? source.voiceURI : "",
    rate: clamp(source?.rate, 0.6, 1.8, DEFAULT_RADIO_VOICE_PREFS.rate),
    volume: clamp(source?.volume, 0, 1, DEFAULT_RADIO_VOICE_PREFS.volume),
  };
}

/** Plays one call and reports completion exactly once. */
export interface RadioSpeaker {
  speak(call: RadioCall, done: () => void): void;
  cancel(): void;
}

const MAX_PENDING = 6;

/**
 * Speaks calls one at a time. Urgent calls jump the queue and cut off a
 * non-urgent call that is playing. While held (a person is talking on the
 * intercom) only urgent calls play. Expired calls are dropped, never late.
 */
export class RadioVoiceQueue {
  private pending: RadioCall[] = [];
  private current: RadioCall | null = null;
  private token = 0;
  private held = false;

  constructor(private readonly speaker: RadioSpeaker, private readonly now: () => number = () => Date.now()) {}

  get speaking(): RadioCall | null {
    return this.current;
  }

  get queued(): readonly RadioCall[] {
    return this.pending;
  }

  setHeld(held: boolean): void {
    if (this.held === held) return;
    this.held = held;
    this.pump();
  }

  push(call: RadioCall): void {
    if (this.current?.id === call.id || this.pending.some((c) => c.id === call.id)) return;
    if (call.priority >= RADIO_URGENT) {
      this.pending.unshift(call);
      if (this.current && this.current.priority < RADIO_URGENT) {
        this.interrupt();
      }
    } else {
      this.pending.push(call);
    }
    if (this.pending.length > MAX_PENDING) {
      // Drop the lowest-priority, oldest call.
      let drop = 0;
      for (let i = 1; i < this.pending.length; i++) {
        if (this.pending[i].priority < this.pending[drop].priority) drop = i;
      }
      this.pending.splice(drop, 1);
    }
    this.pump();
  }

  clear(): void {
    this.pending = [];
    if (this.current) this.interrupt();
  }

  private interrupt(): void {
    this.token++;
    this.current = null;
    this.speaker.cancel();
  }

  private expired(call: RadioCall): boolean {
    const at = Date.parse(call.expiresAt);
    return Number.isFinite(at) && at < this.now();
  }

  private pump(): void {
    if (this.current) return;
    this.pending = this.pending.filter((c) => !this.expired(c));
    const index = this.held ? this.pending.findIndex((c) => c.priority >= RADIO_URGENT) : 0;
    if (index < 0 || index >= this.pending.length) return;
    const [next] = this.pending.splice(index, 1);
    const token = ++this.token;
    this.current = next;
    this.speaker.speak(next, () => {
      if (token !== this.token) return;
      this.current = null;
      this.pump();
    });
  }
}

/** Picks the stored voice, else the first voice for the language. */
export function pickRadioVoice<T extends { voiceURI: string; lang: string; default?: boolean }>(
  voices: readonly T[],
  voiceURI: string,
  language: string,
): T | undefined {
  const exact = voiceURI ? voices.find((v) => v.voiceURI === voiceURI) : undefined;
  if (exact) return exact;
  const prefix = language === "en" ? "en" : "ko";
  return voices.find((v) => v.lang.toLowerCase().startsWith(prefix));
}

/** Web Speech API speaker. Windows exposes its installed SAPI voices here. */
export function createBrowserSpeaker(getPrefs: () => RadioVoicePrefs, getLanguage: () => string): RadioSpeaker {
  return {
    speak(call, done) {
      const synth = window.speechSynthesis;
      let finished = false;
      let guard = 0;
      const finish = () => {
        if (finished) return;
        finished = true;
        window.clearTimeout(guard);
        done();
      };
      const prefs = getPrefs();
      const language = getLanguage();
      const utterance = new SpeechSynthesisUtterance(call.text);
      utterance.lang = language === "en" ? "en-GB" : "ko-KR";
      const voice = pickRadioVoice(synth.getVoices(), prefs.voiceURI, language);
      if (voice) utterance.voice = voice;
      utterance.rate = prefs.rate;
      utterance.volume = prefs.volume;
      utterance.onend = finish;
      utterance.onerror = finish;
      // Chromium occasionally never fires onend; never let the queue stall.
      guard = window.setTimeout(finish, 4000 + call.text.length * 250);
      synth.speak(utterance);
    },
    cancel() {
      window.speechSynthesis.cancel();
    },
  };
}
