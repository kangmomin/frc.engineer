import { useEffect, useState } from "react";
import {
  radioApi,
  type RadioAnswer,
  type RadioCategories,
  type RadioDecisionRecord,
  type RadioSettings,
  type RadioSettingsView,
} from "./radioClient";
import type { EngineerRadio } from "./useEngineerRadio";
import { Button, Card, Check, Field, Grid, Hint, MetricTile, Notice, Range, Row, Select, TextInput, type Tone } from "./ui";

interface Props {
  senderUrl: string;
  radio: EngineerRadio;
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

// 0 정보 · 1 보통 · 2 중요 · 3 긴급
const PRIORITY_COLORS = ["var(--text-muted)", "var(--accent)", "#ffc800", "var(--accent-red)"];
const BASIS_LABELS: Record<string, string> = { game: "게임 값", measured: "측정", heuristic: "휴리스틱" };

function formatTime(iso?: string): string {
  if (!iso) return "--";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "--" : date.toLocaleTimeString();
}

export function EngineerRadioPanel({ senderUrl, radio }: Props) {
  const [view, setView] = useState<RadioSettingsView | null>(null);
  const [draft, setDraft] = useState<RadioSettings | null>(null);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<RadioAnswer | null>(null);
  const [decisions, setDecisions] = useState<RadioDecisionRecord[]>([]);

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
  const platform = draft?.decision.provider === "platform";

  const streamLive = radio.status === "live";
  const telemetryLive = Boolean(status && !status.stale);
  const voiceTone: Tone = radio.prefs.enabled ? "tertiary" : "neutral";

  return (
    <>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {notice ? <Notice tone="success">{notice}</Notice> : null}

      <Grid cols={4}>
        <MetricTile compact label="Stream" value={streamLive ? "Live" : radio.status} tone={streamLive ? "primary" : "secondary"} />
        <MetricTile compact label="Telemetry" value={!status ? "--" : status.stale ? "Waiting" : status.sessionType || "Live"} tone={telemetryLive ? "tertiary" : "neutral"} />
        <MetricTile
          compact
          label="Voice"
          value={!radio.speechSupported ? "Unsupported" : radio.prefs.enabled ? (radio.intercomBusy ? "Held · intercom" : "On") : "Off"}
          tone={voiceTone}
        />
        <MetricTile compact label="Calls" value={status ? `${status.released} sent · ${status.suppressed} cut` : "--"} tone="neutral" />
      </Grid>

      <Row>
        <Button variant="go" onClick={() => void run(() => radioApi.briefing(senderUrl), "브리핑을 요청했습니다.")}>Briefing</Button>
        <Button onClick={() => void run(() => radioApi.repeat(senderUrl), "마지막 콜을 다시 보냅니다.")}>Repeat Last</Button>
        <Button variant="ghost" onClick={() => void run(() => radioApi.test(senderUrl), "라디오 체크를 보냈습니다.")}>Radio Check</Button>
      </Row>

      <Card title="음성 출력">
        {!radio.speechSupported ? (
          <Notice tone="error">이 환경은 음성 합성을 지원하지 않습니다.</Notice>
        ) : (
          <>
            <Check checked={radio.prefs.enabled} onChange={(v) => radio.setPrefs({ enabled: v })}>
              엔지니어 음성 켜기 (인터컴에서 누가 말하는 동안은 긴급 콜만 재생)
            </Check>
            <Grid cols="2fr 1fr 1fr">
              <Field label="Voice">
                <Select value={radio.prefs.voiceURI} onChange={(e) => radio.setPrefs({ voiceURI: e.target.value })}>
                  <option value="">자동 ({radio.language === "en" ? "English" : "한국어"})</option>
                  {radio.voices.map((v) => (
                    <option key={v.voiceURI} value={v.voiceURI}>{v.name} · {v.lang}</option>
                  ))}
                </Select>
              </Field>
              <Field label={`Rate ${radio.prefs.rate.toFixed(1)}`}>
                <Range min={0.6} max={1.8} step={0.1} value={radio.prefs.rate} onChange={(e) => radio.setPrefs({ rate: Number(e.target.value) })} />
              </Field>
              <Field label={`Volume ${Math.round(radio.prefs.volume * 100)}%`}>
                <Range min={0} max={1} step={0.05} value={radio.prefs.volume} onChange={(e) => radio.setPrefs({ volume: Number(e.target.value) })} />
              </Field>
            </Grid>
            <Hint>Windows에 설치된 음성(SAPI5)을 씁니다. 한국어 음성이 없으면 Windows 설정 → 시간 및 언어 → 음성에서 추가하세요.</Hint>
          </>
        )}
      </Card>

      {draft ? (
        <Card title="엔지니어 설정">
          <Check checked={draft.enabled} onChange={(v) => set("enabled", v)}>자동 콜 켜기 (꺼도 브리핑·질문 응답은 동작)</Check>
          <Grid cols={3}>
            <Field label="Language">
              <Select value={draft.language} onChange={(e) => set("language", e.target.value as RadioSettings["language"])}>
                <option value="ko">한국어</option>
                <option value="en">English</option>
              </Select>
            </Field>
            <Field label="Verbosity">
              <Select value={draft.verbosity} onChange={(e) => set("verbosity", e.target.value as RadioSettings["verbosity"])}>
                <option value="minimal">최소 (중요·긴급만)</option>
                <option value="normal">보통</option>
                <option value="detailed">상세 (정보성 포함)</option>
              </Select>
            </Field>
            <Field label="Tyre warning %">
              <TextInput type="number" min={30} max={95} value={draft.tyreWearWarnPct} onChange={(e) => set("tyreWearWarnPct", Number(e.target.value))} />
            </Field>
          </Grid>
          <Grid cols={2} gap={6}>
            {CATEGORY_LABELS.map(([key, text]) => (
              <Check key={key} checked={draft.categories[key]} onChange={(v) => set("categories", { ...draft.categories, [key]: v })}>{text}</Check>
            ))}
          </Grid>
          <Check checked={draft.brakeGate} onChange={(v) => set("brakeGate", v)}>제동·코너 중에는 긴급하지 않은 콜을 미루기</Check>
          <Grid cols={2}>
            {([["briefingButton", "휠 버튼: 브리핑"], ["repeatButton", "휠 버튼: 다시 듣기"]] as const).map(([key, text]) => (
              <Field key={key} label={text}>
                <Select value={draft[key]} onChange={(e) => set(key, Number(e.target.value))}>
                  <option value={0}>사용 안 함</option>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>UDP Action {n}</option>
                  ))}
                </Select>
              </Field>
            ))}
          </Grid>
          <Hint>게임 설정 → 컨트롤에서 휠 버튼을 "UDP Action" 번호에 지정하고, 게임 텔레메트리 설정에서 UDP를 켜야 합니다.</Hint>
          <div>
            <Button variant="go" disabled={saving} busy={saving} onClick={() => void save()}>Save</Button>
          </div>
        </Card>
      ) : null}

      <Card title="엔지니어에게 질문">
        <div style={{ display: "flex", gap: 8 }}>
          <TextInput value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void ask(); }} placeholder="예: 뒤차 몇 초야? / 연료 어때? / 피트 언제?" aria-label="엔지니어에게 질문" />
          <Button onClick={() => void ask()}>Ask</Button>
        </div>
        {answer ? (
          <div>
            <div style={{ fontSize: 13, lineHeight: 1.6 }}>{answer.text}</div>
            <Hint style={{ fontSize: 10.5 }}>
              intent {answer.intent} · {answer.source === "model" ? "모델 분류" : "키워드 분류"}
              {answer.modelIntent ? ` · model ${answer.modelIntent} (${Math.round((answer.modelProb ?? 0) * 100)}%)` : ""}
            </Hint>
          </div>
        ) : null}
        <Hint>답은 항상 실시간 텔레메트리 값으로 만들고, 값이 없으면 모른다고 답합니다. 음성 질문(STT)은 아직 지원하지 않습니다.</Hint>
      </Card>

      {draft ? (
        <Card title="결정 모델 (Jev · laya)">
          <Hint>
            숫자 계산은 항상 규칙 엔진이 합니다. 모델은 "지금 말할 가치가 있는지"와 질문 의도만 판단합니다.
            섀도 모드는 결과를 기록만 하고, 적용 모드는 긴급하지 않은 콜을 생략할 수 있습니다. 모델 오류 시 항상 규칙대로 말합니다.
          </Hint>
          <Grid cols="1fr 2fr">
            <Field label="Mode">
              <Select value={draft.decision.mode} onChange={(e) => setDecision("mode", e.target.value as RadioSettings["decision"]["mode"])}>
                <option value="off">끄기</option>
                <option value="shadow">섀도 (기록만)</option>
                <option value="enforce">적용</option>
              </Select>
            </Field>
            <Field label="Provider">
              <Select value={draft.decision.provider} onChange={(e) => setDecision("provider", e.target.value as RadioSettings["decision"]["provider"])}>
                <option value="platform">플랫폼 기본 제공 (권한 필요)</option>
                <option value="custom">직접 설정 (내 Jev 키 · laya)</option>
              </Select>
            </Field>
          </Grid>
          {platform ? (
            <Hint>
              페어링된 계정에 플랫폼 결정 모델 권한이 있으면 플랫폼 서버가 보관한 키로 Jev를 호출합니다. 키는 이 PC에 저장되지 않습니다.
              레이스 상황 요약과 콜 문장이 플랫폼 서버를 거쳐 결정 모델로 전송되며, 드라이버 이름은 보내지 않습니다.
            </Hint>
          ) : (
            <Field label="Endpoint URL">
              <TextInput value={draft.decision.url} onChange={(e) => setDecision("url", e.target.value)} placeholder="http://127.0.0.1:8000 (laya-serve) · https://api.typesafe.ai (Jev)" />
            </Field>
          )}
          <Grid cols={platform ? 2 : "2fr 1fr 1fr 1fr"}>
            {platform ? null : (
              <>
                <Field label={`API key ${view?.hasApiKey ? "(저장됨)" : ""}`}>
                  <TextInput type="password" value={apiKeyDraft} onChange={(e) => setApiKeyDraft(e.target.value)} placeholder={view?.hasApiKey ? "비워 두면 기존 키 유지" : "Bearer key"} />
                </Field>
                <Field label="Model">
                  <TextInput value={draft.decision.model ?? ""} onChange={(e) => setDecision("model", e.target.value)} placeholder="optional" />
                </Field>
              </>
            )}
            <Field label="Timeout ms">
              <TextInput type="number" min={200} max={10000} value={draft.decision.timeoutMs} onChange={(e) => setDecision("timeoutMs", Number(e.target.value))} />
            </Field>
            <Field label="Speak ≥ prob">
              <TextInput type="number" min={0.05} max={0.95} step={0.05} value={draft.decision.speakThreshold} onChange={(e) => setDecision("speakThreshold", Number(e.target.value))} />
            </Field>
          </Grid>
          {platform ? null : (
            <Check checked={draft.decision.allowRemote} onChange={(v) => setDecision("allowRemote", v)}>
              외부 서버 허용 (HTTPS 필수). 켜면 레이스 상황 요약과 콜 문장이 해당 서버로 전송됩니다. 드라이버 이름은 보내지 않습니다.
            </Check>
          )}
          <Check checked={draft.decision.logDecisions} onChange={(v) => setDecision("logDecisions", v)}>
            결정 기록을 sender logs/engineer-decisions.jsonl 에 저장
          </Check>
          <Row>
            <Button variant="go" disabled={saving} busy={saving} onClick={() => void save()}>Save</Button>
            {view?.hasApiKey && !platform ? <Button variant="ghost" disabled={saving} onClick={() => void save(true)}>Clear Key</Button> : null}
            {status ? (
              <span style={{ fontSize: 11, color: status.decisionLastError ? "var(--accent-red)" : "var(--text-muted)" }}>
                {status.decisionReady ? "ready" : status.decisionUnavailable ?? "not configured"} · {status.decisionCount} decisions · {status.decisionErrors} errors
                {status.shadowSkipped ? ` · ${status.shadowSkipped} skipped` : ""}
                {status.decisionLastError ? ` · ${status.decisionLastError}` : ""}
              </span>
            ) : null}
          </Row>
          {decisions.length ? (
            <div style={{ display: "grid", gap: 4 }}>
              {decisions.map((d, i) => (
                <div key={`${d.at}-${i}`} style={{ fontSize: 10.5, color: d.error ? "var(--accent-red)" : "var(--text-muted)", fontFamily: "var(--font-racing)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {formatTime(d.at)} · {d.mode} · {d.kind === "speak" ? `${d.modelAction}${d.speakProb !== undefined ? ` ${Math.round(d.speakProb * 100)}%` : ""}` : `intent ${d.intent ?? "-"}`}
                  {d.applied ? " · applied" : ""} · {d.latencyMs}ms · {d.error ?? d.input ?? ""}
                </div>
              ))}
            </div>
          ) : null}
        </Card>
      ) : null}

      <Card title="최근 콜">
        {radio.calls.length ? (
          <div style={{ display: "grid", gap: 8 }}>
            {radio.calls.map((call) => (
              <div key={call.id} style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
                <span style={{ width: 3, alignSelf: "stretch", borderRadius: 2, background: PRIORITY_COLORS[call.priority] ?? "var(--text-muted)" }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, lineHeight: 1.5 }}>{call.text}</div>
                  <div style={{ fontSize: 10, letterSpacing: "0.06em", color: "var(--text-muted)", fontFamily: "var(--font-racing)" }}>
                    {formatTime(call.releasedAt)}{call.lap ? ` · L${call.lap}` : ""} · {call.category}
                    {call.basis ? ` · ${BASIS_LABELS[call.basis] ?? call.basis}` : ""}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Hint>아직 콜이 없습니다. 레이스 세션에서 텔레메트리가 들어오면 표시됩니다.</Hint>
        )}
      </Card>
    </>
  );
}
