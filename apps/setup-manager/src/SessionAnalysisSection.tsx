import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";

import {
  buildConditionMismatch,
  buildMetricDelta,
  buildTimeDelta,
  findComparisonLap,
  formatLapTime,
  formatPercent,
  formatTrackTemp,
  formatWeatherLabel,
  getDefaultLapNumber,
  maxTrace,
  normalizeAnalysisServerUrl,
  normalizeSessionAnalysisResult,
  normalizeSessionList,
  averageTrace,
  type AnalysisSessionInfo,
  type ComparisonDelta,
  type ComparisonLap,
  type SessionAnalysisResult,
} from "./sessionAnalysis";
import { fetchJsonWithSenderDebug } from "./senderDebug";
import { AnalysisTraceExplorer } from "./AnalysisTraceExplorer";

interface DriverPackTheme {
  bg: string;
  surface: string;
  surface2: string;
  border: string;
  accent: string;
  accent2: string;
  danger: string;
  text: string;
  muted: string;
  dim: string;
  mono: string;
  sans: string;
}

interface SessionAnalysisSectionProps {
  theme: DriverPackTheme;
  analysisUrl: string;
}

export function SessionAnalysisSection(props: SessionAnalysisSectionProps) {
  const [generation, setGeneration] = useState(0);
  const url = normalizeAnalysisServerUrl(props.analysisUrl);
  return <SessionAnalysisBody key={JSON.stringify([url, generation])} {...props} analysisUrl={url} generation={generation} onReload={() => setGeneration(n => n + 1)} />;
}

function SessionAnalysisBody({ theme, analysisUrl, generation, onReload }: SessionAnalysisSectionProps & { generation: number; onReload: () => void }) {
  const [sessions, setSessions] = useState<AnalysisSessionInfo[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [analysisCache, setAnalysisCache] = useState<Record<string, SessionAnalysisResult>>({});
  const [analysisLoading, setAnalysisLoading] = useState<Record<string, boolean>>({});
  const [analysisErrors, setAnalysisErrors] = useState<Record<string, string | null>>({});
  const [baselineDir, setBaselineDir] = useState<string | null>(null);
  const [comparisonDir, setComparisonDir] = useState<string | null>(null);
  const [baselineLapNum, setBaselineLapNum] = useState<number | null>(null);
  const [comparisonLapNum, setComparisonLapNum] = useState<number | null>(null);
  const requests = useRef(new Map<string, AbortController>());
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; for (const controller of requests.current.values()) controller.abort(); requests.current.clear(); };
  }, []);

  useEffect(() => {
    const normalized = normalizeAnalysisServerUrl(analysisUrl);
    let active = true;
    const controller = new AbortController();

    const loadSessions = async () => {
      setSessionsLoading(true);
      setSessionsError(null);
      try {
        const { data } = await fetchJsonWithSenderDebug<unknown[]>(normalized, "/api/sessions", "session-list", { init: { signal: controller.signal } });
        const nextSessions = normalizeSessionList(data);
        if (!active) {
          return;
        }
        setSessions(nextSessions);
      } catch (error) {
        if (!active) {
          return;
        }
        setSessions([]);
        setSessionsError(error instanceof Error ? error.message : "Failed to load sessions.");
      } finally {
        if (active) {
          setSessionsLoading(false);
        }
      }
    };

    void loadSessions();
    return () => {
      active = false;
      controller.abort();
    };
  }, [analysisUrl]);

  useEffect(() => {
    if (!sessions.length) {
      setBaselineDir(null);
      setComparisonDir(null);
      return;
    }

    const available = sessions.filter((session) => session.hasLapData);
    const preferred = available.length ? available : sessions;

    if (!baselineDir || !sessions.some((session) => session.directory === baselineDir)) {
      setBaselineDir(preferred[0]?.directory ?? null);
    }
    if (!comparisonDir || !sessions.some((session) => session.directory === comparisonDir)) {
      setComparisonDir(preferred[1]?.directory ?? preferred[0]?.directory ?? null);
    }
  }, [baselineDir, comparisonDir, sessions]);

  useEffect(() => {
    void loadAnalysis(baselineDir);
  }, [baselineDir, analysisUrl, sessions]);

  useEffect(() => {
    void loadAnalysis(comparisonDir);
  }, [comparisonDir, analysisUrl, sessions]);

  const baselineResult = baselineDir ? analysisCache[baselineDir] ?? null : null;
  const comparisonResult = comparisonDir ? analysisCache[comparisonDir] ?? null : null;

  useEffect(() => {
    if (!baselineResult) {
      return;
    }
    if (!findComparisonLap(baselineResult, baselineLapNum)) {
      setBaselineLapNum(getDefaultLapNumber(baselineResult));
    }
  }, [baselineLapNum, baselineResult]);

  useEffect(() => {
    if (!comparisonResult) {
      return;
    }
    if (!findComparisonLap(comparisonResult, comparisonLapNum)) {
      setComparisonLapNum(getDefaultLapNumber(comparisonResult));
    }
  }, [comparisonLapNum, comparisonResult]);

  const baselineSession = useMemo(
    () => sessions.find((session) => session.directory === baselineDir) ?? null,
    [baselineDir, sessions],
  );
  const comparisonSession = useMemo(
    () => sessions.find((session) => session.directory === comparisonDir) ?? null,
    [comparisonDir, sessions],
  );

  const baselineLap = findComparisonLap(baselineResult, baselineLapNum);
  const comparisonLap = findComparisonLap(comparisonResult, comparisonLapNum);
  const conditionWarning = buildConditionMismatch(baselineResult, comparisonResult);
  const tyreWarning = baselineLap && comparisonLap && ((baselineLap.compound && comparisonLap.compound && baselineLap.compound !== comparisonLap.compound) || (baselineLap.tireAge !== null && comparisonLap.tireAge !== null && baselineLap.tireAge !== comparisonLap.tireAge)) ? "Tyre compound or age differs; consider this when interpreting the comparison." : null;
  const mismatchWarning = [conditionWarning, tyreWarning].filter(Boolean).join(' ') || null;

  const summaryTiles = useMemo(() => {
    const baselineTopSpeed = maxTrace(baselineLap?.trace.speed ?? []);
    const comparisonTopSpeed = maxTrace(comparisonLap?.trace.speed ?? []);
    const baselineThrottle = averageTrace(baselineLap?.trace.throttle ?? []);
    const comparisonThrottle = averageTrace(comparisonLap?.trace.throttle ?? []);
    const baselineBrake = averageTrace(baselineLap?.trace.brake ?? []);
    const comparisonBrake = averageTrace(comparisonLap?.trace.brake ?? []);

    return [
      { label: "Lap Delta", delta: buildTimeDelta(comparisonLap?.lapTimeMs ?? null, baselineLap?.lapTimeMs ?? null) },
      { label: "S1 Delta", delta: buildTimeDelta(comparisonLap?.sector1Ms ?? null, baselineLap?.sector1Ms ?? null) },
      { label: "S2 Delta", delta: buildTimeDelta(comparisonLap?.sector2Ms ?? null, baselineLap?.sector2Ms ?? null) },
      { label: "S3 Delta", delta: buildTimeDelta(comparisonLap?.sector3Ms ?? null, baselineLap?.sector3Ms ?? null) },
      { label: "Top Speed", delta: buildMetricDelta(comparisonTopSpeed, baselineTopSpeed, { precision: 0, unit: " km/h", mode: "higher" }) },
      { label: "Throttle Avg", delta: buildMetricDelta(comparisonThrottle, baselineThrottle, { scale: 100, precision: 1, unit: "%", mode: "neutral" }) },
      { label: "Brake Avg", delta: buildMetricDelta(comparisonBrake, baselineBrake, { scale: 100, precision: 1, unit: "%", mode: "neutral" }) },
      { label: "Understeer", delta: buildMetricDelta(comparisonLap?.understeerPct ?? null, baselineLap?.understeerPct ?? null, { precision: 1, unit: "%", mode: "lower" }) },
      { label: "Oversteer", delta: buildMetricDelta(comparisonLap?.oversteerPct ?? null, baselineLap?.oversteerPct ?? null, { precision: 1, unit: "%", mode: "lower" }) },
    ];
  }, [baselineLap, comparisonLap]);

  const distanceAxis = baselineResult?.comparison?.distances ?? [];
  const comparisonAxis = comparisonResult?.comparison?.distances ?? [];

  return (
    <>
      <Panel theme={theme} title="SESSION ANALYSIS">
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ fontSize: 11, color: theme.muted, lineHeight: 1.6 }}>
            Compare locally recorded laps by physical distance. Observed time differences and inputs can guide practice; they do not prove the cause of a slower lap.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}>
            <input aria-label="Analysis server URL" value={analysisUrl} readOnly style={inputStyle(theme)} />
            <button
              onClick={onReload}
              style={secondaryButton(theme)}
            >
              REFRESH
            </button>
          </div>
          {sessionsError ? <Banner theme={theme} tone="danger">{sessionsError}</Banner> : null}
          {sessionsLoading ? <div style={{ fontSize: 11, color: theme.muted }}>Loading session list...</div> : null}
        </div>
      </Panel>

      <Panel theme={theme} title="SESSION PICKER">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <SessionSelectorCard
            theme={theme}
            title="BASELINE"
            sessions={sessions}
            selectedDir={baselineDir}
            onSessionChange={(value) => {
              setBaselineDir(value);
              setBaselineLapNum(null);
            }}
            result={baselineResult}
            selectedLapNum={baselineLapNum}
            onLapChange={setBaselineLapNum}
            loading={Boolean(baselineDir && analysisLoading[baselineDir])}
            error={baselineDir ? analysisErrors[baselineDir] ?? null : null}
          />
          <SessionSelectorCard
            theme={theme}
            title="COMPARE"
            sessions={sessions}
            selectedDir={comparisonDir}
            onSessionChange={(value) => {
              setComparisonDir(value);
              setComparisonLapNum(null);
            }}
            result={comparisonResult}
            selectedLapNum={comparisonLapNum}
            onLapChange={setComparisonLapNum}
            loading={Boolean(comparisonDir && analysisLoading[comparisonDir])}
            error={comparisonDir ? analysisErrors[comparisonDir] ?? null : null}
          />
        </div>
      </Panel>

      {mismatchWarning ? (
        <Banner theme={theme} tone="warn">
          {mismatchWarning}
        </Banner>
      ) : null}

      <Panel theme={theme} title="LAP COMPARISON">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, marginBottom: 12 }}>
          {summaryTiles.map((tile) => (
            <DeltaTile key={tile.label} theme={theme} label={tile.label} delta={tile.delta} />
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <LapSummaryCard theme={theme} title="BASELINE" session={baselineSession} lap={baselineLap} />
          <LapSummaryCard theme={theme} title="COMPARE" session={comparisonSession} lap={comparisonLap} />
        </div>
      </Panel>

      <Panel theme={theme} title="NATIVE TRACE EXPLORER">
        <AnalysisTraceExplorer key={JSON.stringify([analysisUrl, generation, baselineDir, baselineLapNum, comparisonDir, comparisonLapNum])}
          theme={theme} url={analysisUrl} generation={generation} baselineDir={baselineDir} baselineLap={baselineLapNum}
          comparisonDir={comparisonDir} comparisonLap={comparisonLapNum} />
      </Panel>
      <Panel theme={theme} title="COARSE TRACES">
        <p style={{ color: theme.muted, fontSize: 11 }}>Binned averages: baseline {baselineResult?.comparison?.distanceBinM ?? '—'} m; compare {comparisonResult?.comparison?.distanceBinM ?? '—'} m. Fine input peaks may be absent.</p>
        {baselineLap && comparisonLap && distanceAxis.length ? (
          <div style={{ display: "grid", gap: 12 }}>
            <TraceOverlayChart
              theme={theme}
              title="Speed"
              distances={distanceAxis}
              comparisonDistances={comparisonAxis}
              baseline={baselineLap.trace.speed}
              comparison={comparisonLap.trace.speed}
              baselineLabel="Baseline"
              comparisonLabel="Compare"
              formatter={(value) => `${value.toFixed(0)} km/h`}
            />
            <TraceOverlayChart
              theme={theme}
              title="Throttle"
              distances={distanceAxis}
              comparisonDistances={comparisonAxis}
              baseline={toPercentSeries(baselineLap.trace.throttle)}
              comparison={toPercentSeries(comparisonLap.trace.throttle)}
              baselineLabel="Baseline"
              comparisonLabel="Compare"
              formatter={(value) => `${value.toFixed(0)}%`}
              min={0}
              max={100}
            />
            <TraceOverlayChart
              theme={theme}
              title="Brake"
              distances={distanceAxis}
              comparisonDistances={comparisonAxis}
              baseline={toPercentSeries(baselineLap.trace.brake)}
              comparison={toPercentSeries(comparisonLap.trace.brake)}
              baselineLabel="Baseline"
              comparisonLabel="Compare"
              formatter={(value) => `${value.toFixed(0)}%`}
              min={0}
              max={100}
            />
            <TraceOverlayChart
              theme={theme}
              title="Understeer Trend"
              distances={distanceAxis}
              comparisonDistances={comparisonAxis}
              baseline={baselineLap.trace.understeer}
              comparison={comparisonLap.trace.understeer}
              baselineLabel="Baseline"
              comparisonLabel="Compare"
              formatter={(value) => `${value.toFixed(1)}%`}
              min={0}
            />
            <TraceOverlayChart
              theme={theme}
              title="Oversteer Trend"
              distances={distanceAxis}
              comparisonDistances={comparisonAxis}
              baseline={baselineLap.trace.oversteer}
              comparison={comparisonLap.trace.oversteer}
              baselineLabel="Baseline"
              comparisonLabel="Compare"
              formatter={(value) => `${value.toFixed(1)}%`}
              min={0}
            />
          </div>
        ) : (
          <div style={{ fontSize: 11, color: theme.muted }}>
            Select two analysis-ready sessions and laps to render trace overlays.
          </div>
        )}
      </Panel>
    </>
  );

  async function loadAnalysis(dir: string | null): Promise<void> {
    if (!dir || analysisCache[dir] || requests.current.has(dir)) {
      return;
    }

    const session = sessions.find((item) => item.directory === dir);
    if (!session?.hasLapData) {
      setAnalysisErrors((current) => ({ ...current, [dir]: "This session is missing files required for lap comparison." }));
      return;
    }

    const normalized = normalizeAnalysisServerUrl(analysisUrl);
    const controller = new AbortController();
    requests.current.set(dir, controller);
    const owns = () => alive.current && requests.current.get(dir) === controller;
    setAnalysisLoading((current) => ({ ...current, [dir]: true }));
    setAnalysisErrors((current) => ({ ...current, [dir]: null }));

    try {
      const { data } = await fetchJsonWithSenderDebug(
        normalized,
        `/api/sessions/${encodeURIComponent(dir)}/analysis`,
        "session-analysis",
        { init: { signal: controller.signal } },
      );
      if (!owns()) return;
      const next = normalizeSessionAnalysisResult(data);
      setAnalysisCache((current) => ({ ...current, [dir]: next }));
    } catch (error) {
      if (!owns()) return;
      setAnalysisErrors((current) => ({
        ...current,
        [dir]: error instanceof Error ? error.message : "Failed to load session analysis.",
      }));
    } finally {
      if (owns()) { requests.current.delete(dir); setAnalysisLoading((current) => ({ ...current, [dir]: false })); }
    }
  }
}

function SessionSelectorCard({
  theme,
  title,
  sessions,
  selectedDir,
  onSessionChange,
  result,
  selectedLapNum,
  onLapChange,
  loading,
  error,
}: {
  theme: DriverPackTheme;
  title: string;
  sessions: AnalysisSessionInfo[];
  selectedDir: string | null;
  onSessionChange: (value: string | null) => void;
  result: SessionAnalysisResult | null;
  selectedLapNum: number | null;
  onLapChange: (value: number | null) => void;
  loading: boolean;
  error: string | null;
}) {
  const selectedSession = sessions.find((session) => session.directory === selectedDir) ?? null;
  const laps = result?.comparison?.laps ?? [];

  return (
    <div style={{ borderRadius: 4, background: theme.surface2, padding: 12, display: "grid", gap: 10 }}>
      <div style={{ fontSize: 11, fontFamily: theme.mono, fontWeight: 700 }}>{title}</div>
      <select
        aria-label={`${title} session`}
        value={selectedDir ?? ""}
        onChange={(event) => onSessionChange(event.target.value || null)}
        style={selectStyle(theme)}
      >
        <option value="">Select session</option>
        {sessions.map((session) => (
          <option key={session.directory} value={session.directory}>
            {session.trackName ?? session.directory} / {session.sessionType ?? "Unknown"}{session.analysisAvailable ? "" : " / incomplete"}
          </option>
        ))}
      </select>
      <select
        aria-label={`${title} lap`}
        value={selectedLapNum ?? ""}
        onChange={(event) => onLapChange(event.target.value ? Number(event.target.value) : null)}
        style={selectStyle(theme)}
        disabled={!laps.length}
      >
        <option value="">Select lap</option>
        {laps.map((lap) => (
          <option key={lap.lapNum} value={lap.lapNum}>
            Lap {lap.lapNum} / {formatLapTime(lap.lapTimeMs)}
          </option>
        ))}
      </select>

      {selectedSession ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <MiniStat theme={theme} label="Track" value={selectedSession.trackName ?? "--"} />
          <MiniStat theme={theme} label="Weather" value={formatWeatherLabel(selectedSession.weather)} />
          <MiniStat theme={theme} label="Session" value={selectedSession.sessionType ?? "--"} />
          <MiniStat theme={theme} label="Track Temp" value={formatTrackTemp(selectedSession.trackTemp)} />
        </div>
      ) : null}

      {loading ? <div style={{ fontSize: 10, color: theme.muted }}>Loading analysis...</div> : null}
      {error ? <Banner theme={theme} tone="danger">{error}</Banner> : null}
    </div>
  );
}

function LapSummaryCard({
  theme,
  title,
  session,
  lap,
}: {
  theme: DriverPackTheme;
  title: string;
  session: AnalysisSessionInfo | null;
  lap: ComparisonLap | null;
}) {
  return (
    <div style={{ borderRadius: 4, background: theme.surface2, padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
        <div style={{ fontSize: 11, fontFamily: theme.mono, fontWeight: 700 }}>{title}</div>
        <div style={{ fontSize: 10, color: theme.muted }}>{session?.timestamp ?? "--"}</div>
      </div>
      <div style={{ fontSize: 11, color: theme.muted, lineHeight: 1.6, marginBottom: 10 }}>
        {session?.trackName ?? "Unknown Track"} / {session?.sessionType ?? "Session"} / {formatWeatherLabel(session?.weather)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
        <MiniStat theme={theme} label="Lap Time" value={formatLapTime(lap?.lapTimeMs)} />
        <MiniStat theme={theme} label="S1" value={formatLapTime(lap?.sector1Ms)} />
        <MiniStat theme={theme} label="S2" value={formatLapTime(lap?.sector2Ms)} />
        <MiniStat theme={theme} label="S3" value={formatLapTime(lap?.sector3Ms)} />
        <MiniStat theme={theme} label="Tyres / age" value={`${lap?.compound ?? "--"} / ${lap?.tireAge ?? "--"}`} />
        <MiniStat theme={theme} label="Heavy braking (lockup unconfirmed)" value={lap?.lockupCount === null || lap?.lockupCount === undefined ? "--" : String(lap.lockupCount)} />
        <MiniStat theme={theme} label="Under" value={formatPercent(lap?.understeerPct)} />
        <MiniStat theme={theme} label="Over" value={formatPercent(lap?.oversteerPct)} />
      </div>
    </div>
  );
}

function DeltaTile({
  theme,
  label,
  delta,
}: {
  theme: DriverPackTheme;
  label: string;
  delta: ComparisonDelta;
}) {
  const color =
    delta.direction === "better"
      ? theme.accent2
      : delta.direction === "worse"
        ? theme.danger
        : delta.direction === "same"
          ? theme.muted
          : theme.text;

  return (
    <div style={{ padding: 12, borderRadius: 4, background: theme.surface2 }}>
      <div style={{ fontSize: 10, color: theme.muted, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color }}>{delta.text}</div>
    </div>
  );
}

function MiniStat({
  theme,
  label,
  value,
}: {
  theme: DriverPackTheme;
  label: string;
  value: string;
}) {
  return (
    <div style={{ padding: "8px 10px", borderRadius: 4, background: "rgba(255,255,255,0.04)" }}>
      <div style={{ fontSize: 9, color: theme.muted, marginBottom: 4, fontFamily: theme.mono }}>{label}</div>
      <div style={{ fontSize: 12, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function TraceOverlayChart({
  theme,
  title,
  distances,
  comparisonDistances,
  baseline,
  comparison,
  baselineLabel,
  comparisonLabel,
  formatter,
  min,
  max,
}: {
  theme: DriverPackTheme;
  title: string;
  distances: number[];
  comparisonDistances: number[];
  baseline: Array<number | null>;
  comparison: Array<number | null>;
  baselineLabel: string;
  comparisonLabel: string;
  formatter: (value: number) => string;
  min?: number;
  max?: number;
}) {
  const width = 620;
  const height = 180;
  const allValues = [...baseline, ...comparison].filter((value): value is number => typeof value === "number");
  const minValue = typeof min === "number" ? min : allValues.length ? Math.min(...allValues) : 0;
  const maxValue = typeof max === "number" ? max : allValues.length ? Math.max(...allValues) : 1;
  const safeMax = maxValue <= minValue ? minValue + 1 : maxValue;
  const xMax = Math.max(...distances, ...comparisonDistances, 1);
  const baselinePath = buildSeriesPath(distances, baseline, width, height, minValue, safeMax, xMax);
  const comparisonPath = buildSeriesPath(comparisonDistances, comparison, width, height, minValue, safeMax, xMax);

  return (
    <div style={{ borderRadius: 4, background: theme.surface2, padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700 }}>{title}</div>
          <div style={{ fontSize: 10, color: theme.muted }}>{formatter(safeMax)} peak / {formatter(minValue)} floor</div>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", fontSize: 10, color: theme.muted }}>
          <LegendSwatch color={theme.accent} label={`${baselineLabel} — solid`} />
          <LegendSwatch color={theme.accent2} label={`${comparisonLabel} – dashed`} />
        </div>
      </div>
      <svg role="img" aria-label={`${title} coarse distance trace`} viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: "auto", display: "block" }}>
        <rect x="0" y="0" width={width} height={height} fill="transparent" />
        {[0.25, 0.5, 0.75].map((ratio) => (
          <line key={ratio} x1="0" x2={width} y1={height * ratio} y2={height * ratio} stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
        ))}
        <path d={baselinePath} fill="none" stroke={theme.accent} strokeWidth="3" strokeLinecap="round" />
        <path d={comparisonPath} fill="none" stroke={theme.accent2} strokeDasharray="8 5" strokeWidth="3" strokeLinecap="round" />
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 10, color: theme.muted }}>
        <span>Start</span>
        <span>{distances.length ? `${distances[distances.length - 1].toFixed(0)}m` : "--"}</span>
      </div>
    </div>
  );
}

function Banner({
  theme,
  tone,
  children,
}: {
  theme: DriverPackTheme;
  tone: "warn" | "danger";
  children: string;
}) {
  const color = tone === "danger" ? theme.danger : theme.accent2;
  return (
    <div style={{ padding: "10px 12px", borderRadius: 4, border: `1px solid ${color}33`, background: `${color}12`, color }}>
      {children}
    </div>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <span style={{ width: 10, height: 10, borderRadius: "50%", background: color, display: "inline-block" }} />
      <span>{label}</span>
    </div>
  );
}

function Panel({
  theme,
  title,
  children,
}: {
  theme: DriverPackTheme;
  title: string;
  children: ReactNode;
}) {
  return (
    <section style={{ background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: 4, overflow: "hidden" }}>
      <div style={{ padding: "12px 16px 10px", borderBottom: `1px solid ${theme.border}`, fontSize: 12, fontFamily: theme.mono, fontWeight: 700, letterSpacing: 2, color: theme.muted }}>
        {title}
      </div>
      <div style={{ padding: "14px 16px", minWidth: 0, overflowX: "auto", overflowY: "visible" }}>{children}</div>
    </section>
  );
}

function inputStyle(theme: DriverPackTheme): CSSProperties {
  return {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 4,
    border: `1px solid ${theme.border}`,
    background: theme.surface2,
    color: theme.text,
    fontFamily: theme.mono,
  };
}

function selectStyle(theme: DriverPackTheme): CSSProperties {
  return {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 4,
    border: `1px solid ${theme.border}`,
    background: theme.bg,
    color: theme.text,
    fontFamily: theme.mono,
  };
}

function primaryButton(theme: DriverPackTheme): CSSProperties {
  return {
    padding: "10px 12px",
    borderRadius: 4,
    border: "none",
    background: theme.accent,
    color: theme.bg,
    cursor: "pointer",
    fontFamily: theme.mono,
  };
}

function secondaryButton(theme: DriverPackTheme): CSSProperties {
  return {
    padding: "10px 12px",
    borderRadius: 4,
    border: `1px solid ${theme.border}`,
    background: "transparent",
    color: theme.text,
    cursor: "pointer",
    fontFamily: theme.mono,
  };
}

function toPercentSeries(series: Array<number | null>): Array<number | null> {
  return series.map((value) => (typeof value === "number" ? value * 100 : null));
}

function buildSeriesPath(
  distances: number[],
  series: Array<number | null>,
  width: number,
  height: number,
  minValue: number,
  maxValue: number,
  xMax: number,
): string {
  if (!distances.length || !series.length) {
    return "";
  }

  const valueRange = maxValue - minValue || 1;
  let path = "";
  let drawing = false;

  for (let index = 0; index < series.length && index < distances.length; index += 1) {
    const value = series[index];
    if (typeof value !== "number") {
      drawing = false;
      continue;
    }
    const x = (distances[index] / xMax) * width;
    const y = height - ((value - minValue) / valueRange) * height;
    path += drawing ? ` L ${x.toFixed(2)} ${y.toFixed(2)}` : ` M ${x.toFixed(2)} ${y.toFixed(2)}`;
    drawing = true;
  }

  return path;
}
