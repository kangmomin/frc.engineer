import { describe, expect, it } from "vitest";
import {
  RadioVoiceQueue,
  normalizeRadioVoicePrefs,
  pickRadioVoice,
  type RadioCall,
  type RadioSpeaker,
} from "../src/radioClient";
import { intercomBusy } from "../src/useEngineerRadio";

function call(id: number, priority: RadioCall["priority"], expiresInMs = 60_000, now = 1_000_000): RadioCall {
  return {
    id,
    key: `k${id}`,
    category: "test",
    priority,
    text: `call ${id}`,
    source: "rule",
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + expiresInMs).toISOString(),
  };
}

function fakeSpeaker() {
  const spoken: number[] = [];
  let finish: (() => void) | null = null;
  let cancels = 0;
  const speaker: RadioSpeaker = {
    speak(c, done) {
      spoken.push(c.id);
      finish = done;
    },
    cancel() {
      cancels++;
      // Browsers fire onend/onerror for the cancelled utterance.
      finish?.();
    },
  };
  return { speaker, spoken, end: () => finish?.(), cancels: () => cancels };
}

describe("RadioVoiceQueue", () => {
  it("speaks one call at a time in order", () => {
    const f = fakeSpeaker();
    const q = new RadioVoiceQueue(f.speaker, () => 1_000_000);
    q.push(call(1, 1));
    q.push(call(2, 1));
    expect(f.spoken).toEqual([1]);
    f.end();
    expect(f.spoken).toEqual([1, 2]);
  });

  it("lets urgent calls interrupt and jump the queue", () => {
    const f = fakeSpeaker();
    const q = new RadioVoiceQueue(f.speaker, () => 1_000_000);
    q.push(call(1, 1));
    q.push(call(2, 1));
    q.push(call(3, 3));
    expect(f.cancels()).toBe(1);
    expect(f.spoken).toEqual([1, 3]);
    f.end();
    expect(f.spoken).toEqual([1, 3, 2]);
  });

  it("holds non-urgent calls while the intercom is busy", () => {
    const f = fakeSpeaker();
    const q = new RadioVoiceQueue(f.speaker, () => 1_000_000);
    q.setHeld(true);
    q.push(call(1, 2));
    expect(f.spoken).toEqual([]);
    q.push(call(2, 3));
    expect(f.spoken).toEqual([2]);
    f.end();
    expect(f.spoken).toEqual([2]);
    q.setHeld(false);
    expect(f.spoken).toEqual([2, 1]);
  });

  it("drops expired calls instead of speaking them late", () => {
    const f = fakeSpeaker();
    let now = 1_000_000;
    const q = new RadioVoiceQueue(f.speaker, () => now);
    q.push(call(1, 1));
    q.push(call(2, 1, 5_000));
    now += 10_000;
    f.end();
    expect(f.spoken).toEqual([1]);
    expect(q.queued).toHaveLength(0);
  });

  it("ignores duplicates and clears", () => {
    const f = fakeSpeaker();
    const q = new RadioVoiceQueue(f.speaker, () => 1_000_000);
    q.push(call(1, 1));
    q.push(call(1, 1));
    q.push(call(2, 1));
    expect(q.queued.map((c) => c.id)).toEqual([2]);
    q.clear();
    expect(q.queued).toHaveLength(0);
    expect(q.speaking).toBeNull();
  });
});

describe("radio helpers", () => {
  it("normalizes voice preferences", () => {
    expect(normalizeRadioVoicePrefs({ enabled: true, rate: 9, volume: -1 })).toEqual({ enabled: true, voiceURI: "", rate: 1.8, volume: 0 });
    expect(normalizeRadioVoicePrefs(null).enabled).toBe(false);
  });

  it("picks the stored voice, else one for the language", () => {
    const voices = [
      { voiceURI: "en", lang: "en-US" },
      { voiceURI: "heami", lang: "ko-KR" },
    ];
    expect(pickRadioVoice(voices, "en", "ko")?.voiceURI).toBe("en");
    expect(pickRadioVoice(voices, "", "ko")?.voiceURI).toBe("heami");
    expect(pickRadioVoice(voices, "missing", "en")?.voiceURI).toBe("en");
  });

  it("treats any online speaker or PTT as busy only when joined", () => {
    const base = { status: "joined", ptt: false, snapshot: { participants: [{ online: true, speaking: false, ptt: false }] } };
    expect(intercomBusy(base as never)).toBe(false);
    expect(intercomBusy({ ...base, snapshot: { participants: [{ online: true, speaking: true, ptt: false }] } } as never)).toBe(true);
    expect(intercomBusy({ ...base, ptt: true } as never)).toBe(true);
    expect(intercomBusy({ ...base, status: "idle", ptt: true } as never)).toBe(false);
  });
});
