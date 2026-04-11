import { useEffect, useMemo, useState, type ReactNode } from "react";

import {
  SETUP_FIELDS,
  SETUP_FIELD_DEFS,
  SETUP_META,
  SORTED_TEAMS,
  SENDER_TRACK_MAP,
  TRACKS,
  type SetupMeta,
  type SetupValues,
  getCompatibilityLabel,
  getCompatibilityScore,
  getDbKey,
  getSetupFeel,
  getSetupTags,
  getTrackCatalog,
} from "../../../shared/setup-manager/catalog";

type TabId = "setup" | "telemetry" | "settings";
type Mode = "equal" | "nonequal" | null;
type WeatherMode = "dry" | "rain" | null;
type Severity = "high" | "med" | "low";

interface SenderStatus {
  currentTrack?: { name?: string };
  driverPermissions?: { pitwall?: boolean; overlay?: boolean; setupSupport?: boolean };
}

interface SenderSession {
  sessionType?: string;
  weather?: string;
  trackTemp?: number;
  trackName?: string;
}

interface SenderDynamics {
  understeerPct?: number;
  oversteerPct?: number;
  lockupCount?: number;
}

interface SenderPlayer {
  tireWear?: number[];
  tireInnerTemp?: number[];
  fuelRemainingLaps?: number;
  tireAge?: number;
  tireCompound?: string;
  topSpeed?: number;
  bestLapTime?: number;
  lastLapTime?: number;
  brakeBias?: number;
  currentLapNum?: number;
  dynamics?: SenderDynamics[];
}

interface TelemetrySnapshot {
  ts: number;
  player: SenderPlayer;
}

interface SetupTip {
  issue: string;
  severity: Severity;
  reason: string;
  changes: string[];
}

const DEFAULT_SENDER_URL = "http://localhost:8099";

const P = {
  bg: "#131314",
  surface: "rgba(32, 31, 32, 0.92)",
  surface2: "#201f20",
  border: "rgba(59, 73, 76, 0.15)",
  accent: "#00e5ff",
  accent2: "#cdff13",
  danger: "#ff525c",
  text: "#e5e2e3",
  muted: "#849396",
  dim: "#3b494c",
  mono: "'Space Grotesk', sans-serif",
  sans: "'Inter', sans-serif",
};

function normalizeSenderUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  return trimmed || DEFAULT_SENDER_URL;
}

function severityColor(severity: Severity): string {
  if (severity === "high") return P.danger;
  if (severity === "med") return P.accent;
  return P.dim;
}

function formatLapTime(value?: number): string {
  return value && value > 0 ? `${(value / 1000).toFixed(3)}s` : "--";
}

function MetricBar({ value, min, max }: { value: number; min: number; max: number }) {
  const percent = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
  const color = percent < 33 ? P.accent : percent < 66 ? P.accent2 : P.danger;

  return (
    <div style={{ height: 4, borderRadius: 999, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
      <div style={{ width: `${percent}%`, height: "100%", borderRadius: 999, background: color }} />
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ background: P.surface, border: `1px solid ${P.border}`, borderRadius: 4, overflow: "hidden" }}>
      <div style={{ padding: "12px 16px 10px", borderBottom: `1px solid ${P.border}`, fontSize: 12, fontFamily: P.mono, fontWeight: 700, letterSpacing: 2, color: P.muted }}>
        {title}
      </div>
      <div style={{ padding: "14px 16px" }}>{children}</div>
    </section>
  );
}

function useSenderConnection(senderUrl: string) {
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<SenderStatus | null>(null);
  const [session, setSession] = useState<SenderSession | null>(null);
  const [player, setPlayer] = useState<SenderPlayer | null>(null);

  useEffect(() => {
    const normalized = normalizeSenderUrl(senderUrl);
    let active = true;

    const poll = async () => {
      try {
        const statusRes = await fetch(`${normalized}/api/status`);
        const nextStatus = (await statusRes.json()) as SenderStatus;
        if (!active) return;
        setStatus(nextStatus);
        setConnected(true);
      } catch {
        if (!active) return;
        setConnected(false);
        setStatus(null);
      }

      try {
        const debugRes = await fetch(`${normalized}/api/debug`);
        const debugData = (await debugRes.json()) as {
          pitwallState?: { session?: SenderSession; drivers?: SenderPlayer[]; playerIndex?: number };
        };
        if (!active) return;
        const drivers = debugData.pitwallState?.drivers ?? [];
        const playerIndex = debugData.pitwallState?.playerIndex ?? -1;
        setSession(debugData.pitwallState?.session ?? null);
        setPlayer(playerIndex >= 0 && playerIndex < drivers.length ? drivers[playerIndex] ?? null : null);
      } catch {
        if (!active) return;
        setSession(null);
        setPlayer(null);
      }
    };

    void poll();
    const interval = window.setInterval(() => void poll(), 3000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [senderUrl]);

  const rawTrack = status?.currentTrack?.name;
  const detectedTrack = rawTrack ? SENDER_TRACK_MAP[rawTrack] ?? null : null;
  return { connected, status, session, player, detectedTrack };
}

function buildSetupTips(snaps: TelemetrySnapshot[]): SetupTip[] {
  if (snaps.length < 2) return [];

  const first = snaps[0].player;
  const last = snaps[snaps.length - 1].player;
  const wear = last.tireWear;
  const firstWear = first.tireWear;
  const temps = last.tireInnerTemp;
  const dynamics = last.dynamics?.length ? last.dynamics[last.dynamics.length - 1] : undefined;
  const tips: SetupTip[] = [];

  if (wear && wear.length >= 4 && temps && temps.length >= 4) {
    const frontWear = (wear[0] + wear[1]) / 2;
    const rearWear = (wear[2] + wear[3]) / 2;
    const frontTemp = (temps[0] + temps[1]) / 2;
    const rearTemp = (temps[2] + temps[3]) / 2;

    if (frontWear > rearWear + 8 || (dynamics?.understeerPct ?? 0) > 10) {
      tips.push({ issue: "Understeer", severity: frontWear > rearWear + 15 ? "high" : "med", reason: `Front wear ${frontWear.toFixed(0)}% vs rear ${rearWear.toFixed(0)}%.`, changes: ["Front Wing +2", "Front ARB -1", "Off Throttle Diff +5"] });
    }
    if (rearWear > frontWear + 8 || (dynamics?.oversteerPct ?? 0) > 10) {
      tips.push({ issue: "Oversteer", severity: rearWear > frontWear + 15 ? "high" : "med", reason: `Rear wear ${rearWear.toFixed(0)}% vs front ${frontWear.toFixed(0)}%.`, changes: ["Rear Wing +2", "Rear Suspension -1", "Brake Bias -1"] });
    }
    if (frontTemp > 105) {
      tips.push({ issue: "Front temps high", severity: frontTemp > 115 ? "high" : "med", reason: `Front inner temp ${frontTemp.toFixed(0)}C.`, changes: ["Front PSI -0.2", "Front Wing -1"] });
    }
    if (rearTemp > 105) {
      tips.push({ issue: "Rear temps high", severity: rearTemp > 115 ? "high" : "med", reason: `Rear inner temp ${rearTemp.toFixed(0)}C.`, changes: ["Rear PSI -0.2", "On Throttle Diff -5"] });
    }
  }

  if (dynamics?.lockupCount && dynamics.lockupCount > 2) {
    tips.push({ issue: "Brake lockups", severity: dynamics.lockupCount > 4 ? "high" : "med", reason: `${dynamics.lockupCount} lockups in the latest lap sample.`, changes: ["Brake Pressure -2", "Brake Bias -1"] });
  }

  if (firstWear && wear && firstWear.length >= 4 && wear.length >= 4) {
    const deltas = wear.map((value, index) => value - (firstWear[index] ?? value));
    const worst = Math.max(...deltas);
    if (worst > 18) {
      tips.push({ issue: "Tyre wear rate", severity: worst > 25 ? "high" : "med", reason: `Worst tyre delta ${worst.toFixed(1)}%.`, changes: ["PSI +0.2", "Wing -1"] });
    }
  }

  return tips.length ? tips : [{ issue: "Stable run", severity: "low", reason: "No major setup issue stood out in the recording.", changes: [] }];
}

export function F1SetupManager() {
  const [tab, setTab] = useState<TabId>("setup");
  const [senderUrl, setSenderUrl] = useState(DEFAULT_SENDER_URL);
  const [draftSenderUrl, setDraftSenderUrl] = useState(DEFAULT_SENDER_URL);

  const [track, setTrack] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(null);
  const [team, setTeam] = useState<string | null>(null);
  const [weather, setWeather] = useState<WeatherMode>(null);
  const [selectedMeta, setSelectedMeta] = useState<SetupMeta | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [group, setGroup] = useState("all");

  const [recording, setRecording] = useState(false);
  const [recordedSnaps, setRecordedSnaps] = useState<TelemetrySnapshot[]>([]);

  useEffect(() => {
    const saved = window.electronAPI?.getAllSettings
      ? undefined
      : localStorage.getItem("frc_sender_url");

    if (saved) {
      const normalized = normalizeSenderUrl(saved);
      setSenderUrl(normalized);
      setDraftSenderUrl(normalized);
      return;
    }

    window.electronAPI?.getAllSettings?.().then((settings) => {
      const normalized = normalizeSenderUrl(settings?.frc_sender_url ?? DEFAULT_SENDER_URL);
      setSenderUrl(normalized);
      setDraftSenderUrl(normalized);
    });
  }, []);

  const saveSenderUrl = async () => {
    const normalized = normalizeSenderUrl(draftSenderUrl);
    setSenderUrl(normalized);
    setDraftSenderUrl(normalized);
    if (window.electronAPI?.setSetting) await window.electronAPI.setSetting("frc_sender_url", normalized);
    else localStorage.setItem("frc_sender_url", normalized);
  };

  const { connected: senderConnected, status: senderStatus, session: liveSession, player: livePlayer, detectedTrack } = useSenderConnection(senderUrl);
  const permissionsKnown = Boolean(senderStatus?.driverPermissions);
  const canUseSetup = permissionsKnown ? Boolean(senderStatus?.driverPermissions?.setupSupport) : true;
  const canUseTelemetry = permissionsKnown ? Boolean(senderStatus?.driverPermissions?.overlay) : true;

  useEffect(() => {
    if (tab === "setup" && !canUseSetup) setTab("settings");
    if (tab === "telemetry" && !canUseTelemetry) setTab("settings");
  }, [canUseSetup, canUseTelemetry, tab]);

  useEffect(() => {
    if (!recording || !livePlayer) return;
    setRecordedSnaps((current) => [...current, { ts: Date.now(), player: { ...livePlayer, tireWear: livePlayer.tireWear ? [...livePlayer.tireWear] : undefined, tireInnerTemp: livePlayer.tireInnerTemp ? [...livePlayer.tireInnerTemp] : undefined, dynamics: livePlayer.dynamics?.map((item) => ({ ...item })) } }]);
  }, [livePlayer, recording]);

  const catalog = useMemo(() => getTrackCatalog(track), [track]);
  const selectedTeam = useMemo(() => SORTED_TEAMS.find((item) => item.name === team) ?? null, [team]);
  const selectedSetup = selectedMeta && catalog ? (catalog[getDbKey(selectedMeta)] as SetupValues | undefined) : undefined;
  const isNonEqual = mode === "nonequal";

  const visibleMeta = useMemo(() => {
    if (!catalog || !weather) return [];
    const filtered = SETUP_META.filter((meta) => {
      const matchesWeather = weather === "rain" ? meta.rain : !meta.rain;
      const matchesGroup = group === "all" || meta.group === group;
      return matchesWeather && matchesGroup && Boolean(catalog[getDbKey(meta)]);
    });
    if (!isNonEqual || !selectedTeam) return filtered;
    return [...filtered].sort((left, right) => {
      const leftSetup = catalog[getDbKey(left)] as SetupValues;
      const rightSetup = catalog[getDbKey(right)] as SetupValues;
      return (getCompatibilityScore(rightSetup, selectedTeam) ?? 0) - (getCompatibilityScore(leftSetup, selectedTeam) ?? 0);
    });
  }, [catalog, group, isNonEqual, selectedTeam, weather]);

  const setupTips = useMemo(() => buildSetupTips(recordedSnaps), [recordedSnaps]);

  return (
    <div style={{ minHeight: "100vh", background: P.bg, color: P.text, fontFamily: P.sans }}>
      <header style={{ padding: "16px 20px", borderBottom: `1px solid ${P.border}`, background: P.surface, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, fontFamily: P.mono, letterSpacing: 2 }}>MINMO DRIVER PACK</div>
          <div style={{ fontSize: 11, color: P.muted }}>{senderConnected ? `Sender online${liveSession?.weather ? ` / ${liveSession.weather}` : ""}` : "Sender offline"}</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {[
            { id: "setup" as const, label: "Setup", visible: canUseSetup },
            { id: "telemetry" as const, label: "Telemetry", visible: canUseTelemetry },
            { id: "settings" as const, label: "Settings", visible: true },
          ]
            .filter((item) => item.visible)
            .map((item) => (
              <button key={item.id} onClick={() => setTab(item.id)} style={{ padding: "8px 12px", borderRadius: 999, border: `1px solid ${tab === item.id ? P.accent : P.border}`, background: tab === item.id ? P.accent : "transparent", color: tab === item.id ? P.bg : P.muted, cursor: "pointer", fontFamily: P.mono, fontSize: 10 }}>
                {item.label}
              </button>
            ))}
        </div>
      </header>

      <main style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
        {tab === "setup" ? (
          <>
            <Panel title="TRACK">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 6 }}>
                {TRACKS.map((item) => (
                  <button key={item.name} onClick={() => { setTrack(item.name); setMode(null); setTeam(null); setWeather(null); setSelectedMeta(null); setExpanded({}); setGroup("all"); }} style={{ padding: "10px 12px", borderRadius: 4, border: `1px solid ${track === item.name ? P.accent : P.border}`, background: track === item.name ? "rgba(0,229,255,0.08)" : P.surface2, color: track === item.name ? P.accent : P.text, textAlign: "left", cursor: "pointer" }}>
                    <div style={{ fontSize: 11, fontWeight: 700 }}>{item.name}{item.sprint ? " S" : ""}</div>
                    <div style={{ fontSize: 9, color: P.muted }}>R{item.round}{detectedTrack === item.name ? " / LIVE" : ""}</div>
                  </button>
                ))}
              </div>
            </Panel>

            {track ? (
              <Panel title="MODE">
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {[["equal", "Equal performance"], ["nonequal", "Non-equal performance"]].map(([value, label]) => (
                    <button key={value} onClick={() => { setMode(value as Mode); setTeam(null); setWeather(null); setSelectedMeta(null); setExpanded({}); }} style={{ padding: "14px 12px", borderRadius: 4, border: `1px solid ${mode === value ? P.accent : P.border}`, background: mode === value ? "rgba(0,229,255,0.08)" : P.surface2, color: mode === value ? P.accent : P.text, textAlign: "left", cursor: "pointer" }}>
                      <div style={{ fontSize: 12, fontWeight: 700 }}>{label}</div>
                    </button>
                  ))}
                </div>
              </Panel>
            ) : null}

            {mode === "nonequal" ? (
              <Panel title="TEAM">
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                  {SORTED_TEAMS.map((item) => (
                    <button key={item.name} onClick={() => { setTeam(item.name); setWeather(null); setSelectedMeta(null); setExpanded({}); }} style={{ padding: "10px 12px", borderRadius: 4, border: `1px solid ${team === item.name ? P.accent : P.border}`, background: team === item.name ? "rgba(0,229,255,0.08)" : P.surface2, color: team === item.name ? P.accent : P.text, textAlign: "left", cursor: "pointer" }}>
                      <div style={{ fontSize: 11, fontWeight: 700 }}>{item.name}</div>
                      <div style={{ fontSize: 9, color: P.muted }}>Score {item.total}</div>
                    </button>
                  ))}
                </div>
              </Panel>
            ) : null}

            {mode ? (
              <Panel title="WEATHER">
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {[["dry", "Dry"], ["rain", "Wet"]].map(([value, label]) => (
                    <button key={value} onClick={() => { setWeather(value as WeatherMode); setSelectedMeta(null); setExpanded({}); setGroup("all"); }} style={{ padding: "14px 12px", borderRadius: 4, border: `1px solid ${weather === value ? P.accent : P.border}`, background: weather === value ? "rgba(0,229,255,0.08)" : P.surface2, color: weather === value ? P.accent : P.text, cursor: "pointer" }}>
                      {label}
                    </button>
                  ))}
                </div>
              </Panel>
            ) : null}

            {weather && catalog ? (
              <Panel title="SETUPS">
                <div style={{ fontSize: 11, color: P.muted, marginBottom: 10, lineHeight: 1.6 }}>{catalog.track.notes}</div>
                {weather === "dry" ? (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                    {["all", "Istvan Puki", "Brendon Leigh"].map((item) => (
                      <button key={item} onClick={() => setGroup(item)} style={{ padding: "5px 10px", borderRadius: 999, border: `1px solid ${group === item ? P.accent : P.border}`, background: group === item ? P.accent : "transparent", color: group === item ? P.bg : P.muted, cursor: "pointer", fontFamily: P.mono, fontSize: 10 }}>
                        {item === "all" ? "ALL" : item === "Istvan Puki" ? "PUKI" : "BL"}
                      </button>
                    ))}
                  </div>
                ) : null}
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {visibleMeta.map((meta) => {
                    const setup = catalog[getDbKey(meta)] as SetupValues;
                    const isExpanded = Boolean(expanded[meta.key]);
                    const isSelected = selectedMeta?.key === meta.key;
                    const compatibility = isNonEqual ? getCompatibilityScore(setup, selectedTeam) : null;
                    const compatibilityLabel = typeof compatibility === "number" ? getCompatibilityLabel(compatibility) : null;

                    return (
                      <div key={meta.key} style={{ borderRadius: 4, border: `1px solid ${isSelected ? meta.color : P.border}`, overflow: "hidden" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: P.surface2 }}>
                          <div style={{ width: 8, height: 8, borderRadius: "50%", background: meta.color, flexShrink: 0 }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: isSelected ? meta.color : P.text }}>{meta.label}</div>
                            <div style={{ fontSize: 10, color: P.muted }}>{getSetupFeel(setup)}</div>
                          </div>
                          <button onClick={() => setSelectedMeta(meta)} style={{ padding: "6px 10px", borderRadius: 4, border: "none", background: meta.color, color: P.bg, fontFamily: P.mono, fontSize: 10, cursor: "pointer" }}>SELECT</button>
                          <button onClick={() => setExpanded((current) => ({ ...current, [meta.key]: !current[meta.key] }))} style={{ padding: "6px 10px", borderRadius: 4, border: `1px solid ${P.border}`, background: "transparent", color: P.muted, fontFamily: P.mono, fontSize: 10, cursor: "pointer" }}>{isExpanded ? "HIDE" : "OPEN"}</button>
                        </div>
                        {compatibilityLabel && typeof compatibility === "number" ? (
                          <div style={{ padding: "6px 12px", background: `${compatibilityLabel.color}12`, color: compatibilityLabel.color, fontSize: 10, fontFamily: P.mono }}>
                            {compatibilityLabel.icon} {selectedTeam?.name} {compatibilityLabel.label} / {compatibility}
                          </div>
                        ) : null}
                        {isExpanded ? (
                          <div style={{ padding: 12, borderTop: `1px solid ${P.border}`, background: P.surface }}>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                              {getSetupTags(setup).map((tag) => (
                                <span key={tag.label} style={{ padding: "3px 7px", borderRadius: 999, background: `${tag.color}18`, color: tag.color, fontSize: 9, fontFamily: P.mono }}>{tag.label}</span>
                              ))}
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 14px" }}>
                              {SETUP_FIELDS.map((field) => (
                                <div key={field.k}>
                                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                                    <span style={{ fontSize: 9, color: P.muted }}>{field.l}</span>
                                    <span style={{ fontSize: 10, fontFamily: P.mono, fontWeight: 700 }}>{setup[field.k]}</span>
                                  </div>
                                  <MetricBar value={setup[field.k]} min={SETUP_FIELD_DEFS[field.k].min} max={SETUP_FIELD_DEFS[field.k].max} />
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </Panel>
            ) : null}

            {selectedSetup && selectedMeta && catalog ? (
              <Panel title="REVIEW">
                <div style={{ padding: 12, borderRadius: 4, border: `1px solid ${selectedMeta.color}`, marginBottom: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: selectedMeta.color }}>{selectedMeta.label}</div>
                  <div style={{ fontSize: 10, color: P.muted, marginTop: 4 }}>{track} / {isNonEqual ? "NON-EQUAL" : "EQUAL"} / {weather === "rain" ? "WET" : "DRY"}{selectedTeam ? ` / ${selectedTeam.name}` : ""}</div>
                  {selectedSetup.note ? <div style={{ fontSize: 11, color: P.text, marginTop: 8 }}>{selectedSetup.note}</div> : null}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {[{ label: "Strategy", value: catalog.track.strategy }, { label: "Pit Window", value: catalog.track.pitWindow50 }, { label: "Quali Fuel", value: catalog.track.qualiFuel ?? "N/A" }, { label: "ERS Trigger", value: catalog.track.ersEnable ?? "N/A" }].map((item) => (
                    <div key={item.label} style={{ padding: 10, borderRadius: 4, background: P.surface2 }}>
                      <div style={{ fontSize: 10, color: P.muted, marginBottom: 4 }}>{item.label}</div>
                      <div style={{ fontSize: 12, fontWeight: 700 }}>{item.value}</div>
                    </div>
                  ))}
                </div>
              </Panel>
            ) : null}
          </>
        ) : null}

        {tab === "telemetry" ? (
          <>
            <Panel title="RECORDING">
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
                {!recording ? (
                  <button onClick={() => { setRecordedSnaps([]); setRecording(true); }} disabled={!senderConnected || !livePlayer} style={{ padding: "10px 16px", borderRadius: 4, border: "none", background: senderConnected && livePlayer ? P.danger : P.dim, color: "#fff", cursor: senderConnected && livePlayer ? "pointer" : "not-allowed", fontFamily: P.mono, fontSize: 11 }}>START RECORD</button>
                ) : (
                  <button onClick={() => setRecording(false)} style={{ padding: "10px 16px", borderRadius: 4, border: `1px solid ${P.border}`, background: P.surface2, color: P.text, cursor: "pointer", fontFamily: P.mono, fontSize: 11 }}>STOP RECORD</button>
                )}
                <span style={{ fontSize: 11, color: P.muted }}>Samples {recordedSnaps.length}</span>
              </div>
              <div style={{ fontSize: 11, color: P.muted }}>{!senderConnected ? "Connect the sender to unlock live telemetry." : livePlayer ? "Recording captures the current player feed every poll cycle." : "Sender connected, waiting for a live player."}</div>
            </Panel>

            {livePlayer ? (
              <Panel title="LIVE">
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, marginBottom: 12 }}>
                  {[{ label: "Top Speed", value: typeof livePlayer.topSpeed === "number" ? `${livePlayer.topSpeed} km/h` : "--" }, { label: "Compound", value: livePlayer.tireCompound?.toUpperCase() ?? "--" }, { label: "Fuel", value: typeof livePlayer.fuelRemainingLaps === "number" ? `${livePlayer.fuelRemainingLaps.toFixed(1)} laps` : "--" }, { label: "Tyre Age", value: typeof livePlayer.tireAge === "number" ? `${livePlayer.tireAge} laps` : "--" }, { label: "Best Lap", value: formatLapTime(livePlayer.bestLapTime) }, { label: "Last Lap", value: formatLapTime(livePlayer.lastLapTime) }].map((item) => (
                    <div key={item.label} style={{ background: P.surface2, borderRadius: 4, padding: "8px 10px" }}>
                      <div style={{ fontSize: 9, fontFamily: P.mono, color: P.muted, marginBottom: 4 }}>{item.label}</div>
                      <div style={{ fontSize: 12, fontWeight: 700 }}>{item.value}</div>
                    </div>
                  ))}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 14px" }}>
                  {[["FL", livePlayer.tireWear?.[0] ?? 0], ["FR", livePlayer.tireWear?.[1] ?? 0], ["RL", livePlayer.tireWear?.[2] ?? 0], ["RR", livePlayer.tireWear?.[3] ?? 0]].map(([label, value]) => (
                    <div key={label}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                        <span style={{ fontSize: 9, color: P.muted }}>{label}</span>
                        <span style={{ fontSize: 10, fontFamily: P.mono, fontWeight: 700 }}>{Number(value).toFixed(1)}%</span>
                      </div>
                      <MetricBar value={Number(value)} min={0} max={100} />
                    </div>
                  ))}
                </div>
              </Panel>
            ) : null}

            {recordedSnaps.length >= 2 ? (
              <Panel title="SETUP FEEDBACK">
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {setupTips.map((tip) => (
                    <div key={`${tip.issue}-${tip.reason}`} style={{ borderRadius: 4, border: `1px solid ${severityColor(tip.severity)}33`, background: `${severityColor(tip.severity)}12`, padding: "10px 12px" }}>
                      <div style={{ fontSize: 11, fontFamily: P.mono, fontWeight: 700, color: severityColor(tip.severity), marginBottom: 4 }}>{tip.issue}</div>
                      <div style={{ fontSize: 11, color: P.muted, lineHeight: 1.6 }}>{tip.reason}</div>
                      {tip.changes.length ? (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                          {tip.changes.map((change) => (
                            <span key={`${tip.issue}-${change}`} style={{ padding: "3px 7px", borderRadius: 999, background: "rgba(255,255,255,0.06)", color: P.text, fontSize: 10, fontFamily: P.mono }}>
                              {change}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </Panel>
            ) : null}
          </>
        ) : null}

        {tab === "settings" ? (
          <>
            <Panel title="SENDER URL">
              <div style={{ display: "grid", gap: 8 }}>
                <input value={draftSenderUrl} onChange={(event) => setDraftSenderUrl(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void saveSenderUrl(); }} style={{ width: "100%", padding: "10px 12px", borderRadius: 4, border: `1px solid ${P.border}`, background: P.surface2, color: P.text, fontFamily: P.mono, outline: "none" }} />
                <button onClick={() => void saveSenderUrl()} style={{ width: 120, padding: "10px 12px", borderRadius: 4, border: "none", background: P.accent, color: P.bg, fontFamily: P.mono, cursor: "pointer" }}>SAVE</button>
              </div>
            </Panel>

            <Panel title="STATUS">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {[{ label: "Sender", value: senderConnected ? "Online" : "Offline" }, { label: "Track", value: detectedTrack ?? liveSession?.trackName ?? "N/A" }, { label: "Session", value: liveSession?.sessionType ?? "N/A" }, { label: "Weather", value: liveSession?.weather ?? "N/A" }, { label: "Best Lap", value: formatLapTime(livePlayer?.bestLapTime) }, { label: "Track Temp", value: typeof liveSession?.trackTemp === "number" ? `${liveSession.trackTemp.toFixed(0)}C` : "N/A" }].map((item) => (
                  <div key={item.label} style={{ padding: 10, borderRadius: 4, background: P.surface2 }}>
                    <div style={{ fontSize: 10, color: P.muted, marginBottom: 4 }}>{item.label}</div>
                    <div style={{ fontSize: 12, fontWeight: 700 }}>{item.value}</div>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title="PERMISSIONS">
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {[{ label: "Pitwall", enabled: permissionsKnown ? Boolean(senderStatus?.driverPermissions?.pitwall) : true }, { label: "Overlay", enabled: permissionsKnown ? Boolean(senderStatus?.driverPermissions?.overlay) : true }, { label: "Setup", enabled: permissionsKnown ? Boolean(senderStatus?.driverPermissions?.setupSupport) : true }].map((item) => (
                  <span key={item.label} style={{ padding: "4px 10px", borderRadius: 999, background: item.enabled ? "rgba(205,255,19,0.12)" : "rgba(255,82,92,0.12)", color: item.enabled ? P.accent2 : P.danger, fontSize: 10, fontFamily: P.mono }}>
                    {item.label}
                  </span>
                ))}
              </div>
            </Panel>
          </>
        ) : null}
      </main>
    </div>
  );
}
