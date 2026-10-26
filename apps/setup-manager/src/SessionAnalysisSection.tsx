import { useEffect, useMemo, useRef, useState } from "react";

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
import { Button, Card, Grid, Hint, MetricTile, Notice, Panel, Select, Spread, T, type Tone } from "./ui";

// 트레이스 차트(SVG)용 토큰 — 차트 컴포넌트는 테스트에서 임의 색을 주입할 수 있도록 theme prop을 유지한다.
const CHART_THEME = { surface2: T.inset, text: T.text, muted: T.muted, accent: T.accent, accent2: T.lime, border: T.borderStrong, bg: T.bg };

interface SessionAnalysisSectionProps {
  analysisUrl: string;
}

export function SessionAnalysisSection(props: SessionAnalysisSectionProps) {
  const [generation, setGeneration] = useState(0);
  const url = normalizeAnalysisServerUrl(props.analysisUrl);
  return <SessionAnalysisBody key={JSON.stringify([url, generation])} {...props} analysisUrl={url} generation={generation} onReload={() => setGeneration(n => n + 1)} />;
}

function SessionAnalysisBody({ analysisUrl, generation, onReload }: SessionAnalysisSectionProps & { generation: number; onReload: () => void }) {
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

  const traceCharts: Array<{ title: string; baseline: Array<number | null>; comparison: Array<number | null>; formatter: (value: number) => string; min?: number; max?: number }> =
    baselineLap && comparisonLap
      ? [
          { title: "Speed", baseline: baselineLap.trace.speed, comparison: comparisonLap.trace.speed, formatter: (value) => `${value.toFixed(0)} km/h` },
          { title: "Throttle", baseline: toPercentSeries(baselineLap.trace.throttle), comparison: toPercentSeries(comparisonLap.trace.throttle), formatter: (value) => `${value.toFixed(0)}%`, min: 0, max: 100 },
          { title: "Brake", baseline: toPercentSeries(baselineLap.trace.brake), comparison: toPercentSeries(comparisonLap.trace.brake), formatter: (value) => `${value.toFixed(0)}%`, min: 0, max: 100 },
          { title: "Understeer Trend", baseline: baselineLap.trace.understeer, comparison: comparisonLap.trace.understeer, formatter: (value) => `${value.toFixed(1)}%`, min: 0 },
          { title: "Oversteer Trend", baseline: baselineLap.trace.oversteer, comparison: comparisonLap.trace.oversteer, formatter: (value) => `${value.toFixed(1)}%`, min: 0 },
        ]
      : [];

  return (
    <>
      <Panel
        title="Session Analysis"
        detail={sessionsLoading ? "Loading sessions" : `${sessions.length} sessions`}
        actions={
          <Button size="sm" variant="ghost" onClick={onReload}>
            Refresh
          </Button>
        }
      >
        <Hint>
          Compare locally recorded laps by physical distance. Observed time differences and inputs can guide practice; they do not prove the cause of a slower lap.
        </Hint>
        {sessionsError ? <Notice tone="error">{sessionsError}</Notice> : null}
      </Panel>

      <Panel title="Session Picker">
        <Grid cols={2} gap={12}>
          <SessionSelectorCard
            title="Baseline"
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
            title="Compare"
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
        </Grid>
      </Panel>

      {mismatchWarning ? <Notice tone="warn">{mismatchWarning}</Notice> : null}

      <Panel title="Lap Comparison" detail="Compare − Baseline">
        <Grid cols={3}>
          {summaryTiles.map((tile) => (
            <MetricTile key={tile.label} compact label={tile.label} value={tile.delta.text} tone={deltaTone(tile.delta)} />
          ))}
        </Grid>
        <Grid cols={2}>
          <LapSummaryCard title="Baseline" session={baselineSession} lap={baselineLap} />
          <LapSummaryCard title="Compare" session={comparisonSession} lap={comparisonLap} />
        </Grid>
      </Panel>

      <Panel title="Native Trace Explorer">
        <AnalysisTraceExplorer key={JSON.stringify([analysisUrl, generation, baselineDir, baselineLapNum, comparisonDir, comparisonLapNum])}
          theme={CHART_THEME} url={analysisUrl} generation={generation} baselineDir={baselineDir} baselineLap={baselineLapNum}
          comparisonDir={comparisonDir} comparisonLap={comparisonLapNum} />
      </Panel>
      <Panel title="Coarse Traces" detail="Binned averages">
        <Hint>Binned averages: baseline {baselineResult?.comparison?.distanceBinM ?? '—'} m; compare {comparisonResult?.comparison?.distanceBinM ?? '—'} m. Fine input peaks may be absent.</Hint>
        {traceCharts.length && distanceAxis.length ? (
          traceCharts.map((chart) => (
            <TraceOverlayChart
              key={chart.title}
              title={chart.title}
              distances={distanceAxis}
              comparisonDistances={comparisonAxis}
              baseline={chart.baseline}
              comparison={chart.comparison}
              baselineLabel="Baseline"
              comparisonLabel="Compare"
              formatter={chart.formatter}
              min={chart.min}
              max={chart.max}
            />
          ))
        ) : (
          <Hint>Select two analysis-ready sessions and laps to render trace overlays.</Hint>
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

function deltaTone(delta: ComparisonDelta): Tone {
  if (delta.direction === "better") return "tertiary";
  if (delta.direction === "worse") return "secondary";
  return "neutral";
}

function SessionSelectorCard({
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
    <Card title={title} aside={loading ? <Hint>Loading analysis…</Hint> : null}>
      <Select aria-label={`${title.toUpperCase()} session`} value={selectedDir ?? ""} onChange={(event) => onSessionChange(event.target.value || null)}>
        <option value="">Select session</option>
        {sessions.map((session) => (
          <option key={session.directory} value={session.directory}>
            {session.trackName ?? session.directory} / {session.sessionType ?? "Unknown"}{session.analysisAvailable ? "" : " / incomplete"}
          </option>
        ))}
      </Select>
      <Select aria-label={`${title.toUpperCase()} lap`} value={selectedLapNum ?? ""} onChange={(event) => onLapChange(event.target.value ? Number(event.target.value) : null)} disabled={!laps.length}>
        <option value="">Select lap</option>
        {laps.map((lap) => (
          <option key={lap.lapNum} value={lap.lapNum}>
            Lap {lap.lapNum} / {formatLapTime(lap.lapTimeMs)}
          </option>
        ))}
      </Select>

      {selectedSession ? (
        <Grid cols={2}>
          <MetricTile compact label="Track" value={selectedSession.trackName ?? "--"} tone="neutral" />
          <MetricTile compact label="Weather" value={formatWeatherLabel(selectedSession.weather)} tone="neutral" />
          <MetricTile compact label="Session" value={selectedSession.sessionType ?? "--"} tone="neutral" />
          <MetricTile compact label="Track Temp" value={formatTrackTemp(selectedSession.trackTemp)} tone="neutral" />
        </Grid>
      ) : null}

      {error ? <Notice tone="error">{error}</Notice> : null}
    </Card>
  );
}

function LapSummaryCard({
  title,
  session,
  lap,
}: {
  title: string;
  session: AnalysisSessionInfo | null;
  lap: ComparisonLap | null;
}) {
  return (
    <Card title={title} aside={<Hint>{session?.timestamp ?? "--"}</Hint>}>
      <Hint>
        {session?.trackName ?? "Unknown Track"} / {session?.sessionType ?? "Session"} / {formatWeatherLabel(session?.weather)}
      </Hint>
      <Grid cols={2}>
        <MetricTile compact label="Lap Time" value={formatLapTime(lap?.lapTimeMs)} tone="primary" />
        <MetricTile compact label="S1" value={formatLapTime(lap?.sector1Ms)} tone="neutral" />
        <MetricTile compact label="S2" value={formatLapTime(lap?.sector2Ms)} tone="neutral" />
        <MetricTile compact label="S3" value={formatLapTime(lap?.sector3Ms)} tone="neutral" />
        <MetricTile compact label="Tyres / age" value={`${lap?.compound ?? "--"} / ${lap?.tireAge ?? "--"}`} tone="neutral" />
        <MetricTile compact label="Heavy braking" note="Lockup unconfirmed" value={lap?.lockupCount === null || lap?.lockupCount === undefined ? "--" : String(lap.lockupCount)} tone="neutral" />
        <MetricTile compact label="Under" value={formatPercent(lap?.understeerPct)} tone="neutral" />
        <MetricTile compact label="Over" value={formatPercent(lap?.oversteerPct)} tone="neutral" />
      </Grid>
    </Card>
  );
}

function TraceOverlayChart({
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
    <Card
      title={title}
      aside={
        <div style={{ display: "flex", gap: 12, alignItems: "center", fontSize: 10.5, color: T.muted }}>
          <LegendSwatch color={T.accent} label={`${baselineLabel} — solid`} />
          <LegendSwatch color={T.lime} label={`${comparisonLabel} – dashed`} />
        </div>
      }
    >
      <Hint style={{ fontSize: 10.5 }}>{formatter(safeMax)} peak / {formatter(minValue)} floor</Hint>
      <svg role="img" aria-label={`${title} coarse distance trace`} viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: "auto", display: "block" }}>
        {[0.25, 0.5, 0.75].map((ratio) => (
          <line key={ratio} x1="0" x2={width} y1={height * ratio} y2={height * ratio} stroke="rgba(132, 147, 150, 0.1)" strokeWidth="1" />
        ))}
        <path d={baselinePath} fill="none" style={{ stroke: T.accent }} strokeWidth="3" strokeLinecap="round" />
        <path d={comparisonPath} fill="none" style={{ stroke: T.lime }} strokeDasharray="8 5" strokeWidth="3" strokeLinecap="round" />
      </svg>
      <Spread style={{ fontSize: 10.5, color: T.muted }}>
        <span>Start</span>
        <span>{distances.length ? `${distances[distances.length - 1].toFixed(0)}m` : "--"}</span>
      </Spread>
    </Card>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <span style={{ width: 10, height: 3, borderRadius: 2, background: color, display: "inline-block" }} />
      <span>{label}</span>
    </span>
  );
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
