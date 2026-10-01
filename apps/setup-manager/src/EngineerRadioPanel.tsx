import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import {
  radioApi,
  type RadioAnswer,
  type RadioCategories,
  type RadioDecisionRecord,
  type RadioSettings,
  type RadioSettingsView,
} from "./radioClient";
import type { EngineerRadio } from "./useEngineerRadio";

interface Theme {
  bg: string;
  surface2: string;
  border: string;
  accent: string;
  accent2: string;
  danger: string;
  text: string;
  muted: string;
  dim: string;
  mono: string;
}

interface Props {
  senderUrl: string;
  radio: EngineerRadio;
  theme: Theme;
}

const CATEGORY_LABELS: Array<[keyof RadioCategories, string]> = [
  ["pit", "피트 윈도우 · 언더컷"],
  ["fuel", "연료"],
  ["tyres", "타이어"],
  ["damage", "손상"],
  ["raceControl", "SC · 플래그 · 페널티"],
  ["rivals", "앞뒤차 · 갭"],
  ["weather", "날씨"],
  ["lapBriefing", "매 랩 브리핑"],
];

const PRIORITY_COLORS = ["#849396", "#00e5ff", "#ffc800", "#ff525c"];
const BASIS_LABELS: Record<string, string> = { game: "게임 값", measured: "측정", heuristic: "휴리스틱" };

function formatTime(iso?: string): string {
  if (!iso) return "--";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "--" : date.toLocaleTimeString();
}

export function EngineerRadioPanel({ senderUrl, radio, theme: P }: Props) {
  const [view, setView] = useState<RadioSettingsView | null>(null);
  const [draft, setDraft] = useState<RadioSettings | null>(null);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<RadioAnswer | null>(null);
  const [decisions, setDecisions] = useState<RadioDecisionRecord[]>([]);

  const input: CSSProperties = { width: "100%", padding: "9px 11px", borderRadius: 4, border: `1px solid ${P.border}`, background: P.surface2, color: P.text, fontFamily: P.mono, outline: "none" };
  const button = (bg: string, fg = P.bg): CSSProperties => ({ padding: "8px 12px", borderRadius: 4, border: "none", background: bg, color: fg, cursor: "pointer", fontFamily: P.mono, fontSize: 10 });
  const label: CSSProperties = { fontSize: 10, color: P.muted, fontFamily: P.mono };

  const load = async () => {
    try {
      const next = await radioApi.getSettings(senderUrl);
      setView(next);
      setDraft(next.settings);
      radio.setLanguage(next.settings.language);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Engineer radio settings unavailable.");
    }
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      void radioApi.getSettings(senderUrl).then(setView).catch(() => {});
      void radioApi.decisions(senderUrl).then((d) => setDecisions(d.decisions.slice(-10).reverse())).catch(() => {});
    }, 3000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [senderUrl]);

  const run = async (action: () => Promise<unknown>, ok: string) => {
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(ok);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed.");
    }
  };

  const save = async (clearApiKey = false) => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const body: RadioSettings = { ...draft, decision: { ...draft.decision, apiKey: apiKeyDraft.trim() } };
      const next = await radioApi.putSettings(senderUrl, body, clearApiKey);
      setView(next);
      setDraft(next.settings);
      setApiKeyDraft("");
      radio.setLanguage(next.settings.language);
      setNotice("저장했습니다.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  const ask = async () => {
    const q = question.trim();
    if (!q) return;
    await run(async () => setAnswer(await radioApi.ask(senderUrl, q)), "질문을 보냈습니다.");
  };

  const set = <K extends keyof RadioSettings>(key: K, value: RadioSettings[K]) => setDraft((d) => (d ? { ...d, [key]: value } : d));
  const setDecision = <K extends keyof RadioSettings["decision"]>(key: K, value: RadioSettings["decision"][K]) =>
    setDraft((d) => (d ? { ...d, decision: { ...d.decision, [key]: value } } : d));
  const status = view?.status;

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {error ? <Banner color={P.danger}>{error}</Banner> : null}
      {notice ? <Banner color={P.accent}>{notice}</Banner> : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
        <Tile label="Stream" value={radio.status === "live" ? "Live" : radio.status} color={radio.status === "live" ? P.accent : P.danger} theme={P} />
        <Tile label="Telemetry" value={!status ? "--" : status.stale ? "Waiting" : status.sessionType || "Live"} color={status && !status.stale ? P.accent2 : P.muted} theme={P} />
        <Tile label="Voice" value={!radio.speechSupported ? "Unsupported" : radio.prefs.enabled ? (radio.intercomBusy ? "Held · intercom" : "On") : "Off"} color={radio.prefs.enabled ? P.accent2 : P.muted} theme={P} />
        <Tile label="Calls" value={status ? `${status.released} sent · ${status.suppressed} cut` : "--"} color={P.text} theme={P} />
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button style={button(P.accent2)} onClick={() => void run(() => radioApi.briefing(senderUrl), "브리핑을 요청했습니다.")}>BRIEFING</button>
        <button style={button(P.accent)} onClick={() => void run(() => radioApi.repeat(senderUrl), "마지막 콜을 다시 보냅니다.")}>REPEAT LAST</button>
        <button style={button(P.dim, P.text)} onClick={() => void run(() => radioApi.test(senderUrl), "라디오 체크를 보냈습니다.")}>RADIO CHECK</button>
      </div>

      <Section title="음성 출력" theme={P}>
        {!radio.speechSupported ? (
          <div style={{ fontSize: 11, color: P.danger }}>이 환경은 음성 합성을 지원하지 않습니다.</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            <Check checked={radio.prefs.enabled} onChange={(v) => radio.setPrefs({ enabled: v })} theme={P}>
              엔지니어 음성 켜기 (인터컴에서 누가 말하는 동안은 긴급 콜만 재생)
            </Check>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 8 }}>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={label}>Voice</span>
                <select value={radio.prefs.voiceURI} onChange={(e) => radio.setPrefs({ voiceURI: e.target.value })} style={input}>
                  <option value="">자동 ({radio.language === "en" ? "English" : "한국어"})</option>
                  {radio.voices.map((v) => (
                    <option key={v.voiceURI} value={v.voiceURI}>{v.name} · {v.lang}</option>
                  ))}
                </select>
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={label}>Rate {radio.prefs.rate.toFixed(1)}</span>
                <input type="range" min={0.6} max={1.8} step={0.1} value={radio.prefs.rate} onChange={(e) => radio.setPrefs({ rate: Number(e.target.value) })} style={{ width: "100%", accentColor: P.accent }} />
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={label}>Volume {Math.round(radio.prefs.volume * 100)}%</span>
                <input type="range" min={0} max={1} step={0.05} value={radio.prefs.volume} onChange={(e) => radio.setPrefs({ volume: Number(e.target.value) })} style={{ width: "100%", accentColor: P.accent }} />
              </label>
            </div>
            <div style={{ fontSize: 10, color: P.muted, lineHeight: 1.6 }}>
              Windows에 설치된 음성(SAPI5)을 씁니다. 한국어 음성이 없으면 Windows 설정 → 시간 및 언어 → 음성에서 추가하세요.
            </div>
          </div>
        )}
      </Section>

      {draft ? (
        <Section title="엔지니어 설정" theme={P}>
          <div style={{ display: "grid", gap: 10 }}>
            <Check checked={draft.enabled} onChange={(v) => set("enabled", v)} theme={P}>자동 콜 켜기 (꺼도 브리핑·질문 응답은 동작)</Check>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={label}>Language</span>
                <select value={draft.language} onChange={(e) => set("language", e.target.value as RadioSettings["language"])} style={input}>
                  <option value="ko">한국어</option>
                  <option value="en">English</option>
                </select>
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={label}>Verbosity</span>
                <select value={draft.verbosity} onChange={(e) => set("verbosity", e.target.value as RadioSettings["verbosity"])} style={input}>
                  <option value="minimal">최소 (중요·긴급만)</option>
                  <option value="normal">보통</option>
                  <option value="detailed">상세 (정보성 포함)</option>
                </select>
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={label}>Tyre warning %</span>
                <input type="number" min={30} max={95} value={draft.tyreWearWarnPct} onChange={(e) => set("tyreWearWarnPct", Number(e.target.value))} style={input} />
              </label>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 6 }}>
              {CATEGORY_LABELS.map(([key, text]) => (
                <Check key={key} checked={draft.categories[key]} onChange={(v) => set("categories", { ...draft.categories, [key]: v })} theme={P}>{text}</Check>
              ))}
            </div>
            <Check checked={draft.brakeGate} onChange={(v) => set("brakeGate", v)} theme={P}>제동·코너 중에는 긴급하지 않은 콜을 미루기</Check>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
              {([["briefingButton", "휠 버튼: 브리핑"], ["repeatButton", "휠 버튼: 다시 듣기"]] as const).map(([key, text]) => (
                <label key={key} style={{ display: "grid", gap: 4 }}>
                  <span style={label}>{text}</span>
                  <select value={draft[key]} onChange={(e) => set(key, Number(e.target.value))} style={input}>
                    <option value={0}>사용 안 함</option>
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>UDP Action {n}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <div style={{ fontSize: 10, color: P.muted, lineHeight: 1.6 }}>
              게임 설정 → 컨트롤에서 휠 버튼을 "UDP Action" 번호에 지정하고, 게임 텔레메트리 설정에서 UDP를 켜야 합니다.
            </div>
            <div>
              <button disabled={saving} style={button(P.accent2)} onClick={() => void save()}>SAVE</button>
            </div>
          </div>
        </Section>
      ) : null}

      <Section title="엔지니어에게 질문" theme={P}>
        <div style={{ display: "flex", gap: 8 }}>
          <input value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void ask(); }} placeholder="예: 뒤차 몇 초야? / 연료 어때? / 피트 언제?" style={{ ...input, flex: 1 }} />
          <button style={button(P.accent)} onClick={() => void ask()}>ASK</button>
        </div>
        {answer ? (
          <div style={{ marginTop: 10, fontSize: 12, lineHeight: 1.6 }}>
            <div>{answer.text}</div>
            <div style={{ fontSize: 10, color: P.muted, marginTop: 4 }}>
              intent {answer.intent} · {answer.source === "model" ? "모델 분류" : "키워드 분류"}
              {answer.modelIntent ? ` · model ${answer.modelIntent} (${Math.round((answer.modelProb ?? 0) * 100)}%)` : ""}
            </div>
          </div>
        ) : null}
        <div style={{ fontSize: 10, color: P.muted, marginTop: 8, lineHeight: 1.6 }}>
          답은 항상 실시간 텔레메트리 값으로 만들고, 값이 없으면 모른다고 답합니다. 음성 질문(STT)은 아직 지원하지 않습니다.
        </div>
      </Section>

      {draft ? (
        <Section title="결정 모델 (Jev · laya)" theme={P}>
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ fontSize: 10, color: P.muted, lineHeight: 1.6 }}>
              숫자 계산은 항상 규칙 엔진이 합니다. 모델은 "지금 말할 가치가 있는지"와 질문 의도만 판단합니다.
              섀도 모드는 결과를 기록만 하고, 적용 모드는 긴급하지 않은 콜을 생략할 수 있습니다. 모델 오류 시 항상 규칙대로 말합니다.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 8 }}>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={label}>Mode</span>
                <select value={draft.decision.mode} onChange={(e) => setDecision("mode", e.target.value as RadioSettings["decision"]["mode"])} style={input}>
                  <option value="off">끄기</option>
                  <option value="shadow">섀도 (기록만)</option>
                  <option value="enforce">적용</option>
                </select>
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={label}>Endpoint URL</span>
                <input value={draft.decision.url} onChange={(e) => setDecision("url", e.target.value)} placeholder="http://127.0.0.1:8000 (laya-serve) · https://api.typesafe.ai (Jev)" style={input} />
              </label>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: 8 }}>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={label}>API key {view?.hasApiKey ? "(저장됨)" : ""}</span>
                <input type="password" value={apiKeyDraft} onChange={(e) => setApiKeyDraft(e.target.value)} placeholder={view?.hasApiKey ? "비워 두면 기존 키 유지" : "Bearer key"} style={input} />
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={label}>Model</span>
                <input value={draft.decision.model ?? ""} onChange={(e) => setDecision("model", e.target.value)} placeholder="optional" style={input} />
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={label}>Timeout ms</span>
                <input type="number" min={200} max={10000} value={draft.decision.timeoutMs} onChange={(e) => setDecision("timeoutMs", Number(e.target.value))} style={input} />
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={label}>Speak ≥ prob</span>
                <input type="number" min={0.05} max={0.95} step={0.05} value={draft.decision.speakThreshold} onChange={(e) => setDecision("speakThreshold", Number(e.target.value))} style={input} />
              </label>
            </div>
            <Check checked={draft.decision.allowRemote} onChange={(v) => setDecision("allowRemote", v)} theme={P}>
              외부 서버 허용 (HTTPS 필수). 켜면 레이스 상황 요약과 콜 문장이 해당 서버로 전송됩니다. 드라이버 이름은 보내지 않습니다.
            </Check>
            <Check checked={draft.decision.logDecisions} onChange={(v) => setDecision("logDecisions", v)} theme={P}>
              결정 기록을 sender logs/engineer-decisions.jsonl 에 저장
            </Check>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <button disabled={saving} style={button(P.accent2)} onClick={() => void save()}>SAVE</button>
              {view?.hasApiKey ? <button disabled={saving} style={button(P.dim, P.text)} onClick={() => void save(true)}>CLEAR KEY</button> : null}
              {status ? (
                <span style={{ fontSize: 10, color: status.decisionLastError ? P.danger : P.muted }}>
                  {status.decisionReady ? "ready" : "not configured"} · {status.decisionCount} decisions · {status.decisionErrors} errors
                  {status.shadowSkipped ? ` · ${status.shadowSkipped} skipped` : ""}
                  {status.decisionLastError ? ` · ${status.decisionLastError}` : ""}
                </span>
              ) : null}
            </div>
            {decisions.length ? (
              <div style={{ display: "grid", gap: 4 }}>
                {decisions.map((d, i) => (
                  <div key={`${d.at}-${i}`} style={{ fontSize: 10, color: d.error ? P.danger : P.muted, fontFamily: P.mono, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {formatTime(d.at)} · {d.mode} · {d.kind === "speak" ? `${d.modelAction}${d.speakProb !== undefined ? ` ${Math.round(d.speakProb * 100)}%` : ""}` : `intent ${d.intent ?? "-"}`}
                    {d.applied ? " · applied" : ""} · {d.latencyMs}ms · {d.error ?? d.input ?? ""}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </Section>
      ) : null}

      <Section title="최근 콜" theme={P}>
        {radio.calls.length ? (
          <div style={{ display: "grid", gap: 6 }}>
            {radio.calls.map((call) => (
              <div key={call.id} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <span style={{ width: 4, alignSelf: "stretch", borderRadius: 2, background: PRIORITY_COLORS[call.priority] ?? P.muted }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, lineHeight: 1.5 }}>{call.text}</div>
                  <div style={{ fontSize: 9, color: P.muted, fontFamily: P.mono }}>
                    {formatTime(call.releasedAt)}{call.lap ? ` · L${call.lap}` : ""} · {call.category}
                    {call.basis ? ` · ${BASIS_LABELS[call.basis] ?? call.basis}` : ""}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 11, color: P.muted }}>아직 콜이 없습니다. 레이스 세션에서 텔레메트리가 들어오면 표시됩니다.</div>
        )}
      </Section>
    </div>
  );
}

function Banner({ color, children }: { color: string; children: ReactNode }) {
  return <div style={{ padding: 10, borderRadius: 4, background: `${color}14`, color, fontSize: 11 }}>{children}</div>;
}

function Tile({ label, value, color, theme: P }: { label: string; value: string; color: string; theme: Theme }) {
  return (
    <div style={{ padding: 10, borderRadius: 4, background: P.surface2, border: `1px solid ${P.border}`, minWidth: 0 }}>
      <div style={{ fontSize: 9, color: P.muted, fontFamily: P.mono }}>{label}</div>
      <div style={{ fontSize: 12, fontWeight: 700, color, marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</div>
    </div>
  );
}

function Section({ title, theme: P, children }: { title: string; theme: Theme; children: ReactNode }) {
  return (
    <div style={{ padding: 12, borderRadius: 4, background: P.surface2, border: `1px solid ${P.border}` }}>
      <div style={{ fontSize: 10, color: P.accent, fontFamily: P.mono, letterSpacing: 1, marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}

function Check({ checked, onChange, theme: P, children }: { checked: boolean; onChange: (value: boolean) => void; theme: Theme; children: ReactNode }) {
  return (
    <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 11, color: P.text, lineHeight: 1.5, cursor: "pointer" }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ marginTop: 2 }} />
      <span>{children}</span>
    </label>
  );
}
