import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

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
import {
  buildAutoSetupContext,
  findSavedRecommendation,
  formatSavedAtLocal,
  normalizeLapComparisonState,
  normalizeSavedRecommendations,
  normalizeWeatherMode,
  removeSavedRecommendation,
  resolveTeamName,
  resolveTrackName,
  upsertSavedRecommendation,
  type LapComparisonSnapshot,
  type LapComparisonState,
  type Mode,
  type SavedRecommendation,
  type SenderRaceResult,
  type WeatherMode,
} from "./setupDriverPack";
import { SessionAnalysisSection } from "./SessionAnalysisSection";
import {
  normalizeAnalysisServerUrl,
} from "./sessionAnalysis";

type SectionId = "setup-manager" | "sender" | "overlay";
type SetupWorkspaceId = "builder" | "analysis";
type Severity = "high" | "med" | "low";

interface DriverPermissions {
  pitwall?: boolean;
  overlay?: boolean;
  setupSupport?: boolean;
  [key: string]: boolean | undefined;
}

interface SenderInvite {
  dashboardUrl?: string;
  signalingUrl?: string;
  roomId?: string;
  roomCode?: string;
  link?: string;
  passwordRequired?: boolean;
}

interface SenderPeer {
  peerId?: string;
  state?: string;
  view?: string;
  permissions?: DriverPermissions;
}

interface SenderCurrentTrack {
  name?: string;
  filename?: string;
  hasRecordedPreview?: boolean;
}

interface SenderStatus {
  currentTrack?: SenderCurrentTrack;
  driverPermissions?: DriverPermissions;
  radarActive?: boolean;
  weatherActive?: boolean;
  strategyActive?: boolean;
  roomCode?: string;
  roomId?: string;
  roomName?: string;
  roomProtected?: boolean;
  connectedEngineers?: number;
  udpPort?: number;
  saveFiles?: boolean;
  invite?: SenderInvite;
  peers?: SenderPeer[];
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
  name?: string;
  teamId?: number;
  position?: number;
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

interface OverlayState {
  radar: boolean;
  weather: boolean;
  strategy: boolean;
}

interface OverlayPreset extends OverlayState {
  id: string;
  name: string;
  savedAtLocal?: string;
}

interface OverlayHotkeys {
  radar: string;
  weather: string;
  strategy: string;
}

interface SenderForwardTargetResponse {
  host?: string;
  port?: number;
  enabled?: boolean;
}

interface SenderForwardTargetDraft {
  host: string;
  port: string;
  enabled: boolean;
}

interface SenderConfigResponse {
  udpPort?: number;
  saveFiles?: boolean;
  trackRecording?: boolean;
  roomName?: string;
  roomPassword?: string;
  frcAccountKey?: string;
  engineerDashboardUrl?: string;
  forwardTargets?: SenderForwardTargetResponse[];
  overlayPresets?: OverlayPreset[];
  overlayHotkeys?: OverlayHotkeys;
}

interface SenderConfigConflictResponse {
  error?: string;
  requiresOverwriteConfirm?: boolean;
  currentTrack?: SenderCurrentTrack;
}

interface SenderConfigDraft {
  udpPort: string;
  saveFiles: boolean;
  trackRecording: boolean;
  roomName: string;
  roomPassword: string;
  frcAccountKey: string;
  forwardTargets: SenderForwardTargetDraft[];
}

interface LocalOpsResponse {
  engineerDashboardUrl?: string;
  overlayPresets?: OverlayPreset[];
  overlayHotkeys?: OverlayHotkeys;
}

interface SenderStorageInfo {
  selected: string | null;
  effective: string;
  usingCustom: boolean;
}

const DEFAULT_SENDER_URL = "http://localhost:8099";
const DEFAULT_ENGINEER_DASHBOARD_URL = "https://pitwall.up.railway.app";
const SENDER_URL_KEY = "frc_sender_url";
const SENDER_STORAGE_ROOT_KEY = "frc_sender_storage_root";
const SAVED_RECOMMENDATIONS_KEY = "frc_setup_recommendations";
const LAP_COMPARISON_KEY = "frc_setup_lap_comparison";
const EMPTY_SENDER_STORAGE_INFO: SenderStorageInfo = {
  selected: null,
  effective: "",
  usingCustom: false,
};
const DEFAULT_OVERLAY_STATE: OverlayState = { radar: false, weather: false, strategy: false };
const DEFAULT_OVERLAY_HOTKEYS: OverlayHotkeys = {
  radar: "Alt+Shift+1",
  weather: "Alt+Shift+2",
  strategy: "Alt+Shift+3",
};
const DEFAULT_SENDER_CONFIG: SenderConfigDraft = {
  udpPort: "20777",
  saveFiles: true,
  trackRecording: false,
  roomName: "Sender Room",
  roomPassword: "",
  frcAccountKey: "",
  forwardTargets: [],
};
const DRIVER_PERMISSION_LABELS: Record<string, string> = {
  pitwall: "Pitwall",
  overlay: "Overlay",
  setupSupport: "Setup",
  viewERSEstimate: "ERS Est",
  viewERSActual: "ERS",
  viewAdvancedStrategy: "Adv Strat",
  viewPitStatus: "Pit Status",
  viewTopSpeed: "Top Speed",
  viewPlayerDelta: "Player Delta",
  viewQualifying: "Qualifying",
};
const SECTION_COPY: Record<SectionId, { title: string; detail: string }> = {
  "setup-manager": {
    title: "Setup Manager",
    detail: "Track, weather, team, saved recommendation, and session analysis in one workspace.",
  },
  sender: {
    title: "Sender",
    detail: "Backend connection, room sharing, live telemetry, and lap comparison controls.",
  },
  overlay: {
    title: "Overlay",
    detail: "Radar, weather, and strategy overlay state, presets, and hotkey management.",
  },
};

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

const WINDOW_TITLEBAR_INSET = window.electronAPI?.platform === "win32" ? 32 : 0;

function normalizeSenderUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  return trimmed || DEFAULT_SENDER_URL;
}

function normalizeSenderForwardTargetsResponse(targets: SenderForwardTargetResponse[] | null | undefined): SenderForwardTargetDraft[] {
  if (!Array.isArray(targets)) {
    return [];
  }
  return targets.map((target) => ({
    host: typeof target.host === "string" ? target.host : "",
    port: typeof target.port === "number" && Number.isFinite(target.port) ? String(target.port) : "",
    enabled: target.enabled !== false,
  }));
}

function buildSenderConfigDraft(data: SenderConfigResponse | null | undefined): SenderConfigDraft {
  return {
    udpPort:
      typeof data?.udpPort === "number" && Number.isFinite(data.udpPort)
        ? String(data.udpPort)
        : DEFAULT_SENDER_CONFIG.udpPort,
    saveFiles: typeof data?.saveFiles === "boolean" ? data.saveFiles : DEFAULT_SENDER_CONFIG.saveFiles,
    trackRecording: typeof data?.trackRecording === "boolean" ? data.trackRecording : DEFAULT_SENDER_CONFIG.trackRecording,
    roomName: typeof data?.roomName === "string" ? data.roomName : DEFAULT_SENDER_CONFIG.roomName,
    roomPassword: typeof data?.roomPassword === "string" ? data.roomPassword : DEFAULT_SENDER_CONFIG.roomPassword,
    frcAccountKey: typeof data?.frcAccountKey === "string" ? data.frcAccountKey : DEFAULT_SENDER_CONFIG.frcAccountKey,
    forwardTargets: normalizeSenderForwardTargetsResponse(data?.forwardTargets),
  };
}

function severityColor(severity: Severity): string {
  if (severity === "high") return P.danger;
  if (severity === "med") return P.accent;
  return P.dim;
}

function formatLapTime(value?: number | null): string {
  return typeof value === "number" && value > 0 ? `${(value / 1000).toFixed(3)}s` : "--";
}

function formatTrackTemp(value?: number | null): string {
  return typeof value === "number" ? `${value.toFixed(0)}C` : "--";
}

function formatContextLabel(snapshot: {
  track: string | null;
  weather: WeatherMode;
  team: string | null;
  sessionType?: string | null;
}): string {
  const parts = [
    snapshot.track ?? "Unknown Track",
    snapshot.sessionType ?? "Session",
    snapshot.weather === "rain" ? "Wet" : snapshot.weather === "dry" ? "Dry" : "Weather TBD",
  ];
  if (snapshot.team) {
    parts.push(snapshot.team);
  }
  return parts.join(" / ");
}

function formatModeLabel(mode: Mode): string {
  if (mode === "nonequal") return "NON-EQUAL";
  if (mode === "equal") return "EQUAL";
  return "UNSET";
}

function formatBooleanState(value: boolean): string {
  return value ? "On" : "Off";
}

function normalizeOverlayHotkeysInput(source?: Partial<OverlayHotkeys> | null): OverlayHotkeys {
  return {
    radar: source?.radar?.trim() || DEFAULT_OVERLAY_HOTKEYS.radar,
    weather: source?.weather?.trim() || DEFAULT_OVERLAY_HOTKEYS.weather,
    strategy: source?.strategy?.trim() || DEFAULT_OVERLAY_HOTKEYS.strategy,
  };
}

function normalizeOverlayPresetsInput(source?: OverlayPreset[] | null): OverlayPreset[] {
  if (!Array.isArray(source) || source.length === 0) {
    return [];
  }

  const seen = new Set<string>();
  const next: OverlayPreset[] = [];
  for (const preset of source) {
    const id = preset?.id?.trim();
    const name = preset?.name?.trim();
    if (!id || !name) {
      continue;
    }
    const key = `${id.toLowerCase()}|${name.toLowerCase()}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    next.push({
      id,
      name,
      savedAtLocal: preset.savedAtLocal || formatSavedAtLocal(),
      radar: Boolean(preset.radar),
      weather: Boolean(preset.weather),
      strategy: Boolean(preset.strategy),
    });
  }
  return next.slice(0, 12);
}

function normalizeSenderStorageInfo(source?: Partial<SenderStorageInfo> | null): SenderStorageInfo {
  const selected = typeof source?.selected === "string" && source.selected.trim() ? source.selected.trim() : null;
  const effective = typeof source?.effective === "string" && source.effective.trim() ? source.effective.trim() : selected ?? "";
  return {
    selected,
    effective,
    usingCustom: Boolean(selected),
  };
}

function slugifyPresetName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function grantedPermissionLabels(permissions?: DriverPermissions): string[] {
  if (!permissions) {
    return [];
  }
  return Object.entries(permissions)
    .filter(([, enabled]) => Boolean(enabled))
    .map(([key]) => DRIVER_PERMISSION_LABELS[key] || key);
}

async function readStoredValue<T>(key: string, fallback: T): Promise<T> {
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

async function writeStoredValue(key: string, value: unknown): Promise<void> {
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
      <div style={{ padding: "14px 16px", minWidth: 0, overflowX: "auto", overflowY: "visible" }}>{children}</div>
    </section>
  );
}

function StatTile({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ padding: "10px 12px", borderRadius: 4, background: P.surface2 }}>
      <div style={{ fontSize: 9, color: P.muted, marginBottom: 4, fontFamily: P.mono }}>{label}</div>
      <div style={{ fontSize: 12, fontWeight: 700, color: accent ?? P.text }}>{value}</div>
    </div>
  );
}

function ComparisonSnapshotCard({
  title,
  snapshot,
}: {
  title: string;
  snapshot: LapComparisonSnapshot | null;
}) {
  return (
    <div style={{ borderRadius: 4, border: `1px solid ${P.border}`, background: P.surface2, padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 700, fontFamily: P.mono }}>{title}</div>
        <div style={{ fontSize: 9, color: P.muted }}>{snapshot?.capturedAtLocal ?? "Not captured"}</div>
      </div>
      {snapshot ? (
        <>
          <div style={{ fontSize: 10, color: P.muted, lineHeight: 1.6, marginBottom: 10 }}>
            {formatContextLabel(snapshot)}
            {snapshot.setupLabel ? ` / ${snapshot.setupLabel}` : ""}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
            <StatTile label="Best Lap" value={formatLapTime(snapshot.bestLapTime)} />
            <StatTile label="Last Lap" value={formatLapTime(snapshot.lastLapTime)} />
            <StatTile label="Top Speed" value={typeof snapshot.topSpeed === "number" ? `${snapshot.topSpeed} km/h` : "--"} />
          </div>
        </>
      ) : (
        <div style={{ fontSize: 11, color: P.muted }}>Capture a run snapshot to compare setup changes.</div>
      )}
    </div>
  );
}

function WorkspaceNavCard({
  title,
  detail,
  accent,
  active,
  badges,
  onClick,
}: {
  title: string;
  detail: string;
  accent: string;
  active: boolean;
  badges: string[];
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        width: "100%",
        display: "grid",
        gap: 10,
        padding: "14px 14px 12px",
        borderRadius: 8,
        border: `1px solid ${active ? accent : P.border}`,
        background: active ? `${accent}12` : P.surface,
        color: P.text,
        cursor: "pointer",
        textAlign: "left",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, fontFamily: P.mono, letterSpacing: 1.2, color: active ? accent : P.muted }}>{title}</div>
          <div style={{ fontSize: 11, color: P.muted, lineHeight: 1.6, marginTop: 6 }}>{detail}</div>
        </div>
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: accent, flexShrink: 0, marginTop: 4 }} />
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {badges.map((badge) => (
          <span
            key={`${title}-${badge}`}
            style={{
              padding: "3px 8px",
              borderRadius: 999,
              background: active ? `${accent}18` : "rgba(255,255,255,0.05)",
              color: active ? accent : P.muted,
              fontSize: 9,
              fontFamily: P.mono,
            }}
          >
            {badge}
          </span>
        ))}
      </div>
    </button>
  );
}

function WorkspaceModuleCard({
  title,
  detail,
  status,
  accent,
  active = false,
  onClick,
}: {
  title: string;
  detail: string;
  status: string;
  accent: string;
  active?: boolean;
  onClick?: () => void;
}) {
  const content = (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, fontFamily: P.mono, color: active ? accent : P.text }}>{title}</div>
          <div style={{ fontSize: 10, color: P.muted, lineHeight: 1.6, marginTop: 6 }}>{detail}</div>
        </div>
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: accent, flexShrink: 0, marginTop: 4 }} />
      </div>
      <div style={{ fontSize: 10, color: active ? accent : P.text, fontWeight: 700 }}>{status}</div>
    </>
  );

  if (onClick) {
    return (
      <button
        onClick={onClick}
        style={{
          width: "100%",
          display: "grid",
          gap: 10,
          padding: "12px 14px",
          borderRadius: 6,
          border: `1px solid ${active ? accent : P.border}`,
          background: active ? `${accent}14` : P.surface2,
          color: P.text,
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        {content}
      </button>
    );
  }

  return (
    <div
      style={{
        display: "grid",
        gap: 10,
        padding: "12px 14px",
        borderRadius: 6,
        border: `1px solid ${P.border}`,
        background: P.surface2,
      }}
    >
      {content}
    </div>
  );
}

function useSenderConnection(senderUrl: string) {
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<SenderStatus | null>(null);
  const [session, setSession] = useState<SenderSession | null>(null);
  const [player, setPlayer] = useState<SenderPlayer | null>(null);
  const [latestRaceResult, setLatestRaceResult] = useState<SenderRaceResult | null>(null);

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

      try {
        const resultRes = await fetch(`${normalized}/api/races/latest`);
        if (resultRes.status === 404) {
          if (!active) return;
          setLatestRaceResult(null);
          return;
        }
        const nextResult = (await resultRes.json()) as SenderRaceResult;
        if (!active) return;
        setLatestRaceResult(nextResult);
      } catch {
        if (!active) return;
        setLatestRaceResult(null);
      }
    };

    void poll();
    const interval = window.setInterval(() => void poll(), 3000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [senderUrl]);

  const rawTrack = status?.currentTrack?.name ?? session?.trackName ?? null;
  const detectedTrack = resolveTrackName(rawTrack, SENDER_TRACK_MAP, TRACKS);

  return { connected, status, session, player, detectedTrack, latestRaceResult };
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

function buildLiveComparisonSnapshot(
  slot: "before" | "after",
  args: {
    player: SenderPlayer;
    session: SenderSession | null;
    track: string | null;
    weather: WeatherMode;
    team: string | null;
    selectedMeta: SetupMeta | null;
  },
): LapComparisonSnapshot {
  const { player, session, track, weather, team, selectedMeta } = args;
  return {
    slot,
    source: "live",
    capturedAtLocal: formatSavedAtLocal(),
    track,
    weather,
    team,
    setupKey: selectedMeta?.key ?? null,
    setupLabel: selectedMeta?.label ?? null,
    sessionType: session?.sessionType ?? null,
    trackTemp: typeof session?.trackTemp === "number" ? session.trackTemp : null,
    bestLapTime: typeof player.bestLapTime === "number" ? player.bestLapTime : null,
    lastLapTime: typeof player.lastLapTime === "number" ? player.lastLapTime : null,
    topSpeed: typeof player.topSpeed === "number" ? player.topSpeed : null,
  };
}

function buildRaceResultComparisonSnapshot(
  result: SenderRaceResult,
  args: {
    track: string | null;
    weather: WeatherMode;
    team: string | null;
    selectedMeta: SetupMeta | null;
  },
): LapComparisonSnapshot {
  return {
    slot: "before",
    source: "race-result",
    capturedAtLocal: result.savedAtLocal ?? formatSavedAtLocal(),
    track: args.track,
    weather: args.weather,
    team: args.team,
    setupKey: args.selectedMeta?.key ?? null,
    setupLabel: args.selectedMeta?.label ?? null,
    sessionType: result.session?.sessionType ?? null,
    trackTemp: typeof result.session?.trackTemp === "number" ? result.session.trackTemp : null,
    bestLapTime: typeof result.player?.bestLapMs === "number" ? result.player.bestLapMs : null,
    lastLapTime: typeof result.player?.lastLapMs === "number" ? result.player.lastLapMs : null,
    topSpeed: null,
  };
}

function getComparisonDelta(
  before: number | null,
  after: number | null,
  betterDirection: "lower" | "higher",
): { text: string; color: string } {
  if (typeof before !== "number" || typeof after !== "number") {
    return { text: "--", color: P.muted };
  }

  const rawDelta = after - before;
  if (betterDirection === "lower") {
    const improved = rawDelta < 0;
    return {
      text: `${rawDelta > 0 ? "+" : ""}${(rawDelta / 1000).toFixed(3)}s`,
      color: improved ? P.accent2 : rawDelta === 0 ? P.muted : P.danger,
    };
  }

  const improved = rawDelta > 0;
  return {
    text: `${rawDelta > 0 ? "+" : ""}${rawDelta.toFixed(0)} km/h`,
    color: improved ? P.accent2 : rawDelta === 0 ? P.muted : P.danger,
  };
}

export function F1SetupManager() {
  const [section, setSection] = useState<SectionId>("setup-manager");
  const [setupWorkspace, setSetupWorkspace] = useState<SetupWorkspaceId>("builder");
  const [senderUrl, setSenderUrl] = useState(DEFAULT_SENDER_URL);
  const [draftSenderUrl, setDraftSenderUrl] = useState(DEFAULT_SENDER_URL);
  const [engineerDashboardUrl, setEngineerDashboardUrl] = useState(DEFAULT_ENGINEER_DASHBOARD_URL);
  const [draftEngineerDashboardUrl, setDraftEngineerDashboardUrl] = useState(DEFAULT_ENGINEER_DASHBOARD_URL);
  const [senderConfig, setSenderConfig] = useState<SenderConfigDraft>(DEFAULT_SENDER_CONFIG);
  const [senderStorageInfo, setSenderStorageInfo] = useState<SenderStorageInfo>(EMPTY_SENDER_STORAGE_INFO);
  const [loadingSenderConfig, setLoadingSenderConfig] = useState(false);
  const [savingSenderConfig, setSavingSenderConfig] = useState(false);
  const [changingSenderStorage, setChangingSenderStorage] = useState(false);
  const [senderConfigNotice, setSenderConfigNotice] = useState<string | null>(null);
  const [senderConfigError, setSenderConfigError] = useState<string | null>(null);
  const [trackRecordingOverwriteFilename, setTrackRecordingOverwriteFilename] = useState("");
  const [overlayState, setOverlayState] = useState<OverlayState>(DEFAULT_OVERLAY_STATE);
  const [overlayPresets, setOverlayPresets] = useState<OverlayPreset[]>([]);
  const [overlayHotkeys, setOverlayHotkeys] = useState<OverlayHotkeys>(DEFAULT_OVERLAY_HOTKEYS);
  const [draftOverlayHotkeys, setDraftOverlayHotkeys] = useState<OverlayHotkeys>(DEFAULT_OVERLAY_HOTKEYS);
  const [overlayPresetName, setOverlayPresetName] = useState("");
  const [overlayNotice, setOverlayNotice] = useState<string | null>(null);
  const [overlayError, setOverlayError] = useState<string | null>(null);
  const [savingOverlayConfig, setSavingOverlayConfig] = useState(false);
  const [applyingOverlay, setApplyingOverlay] = useState(false);

  const [track, setTrack] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(null);
  const [team, setTeam] = useState<string | null>(null);
  const [weather, setWeather] = useState<WeatherMode>(null);
  const [selectedMeta, setSelectedMeta] = useState<SetupMeta | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [group, setGroup] = useState("all");
  const [autoContextEnabled, setAutoContextEnabled] = useState(true);

  const [recording, setRecording] = useState(false);
  const [recordedSnaps, setRecordedSnaps] = useState<TelemetrySnapshot[]>([]);
  const [savedRecommendations, setSavedRecommendations] = useState<SavedRecommendation[]>([]);
  const [lapComparison, setLapComparison] = useState<LapComparisonState>({ before: null, after: null });

  useEffect(() => {
    let active = true;

    const loadPersistedState = async () => {
      const storedSenderUrl = await readStoredValue<string>(SENDER_URL_KEY, DEFAULT_SENDER_URL);
      const nextSenderUrl = normalizeSenderUrl(typeof storedSenderUrl === "string" ? storedSenderUrl : DEFAULT_SENDER_URL);
      const storedRecommendations = await readStoredValue<unknown>(SAVED_RECOMMENDATIONS_KEY, []);
      const storedComparison = await readStoredValue<unknown>(LAP_COMPARISON_KEY, null);
      const nextStorageInfo = window.electronAPI?.getSenderStorageInfo
        ? normalizeSenderStorageInfo(await window.electronAPI.getSenderStorageInfo())
        : EMPTY_SENDER_STORAGE_INFO;

      if (!active) return;
      setSenderUrl(nextSenderUrl);
      setDraftSenderUrl(nextSenderUrl);
      setEngineerDashboardUrl(DEFAULT_ENGINEER_DASHBOARD_URL);
      setDraftEngineerDashboardUrl(DEFAULT_ENGINEER_DASHBOARD_URL);
      setSavedRecommendations(normalizeSavedRecommendations(storedRecommendations));
      setLapComparison(normalizeLapComparisonState(storedComparison));
      setSenderStorageInfo(nextStorageInfo);
    };

    void loadPersistedState();
    return () => {
      active = false;
    };
  }, []);

  const saveSenderUrl = async () => {
    const normalized = normalizeSenderUrl(draftSenderUrl);
    setSenderUrl(normalized);
    setDraftSenderUrl(normalized);
    await writeStoredValue(SENDER_URL_KEY, normalized);
  };

  const refreshSenderStorageInfo = async () => {
    if (!window.electronAPI?.getSenderStorageInfo) {
      return;
    }
    const nextInfo = normalizeSenderStorageInfo(await window.electronAPI.getSenderStorageInfo());
    setSenderStorageInfo(nextInfo);
  };

  const applySenderStorageRoot = async (nextRoot: string | null) => {
    if (!window.electronAPI?.setSetting) {
      setSenderConfigError("Storage location control is only available in the desktop app.");
      return;
    }

    const normalized = nextRoot?.trim() || "";
    const currentSelected = senderStorageInfo.selected ?? "";
    if (normalized === currentSelected) {
      setSenderConfigNotice(normalized ? "Storage location is already using the selected folder." : "Sender is already using the default app folder.");
      setSenderConfigError(null);
      return;
    }

    setChangingSenderStorage(true);
    setSenderConfigNotice(null);
    setSenderConfigError(null);
    try {
      await writeStoredValue(SENDER_STORAGE_ROOT_KEY, normalized);
      await refreshSenderStorageInfo();

      if (window.electronAPI?.restartSender) {
        await window.electronAPI.restartSender();
        setSenderConfigNotice(
          normalized
            ? "Storage location saved. Sender restarted and new logs/data will be written to the selected folder."
            : "Storage location reset. Sender restarted and will use the default app folder again.",
        );
      } else {
        setSenderConfigNotice(
          normalized
            ? "Storage location saved. Restart F1 Driver Pack to start writing new logs/data to the selected folder."
            : "Storage location reset. Restart F1 Driver Pack to apply the default app folder again.",
        );
      }
    } catch (error) {
      setSenderConfigError(error instanceof Error ? error.message : "Failed to update sender storage location.");
    } finally {
      setChangingSenderStorage(false);
    }
  };

  const chooseSenderStorageRoot = async () => {
    if (!window.electronAPI?.selectDirectory) {
      setSenderConfigError("Folder selection is only available in the desktop app.");
      return;
    }

    try {
      const selectedPath = await window.electronAPI.selectDirectory((senderStorageInfo.selected ?? senderStorageInfo.effective) || undefined);
      if (!selectedPath) {
        return;
      }
      await applySenderStorageRoot(selectedPath);
    } catch (error) {
      setSenderConfigError(error instanceof Error ? error.message : "Failed to select a storage folder.");
    }
  };

  const resetSenderStorageRoot = async () => {
    await applySenderStorageRoot(null);
  };

  const restartEmbeddedSender = async () => {
    if (!window.electronAPI?.restartSender) {
      setSenderConfigError("Sender restart control is only available in the desktop app.");
      return;
    }

    setChangingSenderStorage(true);
    setSenderConfigNotice(null);
    setSenderConfigError(null);
    try {
      await window.electronAPI.restartSender();
      setSenderConfigNotice("Sender restarted.");
    } catch (error) {
      setSenderConfigError(error instanceof Error ? error.message : "Failed to restart sender.");
    } finally {
      setChangingSenderStorage(false);
    }
  };

  const persistLocalOps = async (
    nextDashboardUrl: string,
    nextHotkeys: OverlayHotkeys,
    nextPresets: OverlayPreset[],
    successMessage: string,
  ): Promise<boolean> => {
    setSavingOverlayConfig(true);
    setOverlayError(null);
    setOverlayNotice(null);
    try {
      const response = await fetch(`${normalizeSenderUrl(senderUrl)}/api/local-ops`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          engineerDashboardUrl: nextDashboardUrl,
          overlayHotkeys: nextHotkeys,
          overlayPresets: nextPresets,
        }),
      });
      const data = (await response.json().catch(() => null)) as LocalOpsResponse | { error?: string } | null;
      if (!response.ok) {
        throw new Error((data as { error?: string } | null)?.error || "Failed to save local ops settings.");
      }

      const savedDashboardUrl = (data as LocalOpsResponse | null)?.engineerDashboardUrl?.trim() || nextDashboardUrl.trim() || DEFAULT_ENGINEER_DASHBOARD_URL;
      const savedHotkeys = normalizeOverlayHotkeysInput((data as LocalOpsResponse | null)?.overlayHotkeys ?? nextHotkeys);
      const savedPresets = normalizeOverlayPresetsInput((data as LocalOpsResponse | null)?.overlayPresets ?? nextPresets);
      setEngineerDashboardUrl(savedDashboardUrl);
      setDraftEngineerDashboardUrl(savedDashboardUrl);
      setOverlayHotkeys(savedHotkeys);
      setDraftOverlayHotkeys(savedHotkeys);
      setOverlayPresets(savedPresets);
      setOverlayNotice(successMessage);
      return true;
    } catch (error) {
      setOverlayError(error instanceof Error ? error.message : "Failed to save local ops settings.");
      return false;
    } finally {
      setSavingOverlayConfig(false);
    }
  };

  const saveEngineerDashboardUrl = async () => {
    await persistLocalOps(
      draftEngineerDashboardUrl.trim() || DEFAULT_ENGINEER_DASHBOARD_URL,
      draftOverlayHotkeys,
      overlayPresets,
      "Sender sharing settings saved.",
    );
  };

  const saveOverlayHotkeySettings = async () => {
    await persistLocalOps(
      draftEngineerDashboardUrl.trim() || engineerDashboardUrl,
      normalizeOverlayHotkeysInput(draftOverlayHotkeys),
      overlayPresets,
      "Overlay hotkeys saved.",
    );
  };

  const updateSenderForwardTarget = (index: number, patch: Partial<SenderForwardTargetDraft>) => {
    setSenderConfig((current) => ({
      ...current,
      forwardTargets: current.forwardTargets.map((target, targetIndex) =>
        targetIndex === index ? { ...target, ...patch } : target,
      ),
    }));
  };

  const addSenderForwardTarget = () => {
    setSenderConfig((current) => ({
      ...current,
      forwardTargets: [...current.forwardTargets, { host: "", port: "", enabled: true }],
    }));
  };

  const removeSenderForwardTarget = (index: number) => {
    setSenderConfig((current) => ({
      ...current,
      forwardTargets: current.forwardTargets.filter((_, targetIndex) => targetIndex !== index),
    }));
  };

  const saveSenderConfig = async () => {
    setSavingSenderConfig(true);
    setSenderConfigNotice(null);
    setSenderConfigError(null);
    try {
      const udpPort = Number.parseInt(senderConfig.udpPort.trim(), 10);
      if (!Number.isInteger(udpPort) || udpPort < 1 || udpPort > 65535) {
        throw new Error("UDP port must be between 1 and 65535.");
      }

      const nextForwardTargets = [];
      for (const target of senderConfig.forwardTargets) {
        const host = target.host.trim();
        const portText = target.port.trim();
        if (!host && !portText) {
          continue;
        }
        const port = Number.parseInt(portText, 10);
        if (!host) {
          throw new Error("Forward target host is required.");
        }
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          throw new Error(`Forward target port for ${host} must be between 1 and 65535.`);
        }
        nextForwardTargets.push({
          host,
          port,
          enabled: target.enabled,
        });
      }

      const response = await fetch(`${normalizeSenderUrl(senderUrl)}/api/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          udpPort,
          saveFiles: senderConfig.saveFiles,
          trackRecording: senderConfig.trackRecording,
          trackRecordingOverwriteApprovedFor: trackRecordingOverwriteFilename,
          roomName: senderConfig.roomName,
          roomPassword: senderConfig.roomPassword,
          frcAccountKey: senderConfig.frcAccountKey,
          engineerDashboardUrl: draftEngineerDashboardUrl.trim() || engineerDashboardUrl,
          forwardTargets: nextForwardTargets,
          overlayPresets,
          overlayHotkeys: draftOverlayHotkeys,
        }),
      });
      const data = (await response.json().catch(() => null)) as
        | SenderConfigResponse
        | SenderConfigConflictResponse
        | null;

      if (!response.ok) {
        const conflict = data as SenderConfigConflictResponse | null;
        if (response.status === 409 && conflict?.requiresOverwriteConfirm) {
          setTrackRecordingOverwriteFilename(conflict.currentTrack?.filename?.trim() ?? "");
          throw new Error(
            conflict.error ||
              `Track data already exists for ${conflict.currentTrack?.name || "the current track"}. Save again to confirm overwrite.`,
          );
        }
        throw new Error((data as SenderConfigConflictResponse | null)?.error || "Failed to save sender settings.");
      }

      const nextConfigData = data as SenderConfigResponse | null;
      setSenderConfig(buildSenderConfigDraft(nextConfigData));
      setTrackRecordingOverwriteFilename("");

      const nextDashboardUrl =
        nextConfigData?.engineerDashboardUrl?.trim() || draftEngineerDashboardUrl.trim() || engineerDashboardUrl;
      setEngineerDashboardUrl(nextDashboardUrl);
      setDraftEngineerDashboardUrl(nextDashboardUrl);

      if (nextConfigData?.overlayHotkeys) {
        const nextHotkeys = normalizeOverlayHotkeysInput(nextConfigData.overlayHotkeys);
        setOverlayHotkeys(nextHotkeys);
        setDraftOverlayHotkeys(nextHotkeys);
      }
      if (nextConfigData?.overlayPresets) {
        setOverlayPresets(normalizeOverlayPresetsInput(nextConfigData.overlayPresets));
      }

      setSenderConfigNotice("Sender settings saved.");
    } catch (error) {
      setSenderConfigError(error instanceof Error ? error.message : "Failed to save sender settings.");
    } finally {
      setSavingSenderConfig(false);
    }
  };

  const persistRecommendations = async (next: SavedRecommendation[]) => {
    setSavedRecommendations(next);
    await writeStoredValue(SAVED_RECOMMENDATIONS_KEY, next);
  };

  const persistComparison = async (next: LapComparisonState) => {
    setLapComparison(next);
    await writeStoredValue(LAP_COMPARISON_KEY, next);
  };

  const { connected: senderConnected, status: senderStatus, session: liveSession, player: livePlayer, detectedTrack, latestRaceResult } = useSenderConnection(senderUrl);
  const permissionsKnown = Boolean(senderStatus?.driverPermissions);
  const canUseSetup = permissionsKnown ? Boolean(senderStatus?.driverPermissions?.setupSupport) : true;
  const canUseOverlay = permissionsKnown ? Boolean(senderStatus?.driverPermissions?.overlay) : true;

  useEffect(() => {
    setOverlayState({
      radar: Boolean(senderStatus?.radarActive),
      weather: Boolean(senderStatus?.weatherActive),
      strategy: Boolean(senderStatus?.strategyActive),
    });
  }, [senderStatus?.radarActive, senderStatus?.weatherActive, senderStatus?.strategyActive]);

  useEffect(() => {
    let active = true;

    const loadSenderConfig = async () => {
      setLoadingSenderConfig(true);
      try {
        const response = await fetch(`${normalizeSenderUrl(senderUrl)}/api/config`);
        const data = (await response.json().catch(() => null)) as SenderConfigResponse | null;
        if (!response.ok || !data || !active) {
          return;
        }

        setSenderConfig(buildSenderConfigDraft(data));
        setTrackRecordingOverwriteFilename("");
        if (typeof data.engineerDashboardUrl === "string" && data.engineerDashboardUrl.trim()) {
          const nextDashboardUrl = data.engineerDashboardUrl.trim();
          setEngineerDashboardUrl(nextDashboardUrl);
          setDraftEngineerDashboardUrl(nextDashboardUrl);
        }
        if (data.overlayHotkeys) {
          const nextHotkeys = normalizeOverlayHotkeysInput(data.overlayHotkeys);
          setOverlayHotkeys(nextHotkeys);
          setDraftOverlayHotkeys(nextHotkeys);
        }
        if (data.overlayPresets) {
          setOverlayPresets(normalizeOverlayPresetsInput(data.overlayPresets));
        }
        setSenderConfigError(null);
      } catch {
        if (!active) {
          return;
        }
      } finally {
        if (active) {
          setLoadingSenderConfig(false);
        }
      }
    };

    const loadLocalOps = async () => {
      try {
        const response = await fetch(`${normalizeSenderUrl(senderUrl)}/api/local-ops`);
        const data = (await response.json().catch(() => null)) as LocalOpsResponse | null;
        if (!response.ok || !data || !active) {
          return;
        }

        const nextDashboardUrl = data.engineerDashboardUrl?.trim() || DEFAULT_ENGINEER_DASHBOARD_URL;
        const nextHotkeys = normalizeOverlayHotkeysInput(data.overlayHotkeys);
        const nextPresets = normalizeOverlayPresetsInput(data.overlayPresets);
        setEngineerDashboardUrl(nextDashboardUrl);
        setDraftEngineerDashboardUrl(nextDashboardUrl);
        setOverlayHotkeys(nextHotkeys);
        setDraftOverlayHotkeys(nextHotkeys);
        setOverlayPresets(nextPresets);
        setOverlayError(null);
      } catch {
        if (!active) {
          return;
        }
      }
    };

    void loadSenderConfig();
    void loadLocalOps();
    return () => {
      active = false;
    };
  }, [senderUrl]);

  useEffect(() => {
    if (!recording || !livePlayer) return;
    setRecordedSnaps((current) => [
      ...current,
      {
        ts: Date.now(),
        player: {
          ...livePlayer,
          tireWear: livePlayer.tireWear ? [...livePlayer.tireWear] : undefined,
          tireInnerTemp: livePlayer.tireInnerTemp ? [...livePlayer.tireInnerTemp] : undefined,
          dynamics: livePlayer.dynamics?.map((item) => ({ ...item })),
        },
      },
    ]);
  }, [livePlayer, recording]);

  const liveTeam = useMemo(() => resolveTeamName(livePlayer?.teamId), [livePlayer?.teamId]);
  const autoContext = useMemo(
    () =>
      buildAutoSetupContext({
        liveTrack: detectedTrack,
        liveWeather: liveSession?.weather,
        liveTeam,
        liveSessionType: liveSession?.sessionType ?? null,
        liveTrackTemp: typeof liveSession?.trackTemp === "number" ? liveSession.trackTemp : null,
        liveBestLapTime: typeof livePlayer?.bestLapTime === "number" ? livePlayer.bestLapTime : null,
        latestRaceResult,
        senderTrackMap: SENDER_TRACK_MAP,
        knownTracks: TRACKS,
      }),
    [detectedTrack, livePlayer?.bestLapTime, liveSession?.sessionType, liveSession?.trackTemp, liveSession?.weather, liveTeam, latestRaceResult],
  );

  const autoContextSignature = useMemo(
    () =>
      autoContext
        ? [
            autoContext.source ?? "none",
            autoContext.track ?? "",
            autoContext.weather ?? "",
            autoContext.team ?? "",
            autoContext.mode ?? "",
            autoContext.sessionType ?? "",
          ].join("|")
        : "none",
    [autoContext],
  );

  useEffect(() => {
    if (!autoContextEnabled || !autoContext) return;
    setTrack(autoContext.track);
    setMode(autoContext.mode);
    setWeather(autoContext.weather);
    setTeam(autoContext.mode === "nonequal" ? autoContext.team : null);
  }, [autoContextEnabled, autoContextSignature, autoContext]);

  const contextSignature = `${track ?? ""}|${mode ?? ""}|${team ?? ""}|${weather ?? ""}`;
  const previousContextSignature = useRef(contextSignature);
  useEffect(() => {
    if (previousContextSignature.current !== contextSignature) {
      previousContextSignature.current = contextSignature;
      setSelectedMeta(null);
      setExpanded({});
    }
  }, [contextSignature]);

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

  const matchingRecommendation = useMemo(
    () => findSavedRecommendation(savedRecommendations, { track, weather, mode, team }),
    [mode, savedRecommendations, team, track, weather],
  );
  const recommendationApplyRef = useRef<string>("");
  useEffect(() => {
    if (!matchingRecommendation) {
      recommendationApplyRef.current = "";
      return;
    }

    const nextToken = `${matchingRecommendation.id}:${matchingRecommendation.setupKey}`;
    if (recommendationApplyRef.current === nextToken) {
      return;
    }

    const meta = SETUP_META.find((item) => item.key === matchingRecommendation.setupKey) ?? null;
    if (!meta) {
      return;
    }

    recommendationApplyRef.current = nextToken;
    setSelectedMeta(meta);
  }, [matchingRecommendation]);

  const savedRecommendationList = useMemo(() => {
    if (!savedRecommendations.length) return [];
    if (!matchingRecommendation) return savedRecommendations;
    return [matchingRecommendation, ...savedRecommendations.filter((entry) => entry.id !== matchingRecommendation.id)];
  }, [matchingRecommendation, savedRecommendations]);

  const setupTips = useMemo(() => buildSetupTips(recordedSnaps), [recordedSnaps]);

  const latestResultContext = useMemo(() => {
    if (!latestRaceResult) return null;
    return {
      track: resolveTrackName(latestRaceResult.track?.trackName, SENDER_TRACK_MAP, TRACKS),
      weather: normalizeWeatherMode(latestRaceResult.session?.weather),
      team: resolveTeamName(latestRaceResult.player?.teamId),
      sessionType: latestRaceResult.session?.sessionType ?? null,
    };
  }, [latestRaceResult]);

  const applyManualContext = (updater: () => void) => {
    setAutoContextEnabled(false);
    updater();
  };

  const applySavedRecommendation = (entry: SavedRecommendation) => {
    applyManualContext(() => {
      setTrack(entry.track);
      setMode(entry.mode);
      setWeather(entry.weather);
      setTeam(entry.mode === "nonequal" ? entry.team : null);
      const meta = SETUP_META.find((item) => item.key === entry.setupKey) ?? null;
      setSelectedMeta(meta);
    });
    setSection("setup-manager");
    setSetupWorkspace("builder");
  };

  const saveRecommendation = async () => {
    if (!track || !weather || !mode || !selectedMeta || (mode === "nonequal" && !team)) return;

    const next = upsertSavedRecommendation(savedRecommendations, {
      track,
      weather,
      mode,
      team: mode === "nonequal" ? team : null,
      setupKey: selectedMeta.key,
      label: selectedMeta.label,
      sessionType: liveSession?.sessionType ?? latestRaceResult?.session?.sessionType,
      trackTemp: typeof liveSession?.trackTemp === "number" ? liveSession.trackTemp : latestRaceResult?.session?.trackTemp ?? null,
    });
    await persistRecommendations(next);
  };

  const deleteRecommendation = async (id: string) => {
    await persistRecommendations(removeSavedRecommendation(savedRecommendations, id));
  };

  const captureComparison = async (slot: "before" | "after") => {
    if (!livePlayer) return;
    const next = {
      ...lapComparison,
      [slot]: buildLiveComparisonSnapshot(slot, {
        player: livePlayer,
        session: liveSession,
        track,
        weather,
        team,
        selectedMeta,
      }),
    };
    await persistComparison(next);
  };

  const captureRaceResultAsBefore = async () => {
    if (!latestRaceResult) return;
    const sourceContext = latestResultContext ?? { track, weather, team, sessionType: liveSession?.sessionType ?? null };
    const next = {
      ...lapComparison,
      before: buildRaceResultComparisonSnapshot(latestRaceResult, {
        track: sourceContext.track,
        weather: sourceContext.weather,
        team: sourceContext.team,
        selectedMeta,
      }),
    };
    await persistComparison(next);
  };

  const resetComparison = async () => {
    await persistComparison({ before: null, after: null });
  };

  const applyOverlayStateUpdate = async (nextState: OverlayState, successMessage: string) => {
    setApplyingOverlay(true);
    setOverlayError(null);
    setOverlayNotice(null);
    try {
      const response = await fetch(`${normalizeSenderUrl(senderUrl)}/api/overlay/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextState),
      });
      const data = (await response.json().catch(() => null)) as OverlayState | { error?: string } | null;
      if (!response.ok) {
        throw new Error((data as { error?: string } | null)?.error || "Failed to apply overlay state.");
      }
      const appliedState: OverlayState = {
        radar: Boolean((data as OverlayState | null)?.radar),
        weather: Boolean((data as OverlayState | null)?.weather),
        strategy: Boolean((data as OverlayState | null)?.strategy),
      };
      setOverlayState(appliedState);
      setOverlayNotice(successMessage);
    } catch (error) {
      setOverlayError(error instanceof Error ? error.message : "Failed to apply overlay state.");
    } finally {
      setApplyingOverlay(false);
    }
  };

  const toggleOverlayKind = async (kind: keyof OverlayState) => {
    await applyOverlayStateUpdate(
      {
        ...overlayState,
        [kind]: !overlayState[kind],
      },
      `${kind[0].toUpperCase()}${kind.slice(1)} overlay ${overlayState[kind] ? "closed" : "opened"}.`,
    );
  };

  const saveOverlayPreset = async () => {
    const name = overlayPresetName.trim();
    if (!name) {
      setOverlayError("Enter a preset name before saving.");
      setOverlayNotice(null);
      return;
    }

    const existingIndex = overlayPresets.findIndex((preset) => preset.name.toLowerCase() === name.toLowerCase());
    const nextPreset: OverlayPreset = {
      id: existingIndex >= 0 ? overlayPresets[existingIndex].id : slugifyPresetName(name) || `preset-${Date.now()}`,
      name,
      savedAtLocal: formatSavedAtLocal(),
      radar: overlayState.radar,
      weather: overlayState.weather,
      strategy: overlayState.strategy,
    };
    const nextPresets = [...overlayPresets];
    if (existingIndex >= 0) {
      nextPresets.splice(existingIndex, 1);
    }
    nextPresets.unshift(nextPreset);
    const saved = await persistLocalOps(
      draftEngineerDashboardUrl.trim() || engineerDashboardUrl,
      draftOverlayHotkeys,
      normalizeOverlayPresetsInput(nextPresets),
      `Preset ${name} saved.`,
    );
    if (saved) {
      setOverlayPresetName("");
    }
  };

  const deleteOverlayPreset = async (presetId: string) => {
    await persistLocalOps(
      draftEngineerDashboardUrl.trim() || engineerDashboardUrl,
      draftOverlayHotkeys,
      overlayPresets.filter((preset) => preset.id !== presetId),
      "Preset removed.",
    );
  };

  const applyOverlayPreset = async (preset: OverlayPreset) => {
    await applyOverlayStateUpdate(
      {
        radar: preset.radar,
        weather: preset.weather,
        strategy: preset.strategy,
      },
      `Preset ${preset.name} applied.`,
    );
  };

  const comparisonMetrics = useMemo(
    () => [
      {
        label: "Best Lap",
        before: formatLapTime(lapComparison.before?.bestLapTime),
        after: formatLapTime(lapComparison.after?.bestLapTime),
        delta: getComparisonDelta(lapComparison.before?.bestLapTime ?? null, lapComparison.after?.bestLapTime ?? null, "lower"),
      },
      {
        label: "Last Lap",
        before: formatLapTime(lapComparison.before?.lastLapTime),
        after: formatLapTime(lapComparison.after?.lastLapTime),
        delta: getComparisonDelta(lapComparison.before?.lastLapTime ?? null, lapComparison.after?.lastLapTime ?? null, "lower"),
      },
      {
        label: "Top Speed",
        before: typeof lapComparison.before?.topSpeed === "number" ? `${lapComparison.before.topSpeed} km/h` : "--",
        after: typeof lapComparison.after?.topSpeed === "number" ? `${lapComparison.after.topSpeed} km/h` : "--",
        delta: getComparisonDelta(lapComparison.before?.topSpeed ?? null, lapComparison.after?.topSpeed ?? null, "higher"),
      },
    ],
    [lapComparison.after, lapComparison.before],
  );

  const activeSection = SECTION_COPY[section];
  const senderInvite = senderStatus?.invite ?? null;
  const senderPeers = senderStatus?.peers ?? [];
  const senderPermissionLabels = grantedPermissionLabels(senderStatus?.driverPermissions);

  return (
    <div
      style={{
        minHeight: 0,
        height: "100%",
        width: "100%",
        minWidth: 0,
        paddingTop: WINDOW_TITLEBAR_INSET,
        background: P.bg,
        color: P.text,
        fontFamily: P.sans,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <header style={{ padding: "16px 20px", borderBottom: `1px solid ${P.border}`, background: P.surface, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, rowGap: 8, flexWrap: "wrap", flexShrink: 0 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, fontFamily: P.mono, letterSpacing: 2 }}>F1 DRIVER PACK</div>
          <div style={{ fontSize: 11, color: P.muted }}>
            {senderConnected
              ? `Sender online / room ${senderStatus?.roomCode || "----"}${autoContext?.source === "live-session" ? " / live context synced" : autoContext?.source === "race-result" ? " / result context ready" : ""}`
              : "Sender offline / local workspaces available"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {(["setup-manager", "sender", "overlay"] as const).map((item) => (
            <button
              key={item}
              onClick={() => setSection(item)}
              style={{
                padding: "8px 12px",
                borderRadius: 999,
                border: `1px solid ${section === item ? P.accent : P.border}`,
                background: section === item ? P.accent : "transparent",
                color: section === item ? P.bg : P.muted,
                cursor: "pointer",
                fontFamily: P.mono,
                fontSize: 10,
              }}
            >
              {SECTION_COPY[item].title}
            </button>
          ))}
        </div>
      </header>

      <div style={{ flex: 1, minHeight: 0, minWidth: 0, overflowY: "auto", overflowX: "auto" }}>
        <main style={{ minHeight: "100%", minWidth: 0, padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
          <Panel title="WORKSPACE">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>{activeSection.title}</div>
                <div style={{ fontSize: 11, color: P.muted, lineHeight: 1.6 }}>{activeSection.detail}</div>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <span style={{ padding: "4px 10px", borderRadius: 999, background: canUseSetup ? "rgba(205,255,19,0.12)" : "rgba(255,82,92,0.12)", color: canUseSetup ? P.accent2 : P.danger, fontSize: 10, fontFamily: P.mono }}>
                  Setup {canUseSetup ? "Ready" : "Limited"}
                </span>
                <span style={{ padding: "4px 10px", borderRadius: 999, background: canUseOverlay ? "rgba(0,229,255,0.12)" : "rgba(255,82,92,0.12)", color: canUseOverlay ? P.accent : P.danger, fontSize: 10, fontFamily: P.mono }}>
                  Overlay {canUseOverlay ? "Ready" : "Limited"}
                </span>
                <span style={{ padding: "4px 10px", borderRadius: 999, background: senderConnected ? "rgba(0,229,255,0.12)" : "rgba(59,73,76,0.18)", color: senderConnected ? P.accent : P.muted, fontSize: 10, fontFamily: P.mono }}>
                  Sender {senderConnected ? "Online" : "Offline"}
                </span>
              </div>
            </div>

            {section === "setup-manager" ? (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                {[
                  { id: "builder" as const, label: "Setup Builder" },
                  { id: "analysis" as const, label: "Session Analysis" },
                ].map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setSetupWorkspace(item.id)}
                    style={{
                      padding: "7px 12px",
                      borderRadius: 999,
                      border: `1px solid ${setupWorkspace === item.id ? P.accent2 : P.border}`,
                      background: setupWorkspace === item.id ? P.accent2 : "transparent",
                      color: setupWorkspace === item.id ? P.bg : P.muted,
                      cursor: "pointer",
                      fontFamily: P.mono,
                      fontSize: 10,
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            ) : null}
          </Panel>

          {section === "setup-manager" && setupWorkspace === "builder" ? (
          <>
            <Panel title="AUTO CONTEXT">
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: P.muted, lineHeight: 1.6 }}>
                  {autoContext
                    ? `Auto sync uses ${autoContext.source === "live-session" ? "the current session" : "the latest race result"} to prefill track, weather, and team.`
                    : "No live session or recent race result is available yet."}
                  <br />
                  Manual changes pause auto sync until you resume it.
                </div>
                <button
                  onClick={() => setAutoContextEnabled((current) => !current)}
                  style={{ padding: "8px 12px", borderRadius: 4, border: `1px solid ${autoContextEnabled ? P.accent : P.border}`, background: autoContextEnabled ? "rgba(0,229,255,0.08)" : "transparent", color: autoContextEnabled ? P.accent : P.text, cursor: "pointer", fontFamily: P.mono, fontSize: 10 }}
                >
                  {autoContextEnabled ? "AUTO ON" : "RESUME AUTO"}
                </button>
              </div>

              {autoContext ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
                  <StatTile label="Source" value={autoContext.source === "live-session" ? "Live Session" : "Latest Result"} accent={P.accent} />
                  <StatTile label="Track" value={autoContext.track ?? "--"} />
                  <StatTile label="Session" value={autoContext.sessionType ?? "--"} />
                  <StatTile label="Weather" value={autoContext.weather === "rain" ? "Wet" : autoContext.weather === "dry" ? "Dry" : "--"} />
                  <StatTile label="Team" value={autoContext.team ?? "--"} />
                  <StatTile label="Best Lap" value={formatLapTime(autoContext.bestLapTime)} />
                </div>
              ) : (
                <div style={{ fontSize: 11, color: P.muted }}>Waiting for a live sender feed or a stored race result.</div>
              )}

              {latestRaceResult ? (
                <div style={{ marginTop: 12, padding: 12, borderRadius: 4, background: P.surface2 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 700 }}>LATEST RACE RESULT</div>
                    <div style={{ fontSize: 9, color: P.muted }}>{latestRaceResult.savedAtLocal ?? "Unknown save time"}</div>
                  </div>
                  <div style={{ fontSize: 11, color: P.muted, lineHeight: 1.6 }}>
                    {formatContextLabel({
                      track: latestResultContext?.track ?? null,
                      weather: latestResultContext?.weather ?? null,
                      team: latestResultContext?.team ?? null,
                      sessionType: latestResultContext?.sessionType ?? null,
                    })}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, marginTop: 10 }}>
                    <StatTile label="Driver" value={latestRaceResult.player?.name ?? "--"} />
                    <StatTile label="Finish" value={typeof latestRaceResult.player?.finalPosition === "number" ? `P${latestRaceResult.player.finalPosition}` : "--"} />
                    <StatTile label="Best Lap" value={formatLapTime(latestRaceResult.player?.bestLapMs)} />
                  </div>
                </div>
              ) : null}
            </Panel>

            <Panel title="TRACK">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 6 }}>
                {TRACKS.map((item) => (
                  <button
                    key={item.name}
                    onClick={() =>
                      applyManualContext(() => {
                        setTrack(item.name);
                        setMode(null);
                        setTeam(null);
                        setWeather(null);
                        setSelectedMeta(null);
                        setExpanded({});
                        setGroup("all");
                      })
                    }
                    style={{ padding: "10px 12px", borderRadius: 4, border: `1px solid ${track === item.name ? P.accent : P.border}`, background: track === item.name ? "rgba(0,229,255,0.08)" : P.surface2, color: track === item.name ? P.accent : P.text, textAlign: "left", cursor: "pointer" }}
                  >
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
                    <button
                      key={value}
                      onClick={() =>
                        applyManualContext(() => {
                          setMode(value as Mode);
                          setTeam(null);
                          setWeather(null);
                          setSelectedMeta(null);
                          setExpanded({});
                        })
                      }
                      style={{ padding: "14px 12px", borderRadius: 4, border: `1px solid ${mode === value ? P.accent : P.border}`, background: mode === value ? "rgba(0,229,255,0.08)" : P.surface2, color: mode === value ? P.accent : P.text, textAlign: "left", cursor: "pointer" }}
                    >
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
                    <button
                      key={item.name}
                      onClick={() =>
                        applyManualContext(() => {
                          setTeam(item.name);
                          setWeather(null);
                          setSelectedMeta(null);
                          setExpanded({});
                        })
                      }
                      style={{ padding: "10px 12px", borderRadius: 4, border: `1px solid ${team === item.name ? P.accent : P.border}`, background: team === item.name ? "rgba(0,229,255,0.08)" : P.surface2, color: team === item.name ? P.accent : P.text, textAlign: "left", cursor: "pointer" }}
                    >
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
                    <button
                      key={value}
                      onClick={() =>
                        applyManualContext(() => {
                          setWeather(value as WeatherMode);
                          setSelectedMeta(null);
                          setExpanded({});
                          setGroup("all");
                        })
                      }
                      style={{ padding: "14px 12px", borderRadius: 4, border: `1px solid ${weather === value ? P.accent : P.border}`, background: weather === value ? "rgba(0,229,255,0.08)" : P.surface2, color: weather === value ? P.accent : P.text, cursor: "pointer" }}
                    >
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
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: selectedMeta.color }}>{selectedMeta.label}</div>
                      <div style={{ fontSize: 10, color: P.muted, marginTop: 4 }}>
                        {track} / {formatModeLabel(mode)} / {weather === "rain" ? "WET" : "DRY"}{selectedTeam ? ` / ${selectedTeam.name}` : ""}
                      </div>
                    </div>
                    <button
                      onClick={() => void saveRecommendation()}
                      disabled={!track || !weather || !mode || (mode === "nonequal" && !team)}
                      style={{ padding: "8px 12px", borderRadius: 4, border: "none", background: !track || !weather || !mode || (mode === "nonequal" && !team) ? P.dim : P.accent2, color: P.bg, cursor: !track || !weather || !mode || (mode === "nonequal" && !team) ? "not-allowed" : "pointer", fontFamily: P.mono, fontSize: 10 }}
                    >
                      SAVE RECOMMENDATION
                    </button>
                  </div>
                  {selectedSetup.note ? <div style={{ fontSize: 11, color: P.text, marginTop: 8 }}>{selectedSetup.note}</div> : null}
                  {matchingRecommendation?.setupKey === selectedMeta.key ? (
                    <div style={{ marginTop: 8, fontSize: 10, color: P.accent2, fontFamily: P.mono }}>
                      SAVED FOR CURRENT CONTEXT / {matchingRecommendation.savedAtLocal}
                    </div>
                  ) : null}
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

            {savedRecommendationList.length ? (
              <Panel title="SAVED RECOMMENDATIONS">
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {savedRecommendationList.map((entry) => (
                    <div key={entry.id} style={{ borderRadius: 4, border: `1px solid ${matchingRecommendation?.id === entry.id ? P.accent2 : P.border}`, background: P.surface2, padding: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: matchingRecommendation?.id === entry.id ? P.accent2 : P.text }}>{entry.label}</div>
                          <div style={{ fontSize: 10, color: P.muted, marginTop: 4 }}>
                            {entry.track} / {entry.weather === "rain" ? "Wet" : "Dry"} / {formatModeLabel(entry.mode)}{entry.team ? ` / ${entry.team}` : ""}
                          </div>
                          <div style={{ fontSize: 9, color: P.muted, marginTop: 6 }}>
                            Saved {entry.savedAtLocal}{entry.sessionType ? ` / ${entry.sessionType}` : ""}{entry.trackTemp != null ? ` / ${formatTrackTemp(entry.trackTemp)}` : ""}
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button onClick={() => applySavedRecommendation(entry)} style={{ padding: "6px 10px", borderRadius: 4, border: "none", background: P.accent, color: P.bg, cursor: "pointer", fontFamily: P.mono, fontSize: 10 }}>APPLY</button>
                          <button onClick={() => void deleteRecommendation(entry.id)} style={{ padding: "6px 10px", borderRadius: 4, border: `1px solid ${P.border}`, background: "transparent", color: P.muted, cursor: "pointer", fontFamily: P.mono, fontSize: 10 }}>DELETE</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </Panel>
            ) : null}
          </>
          ) : null}

          {section === "setup-manager" && setupWorkspace === "analysis" ? (
            <SessionAnalysisSection
              theme={P}
              analysisUrl={normalizeAnalysisServerUrl(senderUrl)}
            />
          ) : null}

          {section === "sender" ? (
          <>
            <Panel title="SENDER STATUS">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
                <StatTile label="Sender" value={senderConnected ? "Online" : "Offline"} accent={senderConnected ? P.accent : P.danger} />
                <StatTile label="UDP Port" value={senderStatus?.udpPort ? String(senderStatus.udpPort) : "--"} />
                <StatTile label="Track" value={detectedTrack ?? liveSession?.trackName ?? "--"} />
                <StatTile label="Session" value={liveSession?.sessionType ?? "--"} />
                <StatTile label="Weather" value={liveSession?.weather ?? "--"} />
                <StatTile label="Track Temp" value={typeof liveSession?.trackTemp === "number" ? `${liveSession.trackTemp.toFixed(0)}C` : "--"} />
                <StatTile label="Best Lap" value={formatLapTime(livePlayer?.bestLapTime)} />
                <StatTile label="Save Files" value={typeof senderStatus?.saveFiles === "boolean" ? (senderStatus.saveFiles ? "Enabled" : "Disabled") : "--"} />
                <StatTile label="Connected Engineers" value={typeof senderStatus?.connectedEngineers === "number" ? String(senderStatus.connectedEngineers) : "--"} />
              </div>
            </Panel>

            <Panel title="SENDER SETTINGS">
              {senderConfigError ? (
                <div style={{ marginBottom: 12, padding: 10, borderRadius: 4, background: "rgba(255,82,92,0.08)", color: P.danger, fontSize: 11 }}>
                  {senderConfigError}
                </div>
              ) : null}
              {senderConfigNotice ? (
                <div style={{ marginBottom: 12, padding: 10, borderRadius: 4, background: "rgba(0,229,255,0.08)", color: P.accent, fontSize: 11 }}>
                  {senderConfigNotice}
                </div>
              ) : null}
              {trackRecordingOverwriteFilename ? (
                <div style={{ marginBottom: 12, padding: 10, borderRadius: 4, background: "rgba(205,255,19,0.08)", color: P.accent2, fontSize: 11, lineHeight: 1.6 }}>
                  Existing recorded track data was detected for {senderStatus?.currentTrack?.name || "the current track"}.
                  Save once more to confirm overwrite.
                </div>
              ) : null}

              <div style={{ display: "grid", gap: 12 }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
                  <div style={{ display: "grid", gap: 6 }}>
                    <div style={{ fontSize: 10, color: P.muted, fontFamily: P.mono }}>UDP Port</div>
                    <input
                      value={senderConfig.udpPort}
                      onChange={(event) => setSenderConfig((current) => ({ ...current, udpPort: event.target.value }))}
                      style={{ width: "100%", padding: "10px 12px", borderRadius: 4, border: `1px solid ${P.border}`, background: P.surface2, color: P.text, fontFamily: P.mono, outline: "none" }}
                    />
                  </div>
                  <div style={{ display: "grid", gap: 6 }}>
                    <div style={{ fontSize: 10, color: P.muted, fontFamily: P.mono }}>Room Name</div>
                    <input
                      value={senderConfig.roomName}
                      onChange={(event) => setSenderConfig((current) => ({ ...current, roomName: event.target.value }))}
                      style={{ width: "100%", padding: "10px 12px", borderRadius: 4, border: `1px solid ${P.border}`, background: P.surface2, color: P.text, fontFamily: P.mono, outline: "none" }}
                    />
                  </div>
                  <div style={{ display: "grid", gap: 6 }}>
                    <div style={{ fontSize: 10, color: P.muted, fontFamily: P.mono }}>Room Password</div>
                    <input
                      type="password"
                      value={senderConfig.roomPassword}
                      onChange={(event) => setSenderConfig((current) => ({ ...current, roomPassword: event.target.value }))}
                      style={{ width: "100%", padding: "10px 12px", borderRadius: 4, border: `1px solid ${P.border}`, background: P.surface2, color: P.text, fontFamily: P.mono, outline: "none" }}
                    />
                  </div>
                  <div style={{ display: "grid", gap: 6 }}>
                    <div style={{ fontSize: 10, color: P.muted, fontFamily: P.mono }}>FRC Account Key</div>
                    <input
                      value={senderConfig.frcAccountKey}
                      onChange={(event) => setSenderConfig((current) => ({ ...current, frcAccountKey: event.target.value }))}
                      style={{ width: "100%", padding: "10px 12px", borderRadius: 4, border: `1px solid ${P.border}`, background: P.surface2, color: P.text, fontFamily: P.mono, outline: "none" }}
                    />
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderRadius: 4, border: `1px solid ${P.border}`, background: P.surface2, fontSize: 11 }}>
                    <input
                      type="checkbox"
                      checked={senderConfig.saveFiles}
                      onChange={(event) => setSenderConfig((current) => ({ ...current, saveFiles: event.target.checked }))}
                    />
                    Save Files
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderRadius: 4, border: `1px solid ${P.border}`, background: P.surface2, fontSize: 11 }}>
                    <input
                      type="checkbox"
                      checked={senderConfig.trackRecording}
                      onChange={(event) => {
                        const nextChecked = event.target.checked;
                        setSenderConfig((current) => ({ ...current, trackRecording: nextChecked }));
                        if (!nextChecked) {
                          setTrackRecordingOverwriteFilename("");
                        }
                      }}
                    />
                    Track Recording
                  </label>
                </div>

                <div style={{ display: "grid", gap: 8, padding: 12, borderRadius: 4, border: `1px solid ${P.border}`, background: P.surface2 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                    <div>
                      <div style={{ fontSize: 10, color: P.muted, fontFamily: P.mono, marginBottom: 4 }}>Storage Location</div>
                      <div style={{ fontSize: 11, color: P.muted, lineHeight: 1.6 }}>
                        Logs, packet captures, race archives, and recorded track data are written under this folder.
                      </div>
                    </div>
                    <div style={{ fontSize: 10, color: senderStorageInfo.usingCustom ? P.accent : P.muted, fontFamily: P.mono }}>
                      {senderStorageInfo.usingCustom ? "CUSTOM ROOT" : "DEFAULT ROOT"}
                    </div>
                  </div>

                  <input
                    value={senderStorageInfo.effective || "Default app folder"}
                    readOnly
                    style={{ width: "100%", padding: "10px 12px", borderRadius: 4, border: `1px solid ${P.border}`, background: "#161719", color: P.text, fontFamily: P.mono, outline: "none" }}
                  />

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      onClick={() => void chooseSenderStorageRoot()}
                      disabled={changingSenderStorage}
                      style={{ padding: "10px 12px", borderRadius: 4, border: "none", background: P.accent, color: P.bg, fontFamily: P.mono, cursor: changingSenderStorage ? "wait" : "pointer" }}
                    >
                      {changingSenderStorage ? "APPLYING" : "BROWSE"}
                    </button>
                    <button
                      onClick={() => void resetSenderStorageRoot()}
                      disabled={changingSenderStorage || !senderStorageInfo.usingCustom}
                      style={{ padding: "10px 12px", borderRadius: 4, border: `1px solid ${P.border}`, background: "transparent", color: senderStorageInfo.usingCustom ? P.text : P.muted, fontFamily: P.mono, cursor: changingSenderStorage ? "wait" : senderStorageInfo.usingCustom ? "pointer" : "not-allowed" }}
                    >
                      USE DEFAULT
                    </button>
                    <button
                      onClick={() => void restartEmbeddedSender()}
                      disabled={changingSenderStorage || !window.electronAPI?.restartSender}
                      style={{ padding: "10px 12px", borderRadius: 4, border: `1px solid ${P.border}`, background: "transparent", color: window.electronAPI?.restartSender ? P.text : P.muted, fontFamily: P.mono, cursor: changingSenderStorage ? "wait" : window.electronAPI?.restartSender ? "pointer" : "not-allowed" }}
                    >
                      RESTART SENDER
                    </button>
                  </div>

                  <div style={{ fontSize: 10, color: P.muted, lineHeight: 1.6 }}>
                    Current root: {senderStorageInfo.effective || "Default app folder"}
                    {senderStorageInfo.selected ? " / custom folder saved in desktop settings." : " / using the packaged sender folder."}
                  </div>
                </div>

                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                    <div>
                      <div style={{ fontSize: 10, color: P.muted, fontFamily: P.mono, marginBottom: 4 }}>Forward Targets</div>
                      <div style={{ fontSize: 11, color: P.muted }}>Optional UDP forward destinations for local tools or telemetry mirrors.</div>
                    </div>
                    <button onClick={addSenderForwardTarget} style={{ padding: "8px 12px", borderRadius: 4, border: `1px solid ${P.border}`, background: "transparent", color: P.text, fontFamily: P.mono, cursor: "pointer", fontSize: 10 }}>
                      ADD TARGET
                    </button>
                  </div>

                  {senderConfig.forwardTargets.length ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {senderConfig.forwardTargets.map((target, index) => (
                        <div key={`forward-target-${index}`} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 120px 120px 96px", gap: 8 }}>
                          <input
                            value={target.host}
                            placeholder="Host"
                            onChange={(event) => updateSenderForwardTarget(index, { host: event.target.value })}
                            style={{ width: "100%", padding: "10px 12px", borderRadius: 4, border: `1px solid ${P.border}`, background: P.surface2, color: P.text, fontFamily: P.mono, outline: "none" }}
                          />
                          <input
                            value={target.port}
                            placeholder="Port"
                            onChange={(event) => updateSenderForwardTarget(index, { port: event.target.value })}
                            style={{ width: "100%", padding: "10px 12px", borderRadius: 4, border: `1px solid ${P.border}`, background: P.surface2, color: P.text, fontFamily: P.mono, outline: "none" }}
                          />
                          <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderRadius: 4, border: `1px solid ${P.border}`, background: P.surface2, fontSize: 11 }}>
                            <input
                              type="checkbox"
                              checked={target.enabled}
                              onChange={(event) => updateSenderForwardTarget(index, { enabled: event.target.checked })}
                            />
                            Enabled
                          </label>
                          <button onClick={() => removeSenderForwardTarget(index)} style={{ padding: "10px 12px", borderRadius: 4, border: `1px solid ${P.border}`, background: "transparent", color: P.muted, fontFamily: P.mono, cursor: "pointer", fontSize: 10 }}>
                            REMOVE
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ fontSize: 11, color: P.muted }}>No forward targets configured.</div>
                  )}
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                  <div style={{ fontSize: 11, color: P.muted }}>
                    {loadingSenderConfig
                      ? "Loading current sender config."
                      : "These settings write back to the sender's /api/config endpoint."}
                  </div>
                  <button
                    onClick={() => void saveSenderConfig()}
                    disabled={savingSenderConfig || loadingSenderConfig}
                    style={{ width: 160, padding: "10px 12px", borderRadius: 4, border: "none", background: P.accent2, color: P.bg, fontFamily: P.mono, cursor: savingSenderConfig || loadingSenderConfig ? "wait" : "pointer" }}
                  >
                    {savingSenderConfig ? "SAVING" : trackRecordingOverwriteFilename ? "SAVE & OVERWRITE" : "SAVE SETTINGS"}
                  </button>
                </div>
              </div>
            </Panel>

            <Panel title="SENDER ENDPOINTS">
              <div style={{ display: "grid", gap: 12 }}>
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ fontSize: 10, color: P.muted, fontFamily: P.mono }}>Sender URL</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <input value={draftSenderUrl} onChange={(event) => setDraftSenderUrl(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void saveSenderUrl(); }} style={{ flex: 1, minWidth: 240, padding: "10px 12px", borderRadius: 4, border: `1px solid ${P.border}`, background: P.surface2, color: P.text, fontFamily: P.mono, outline: "none" }} />
                    <button onClick={() => void saveSenderUrl()} style={{ width: 120, padding: "10px 12px", borderRadius: 4, border: "none", background: P.accent, color: P.bg, fontFamily: P.mono, cursor: "pointer" }}>SAVE</button>
                  </div>
                </div>
              </div>
            </Panel>

            <Panel title="ROOM & SHARING">
              <div style={{ display: "grid", gap: 12 }}>
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ fontSize: 10, color: P.muted, fontFamily: P.mono }}>Engineer Dashboard URL</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <input
                      value={draftEngineerDashboardUrl}
                      onChange={(event) => setDraftEngineerDashboardUrl(event.target.value)}
                      onKeyDown={(event) => { if (event.key === "Enter") void saveEngineerDashboardUrl(); }}
                      style={{ flex: 1, minWidth: 240, padding: "10px 12px", borderRadius: 4, border: `1px solid ${P.border}`, background: P.surface2, color: P.text, fontFamily: P.mono, outline: "none" }}
                    />
                    <button onClick={() => void saveEngineerDashboardUrl()} disabled={savingOverlayConfig} style={{ width: 120, padding: "10px 12px", borderRadius: 4, border: "none", background: P.accent, color: P.bg, fontFamily: P.mono, cursor: savingOverlayConfig ? "wait" : "pointer" }}>SAVE</button>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
                  <StatTile label="Room Name" value={senderStatus?.roomName || "--"} />
                  <StatTile label="Room Code" value={senderStatus?.roomCode || "--"} />
                  <StatTile label="Room ID" value={senderStatus?.roomId || "--"} />
                  <StatTile label="Access" value={senderStatus?.roomProtected ? "Password" : "Open"} />
                  <StatTile label="Dashboard" value={engineerDashboardUrl} />
                  <StatTile label="Invite Link" value={senderInvite?.link || "--"} />
                </div>

                <div>
                  <div style={{ fontSize: 10, color: P.muted, fontFamily: P.mono, marginBottom: 8 }}>Connected Engineers</div>
                  {senderPeers.length ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {senderPeers.map((peer) => (
                        <div key={peer.peerId || `${peer.view}-${peer.state}`} style={{ padding: 10, borderRadius: 4, background: P.surface2, border: `1px solid ${P.border}` }}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start", marginBottom: 6 }}>
                            <div>
                              <div style={{ fontSize: 11, fontWeight: 700 }}>{peer.peerId || "Unknown Peer"}</div>
                              <div style={{ fontSize: 10, color: P.muted }}>View {peer.view || "cockpit"}</div>
                            </div>
                            <span style={{ fontSize: 10, color: P.accent }}>{peer.state || "unknown"}</span>
                          </div>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            {grantedPermissionLabels(peer.permissions).length ? (
                              grantedPermissionLabels(peer.permissions).map((label) => (
                                <span key={`${peer.peerId}-${label}`} style={{ padding: "3px 7px", borderRadius: 999, background: "rgba(0,229,255,0.12)", color: P.accent, fontSize: 9, fontFamily: P.mono }}>
                                  {label}
                                </span>
                              ))
                            ) : (
                              <span style={{ fontSize: 10, color: P.muted }}>No permissions granted.</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ fontSize: 11, color: P.muted }}>No engineers connected yet.</div>
                  )}
                </div>
              </div>
            </Panel>

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

            <Panel title="LAP COMPARE">
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                <button onClick={() => void captureComparison("before")} disabled={!livePlayer} style={{ padding: "10px 14px", borderRadius: 4, border: "none", background: livePlayer ? P.accent : P.dim, color: P.bg, cursor: livePlayer ? "pointer" : "not-allowed", fontFamily: P.mono, fontSize: 10 }}>
                  CAPTURE BEFORE
                </button>
                <button onClick={() => void captureComparison("after")} disabled={!livePlayer} style={{ padding: "10px 14px", borderRadius: 4, border: "none", background: livePlayer ? P.accent2 : P.dim, color: P.bg, cursor: livePlayer ? "pointer" : "not-allowed", fontFamily: P.mono, fontSize: 10 }}>
                  CAPTURE AFTER
                </button>
                <button onClick={() => void captureRaceResultAsBefore()} disabled={!latestRaceResult} style={{ padding: "10px 14px", borderRadius: 4, border: `1px solid ${P.border}`, background: "transparent", color: latestRaceResult ? P.text : P.muted, cursor: latestRaceResult ? "pointer" : "not-allowed", fontFamily: P.mono, fontSize: 10 }}>
                  USE LATEST RESULT AS BEFORE
                </button>
                <button onClick={() => void resetComparison()} style={{ padding: "10px 14px", borderRadius: 4, border: `1px solid ${P.border}`, background: "transparent", color: P.muted, cursor: "pointer", fontFamily: P.mono, fontSize: 10 }}>
                  RESET
                </button>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
                <ComparisonSnapshotCard title="BEFORE" snapshot={lapComparison.before} />
                <ComparisonSnapshotCard title="AFTER" snapshot={lapComparison.after} />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
                {comparisonMetrics.map((item) => (
                  <div key={item.label} style={{ padding: 12, borderRadius: 4, background: P.surface2 }}>
                    <div style={{ fontSize: 10, color: P.muted, marginBottom: 8 }}>{item.label}</div>
                    <div style={{ display: "grid", gap: 4 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                        <span style={{ color: P.muted }}>Before</span>
                        <strong>{item.before}</strong>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                        <span style={{ color: P.muted }}>After</span>
                        <strong>{item.after}</strong>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                        <span style={{ color: P.muted }}>Delta</span>
                        <strong style={{ color: item.delta.color }}>{item.delta.text}</strong>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>

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

          {section === "overlay" ? (
          <>
            <Panel title="OVERLAY STATUS">
              {!canUseOverlay ? (
                <div style={{ marginBottom: 12, padding: 12, borderRadius: 4, border: `1px solid ${P.danger}`, background: "rgba(255,82,92,0.08)", color: P.text, fontSize: 11, lineHeight: 1.6 }}>
                  Overlay permission is reported as limited by the sender. Local controls remain visible, but the runtime may reject changes until the permission issue is cleared.
                </div>
              ) : null}

              {overlayError ? (
                <div style={{ marginBottom: 12, padding: 10, borderRadius: 4, background: "rgba(255,82,92,0.08)", color: P.danger, fontSize: 11 }}>
                  {overlayError}
                </div>
              ) : null}
              {overlayNotice ? (
                <div style={{ marginBottom: 12, padding: 10, borderRadius: 4, background: "rgba(0,229,255,0.08)", color: P.accent, fontSize: 11 }}>
                  {overlayNotice}
                </div>
              ) : null}

              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
                {([
                  { key: "radar" as const, label: "Radar", accent: P.accent },
                  { key: "weather" as const, label: "Weather", accent: P.accent2 },
                  { key: "strategy" as const, label: "Strategy", accent: "#ff8f4d" },
                ]).map((item) => (
                  <div key={item.key} style={{ padding: 12, borderRadius: 4, background: P.surface2, border: `1px solid ${P.border}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", marginBottom: 10 }}>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700 }}>{item.label}</div>
                        <div style={{ fontSize: 10, color: overlayState[item.key] ? item.accent : P.muted }}>{formatBooleanState(overlayState[item.key])}</div>
                      </div>
                      <button
                        onClick={() => void toggleOverlayKind(item.key)}
                        disabled={applyingOverlay}
                        style={{ padding: "7px 10px", borderRadius: 4, border: "none", background: overlayState[item.key] ? item.accent : P.dim, color: P.bg, cursor: applyingOverlay ? "wait" : "pointer", fontFamily: P.mono, fontSize: 10 }}
                      >
                        {overlayState[item.key] ? "CLOSE" : "OPEN"}
                      </button>
                    </div>
                    <div style={{ fontSize: 10, color: P.muted, lineHeight: 1.6 }}>
                      {item.label} overlay is currently {overlayState[item.key] ? "running" : "idle"} on the sender host.
                    </div>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title="PRESETS">
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                <input
                  value={overlayPresetName}
                  onChange={(event) => setOverlayPresetName(event.target.value)}
                  onKeyDown={(event) => { if (event.key === "Enter") void saveOverlayPreset(); }}
                  placeholder="Preset name"
                  style={{ flex: 1, minWidth: 220, padding: "10px 12px", borderRadius: 4, border: `1px solid ${P.border}`, background: P.surface2, color: P.text, fontFamily: P.mono, outline: "none" }}
                />
                <button onClick={() => void saveOverlayPreset()} disabled={savingOverlayConfig} style={{ width: 140, padding: "10px 12px", borderRadius: 4, border: "none", background: P.accent, color: P.bg, fontFamily: P.mono, cursor: savingOverlayConfig ? "wait" : "pointer" }}>
                  SAVE CURRENT
                </button>
              </div>

              {overlayPresets.length ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {overlayPresets.map((preset) => (
                    <div key={preset.id} style={{ padding: 12, borderRadius: 4, background: P.surface2, border: `1px solid ${P.border}` }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 700 }}>{preset.name}</div>
                          <div style={{ fontSize: 10, color: P.muted, marginTop: 4 }}>{preset.savedAtLocal || "Saved just now"}</div>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                            {([
                              { label: "Radar", active: preset.radar },
                              { label: "Weather", active: preset.weather },
                              { label: "Strategy", active: preset.strategy },
                            ]).map((item) => (
                              <span key={`${preset.id}-${item.label}`} style={{ padding: "3px 7px", borderRadius: 999, background: item.active ? "rgba(0,229,255,0.12)" : "rgba(59,73,76,0.18)", color: item.active ? P.accent : P.muted, fontSize: 9, fontFamily: P.mono }}>
                                {item.label}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <button onClick={() => void applyOverlayPreset(preset)} disabled={applyingOverlay} style={{ padding: "6px 10px", borderRadius: 4, border: "none", background: P.accent2, color: P.bg, cursor: applyingOverlay ? "wait" : "pointer", fontFamily: P.mono, fontSize: 10 }}>APPLY</button>
                          <button onClick={() => void deleteOverlayPreset(preset.id)} disabled={savingOverlayConfig} style={{ padding: "6px 10px", borderRadius: 4, border: `1px solid ${P.border}`, background: "transparent", color: P.muted, cursor: savingOverlayConfig ? "wait" : "pointer", fontFamily: P.mono, fontSize: 10 }}>DELETE</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 11, color: P.muted }}>No overlay presets saved yet.</div>
              )}
            </Panel>

            <Panel title="HOTKEYS">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, marginBottom: 12 }}>
                {([
                  { key: "radar" as const, label: "Radar" },
                  { key: "weather" as const, label: "Weather" },
                  { key: "strategy" as const, label: "Strategy" },
                ]).map((item) => (
                  <div key={item.key} style={{ display: "grid", gap: 6 }}>
                    <div style={{ fontSize: 10, color: P.muted, fontFamily: P.mono }}>{item.label}</div>
                    <input
                      value={draftOverlayHotkeys[item.key]}
                      onChange={(event) =>
                        setDraftOverlayHotkeys((current) => ({
                          ...current,
                          [item.key]: event.target.value,
                        }))
                      }
                      style={{ width: "100%", padding: "10px 12px", borderRadius: 4, border: `1px solid ${P.border}`, background: P.surface2, color: P.text, fontFamily: P.mono, outline: "none" }}
                    />
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ fontSize: 11, color: P.muted }}>
                  Saved: Radar {overlayHotkeys.radar} / Weather {overlayHotkeys.weather} / Strategy {overlayHotkeys.strategy}
                </div>
                <button onClick={() => void saveOverlayHotkeySettings()} disabled={savingOverlayConfig} style={{ width: 120, padding: "10px 12px", borderRadius: 4, border: "none", background: P.accent2, color: P.bg, fontFamily: P.mono, cursor: savingOverlayConfig ? "wait" : "pointer" }}>
                  SAVE
                </button>
              </div>
            </Panel>

            <Panel title="ACCESS">
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                {[{ label: "Pitwall", enabled: permissionsKnown ? Boolean(senderStatus?.driverPermissions?.pitwall) : true }, { label: "Overlay", enabled: permissionsKnown ? Boolean(senderStatus?.driverPermissions?.overlay) : true }, { label: "Setup", enabled: permissionsKnown ? Boolean(senderStatus?.driverPermissions?.setupSupport) : true }].map((item) => (
                  <span key={item.label} style={{ padding: "4px 10px", borderRadius: 999, background: item.enabled ? "rgba(205,255,19,0.12)" : "rgba(255,82,92,0.12)", color: item.enabled ? P.accent2 : P.danger, fontSize: 10, fontFamily: P.mono }}>
                    {item.label}
                  </span>
                ))}
              </div>
              <div style={{ fontSize: 11, color: P.muted, lineHeight: 1.6 }}>
                {senderPermissionLabels.length
                  ? `Active sender permissions: ${senderPermissionLabels.join(", ")}.`
                  : "Permission preview is unavailable until the sender reports driver permissions."}
              </div>
            </Panel>
          </>
          ) : null}
        </main>
      </div>
    </div>
  );
}
