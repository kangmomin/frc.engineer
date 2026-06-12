import { useMemo, useState, type CSSProperties } from "react";

import {
  SETUP_FIELDS,
  SETUP_FIELD_DEFS,
  SETUP_META,
  TRACKS,
  type SetupKey,
  getDbKey,
  getSetupFeel,
  getSetupTags,
  getTrackCatalog,
} from "./catalog";

type WeatherMode = "dry" | "rain" | null;

interface F1SetupManagerProps {
  onBack?: () => void;
}

function MetricBar({ value, min, max }: { value: number; min: number; max: number }) {
  const percent = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
  const color = percent < 33 ? "#60a5fa" : percent < 66 ? "#f59e0b" : "#ef4444";

  return (
    <div style={{ height: 4, borderRadius: 999, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
      <div style={{ width: `${percent}%`, height: "100%", borderRadius: 999, background: color }} />
    </div>
  );
}

function TrackBadge({ badge }: { badge: string }) {
  return (
    <span
      style={{
        width: 28,
        height: 28,
        borderRadius: 999,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,229,255,0.08)",
        color: "#00e5ff",
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: 0.4,
        flexShrink: 0,
      }}
    >
      {badge}
    </span>
  );
}

export function F1SetupManager({ onBack }: F1SetupManagerProps) {
  const [track, setTrack] = useState<string | null>(null);
  const [weather, setWeather] = useState<WeatherMode>(null);
  const [group, setGroup] = useState("all");
  const [selectedKey, setSelectedKey] = useState<SetupKey | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const catalog = useMemo(() => getTrackCatalog(track), [track]);
  const selectedMeta = useMemo(
    () => SETUP_META.find((meta) => meta.key === selectedKey) ?? null,
    [selectedKey],
  );
  const selectedSetup = selectedMeta ? catalog?.[getDbKey(selectedMeta)] : null;

  const visibleMeta = useMemo(() => {
    if (!weather) {
      return [];
    }

    return SETUP_META.filter((meta) => {
      const matchesWeather = weather === "rain" ? meta.rain : !meta.rain;
      const matchesGroup = group === "all" || meta.group === group;
      return matchesWeather && matchesGroup;
    });
  }, [group, weather]);

  const resetAfterTrack = (nextTrack: string) => {
    setTrack(nextTrack);
    setWeather(null);
    setGroup("all");
    setSelectedKey(null);
    setExpanded({});
  };

  const resetAfterWeather = (nextWeather: Exclude<WeatherMode, null>) => {
    setWeather(nextWeather);
    setGroup("all");
    setSelectedKey(null);
    setExpanded({});
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0b1020",
        color: "#e2e8f0",
        fontFamily: "'Inter', sans-serif",
        paddingBottom: 48,
      }}
    >
      <div
        style={{
          padding: "16px 18px",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(10, 15, 30, 0.92)",
          backdropFilter: "blur(16px)",
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        {onBack ? (
          <button
            onClick={onBack}
            style={{
              border: "1px solid rgba(255,255,255,0.14)",
              background: "transparent",
              color: "#94a3b8",
              borderRadius: 999,
              padding: "6px 12px",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            Back
          </button>
        ) : null}
        <div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>F1 25 Setup Manager</div>
          <div style={{ fontSize: 11, color: "#64748b" }}>Shared setup catalog / AI removed</div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: 14 }}>
        <section style={panelStyle}>
          <div style={panelHeaderStyle}>1. Track</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {TRACKS.map((item) => {
              const active = track === item.name;
              return (
                <button
                  key={item.name}
                  onClick={() => resetAfterTrack(item.name)}
                  style={{
                    ...cardButtonStyle,
                    borderColor: active ? "#00e5ff" : "rgba(255,255,255,0.08)",
                    background: active ? "rgba(0,229,255,0.08)" : "rgba(255,255,255,0.03)",
                  }}
                >
                  <TrackBadge badge={item.badge} />
                  <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: active ? "#00e5ff" : "#e2e8f0" }}>
                      {item.name}
                      {item.sprint ? " S" : ""}
                    </div>
                    <div style={{ fontSize: 10, color: "#64748b" }}>Round {item.round}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {track ? (
          <section style={panelStyle}>
            <div style={panelHeaderStyle}>2. Weather</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {[
                { key: "dry" as const, title: "Dry", detail: "Race and quali baselines" },
                { key: "rain" as const, title: "Wet", detail: "Intermediate and full wet" },
              ].map((item) => {
                const active = weather === item.key;
                return (
                  <button
                    key={item.key}
                    onClick={() => resetAfterWeather(item.key)}
                    style={{
                      ...cardButtonStyle,
                      minHeight: 88,
                      alignItems: "flex-start",
                      flexDirection: "column",
                      borderColor: active ? "#22c55e" : "rgba(255,255,255,0.08)",
                      background: active ? "rgba(34,197,94,0.08)" : "rgba(255,255,255,0.03)",
                    }}
                  >
                    <div style={{ fontSize: 16, fontWeight: 700, color: active ? "#22c55e" : "#e2e8f0" }}>{item.title}</div>
                    <div style={{ fontSize: 11, color: "#64748b" }}>{item.detail}</div>
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}

        {weather && catalog ? (
          <section style={panelStyle}>
            <div style={panelHeaderStyle}>3. Setup</div>
            <div style={{ marginBottom: 12, padding: 10, borderRadius: 12, background: "rgba(255,255,255,0.03)" }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>{catalog.track.notes}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {[
                  `Soft ${catalog.track.softLife}`,
                  `Medium ${catalog.track.medLife}`,
                  `Hard ${catalog.track.hardLife}`,
                  catalog.track.pitWindow50,
                  catalog.track.strategy,
                ].map((item) => (
                  <span
                    key={item}
                    style={{
                      fontSize: 10,
                      padding: "3px 8px",
                      borderRadius: 999,
                      background: "rgba(0,229,255,0.08)",
                      color: "#bae6fd",
                    }}
                  >
                    {item}
                  </span>
                ))}
              </div>
            </div>

            {weather === "dry" ? (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                {[
                  { key: "all", label: "All" },
                  { key: "Istvan Puki", label: "Puki" },
                  { key: "Brendon Leigh", label: "BL" },
                ].map((item) => (
                  <button
                    key={item.key}
                    onClick={() => setGroup(item.key)}
                    style={{
                      padding: "5px 12px",
                      borderRadius: 999,
                      border: `1px solid ${group === item.key ? "#00e5ff" : "rgba(255,255,255,0.1)"}`,
                      background: group === item.key ? "#00e5ff" : "transparent",
                      color: group === item.key ? "#08101f" : "#94a3b8",
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            ) : null}

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {visibleMeta.map((meta) => {
                const setup = catalog[getDbKey(meta)];
                if (!setup) {
                  return null;
                }

                const isSelected = selectedMeta?.key === meta.key;
                const isExpanded = Boolean(expanded[meta.key]);
                const tags = getSetupTags(setup);

                return (
                  <div
                    key={meta.key}
                    style={{
                      borderRadius: 12,
                      border: `1px solid ${isSelected ? meta.color : "rgba(255,255,255,0.08)"}`,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        padding: 12,
                        display: "flex",
                        gap: 12,
                        alignItems: "flex-start",
                        background: "rgba(255,255,255,0.03)",
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                          <span style={{ width: 8, height: 8, borderRadius: 999, background: meta.color, flexShrink: 0 }} />
                          <span style={{ fontSize: 13, fontWeight: 700, color: isSelected ? meta.color : "#e2e8f0" }}>{meta.label}</span>
                          <span style={{ fontSize: 10, color: "#64748b" }}>{meta.who}</span>
                        </div>
                        <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 6 }}>{getSetupFeel(setup)}</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                          {tags.map((tag) => (
                            <span
                              key={tag.label}
                              style={{
                                padding: "2px 7px",
                                borderRadius: 999,
                                background: `${tag.color}18`,
                                color: tag.color,
                                fontSize: 10,
                                fontWeight: 700,
                              }}
                            >
                              {tag.label}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        <button
                          onClick={() => setSelectedKey(meta.key)}
                          style={{
                            border: "none",
                            borderRadius: 8,
                            padding: "6px 12px",
                            background: meta.color,
                            color: "#08101f",
                            fontSize: 11,
                            fontWeight: 700,
                            cursor: "pointer",
                          }}
                        >
                          Select
                        </button>
                        <button
                          onClick={() =>
                            setExpanded((current) => ({
                              ...current,
                              [meta.key]: !current[meta.key],
                            }))
                          }
                          style={{
                            border: "1px solid rgba(255,255,255,0.1)",
                            borderRadius: 8,
                            padding: "6px 12px",
                            background: "transparent",
                            color: "#94a3b8",
                            fontSize: 11,
                            cursor: "pointer",
                          }}
                        >
                          {isExpanded ? "Hide" : "Open"}
                        </button>
                      </div>
                    </div>

                    {isExpanded ? (
                      <div style={{ padding: 12, background: "rgba(0,0,0,0.16)" }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 14px" }}>
                          {SETUP_FIELDS.map((field) => (
                            <div key={field.k}>
                              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                                <span style={{ fontSize: 10, color: "#64748b" }}>{field.l}</span>
                                <span style={{ fontSize: 10, fontWeight: 700 }}>{setup[field.k]}</span>
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
          </section>
        ) : null}

        {selectedSetup && selectedMeta && catalog ? (
          <section style={panelStyle}>
            <div style={panelHeaderStyle}>4. Review</div>
            <div
              style={{
                padding: 12,
                borderRadius: 12,
                background: "rgba(255,255,255,0.03)",
                border: `1px solid ${selectedMeta.color}`,
                marginBottom: 12,
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 700, color: selectedMeta.color }}>{selectedMeta.label}</div>
              <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>
                {track} / {weather === "rain" ? "Wet" : "Dry"} / {selectedMeta.group}
              </div>
              {selectedSetup.note ? (
                <div style={{ fontSize: 11, color: "#cbd5e1", marginTop: 8 }}>{selectedSetup.note}</div>
              ) : null}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
              {[
                { label: "Pit Window", value: catalog.track.pitWindow50 },
                { label: "Strategy", value: catalog.track.strategy },
                { label: "Quali Fuel", value: catalog.track.qualiFuel || "N/A" },
                { label: "ERS Trigger", value: catalog.track.ersEnable || "N/A" },
              ].map((item) => (
                <div key={item.label} style={{ padding: 10, borderRadius: 12, background: "rgba(255,255,255,0.03)" }}>
                  <div style={{ fontSize: 10, color: "#64748b", marginBottom: 4 }}>{item.label}</div>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>{item.value}</div>
                </div>
              ))}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 14px" }}>
              {SETUP_FIELDS.map((field) => (
                <div key={field.k}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                    <span style={{ fontSize: 10, color: "#64748b" }}>{field.l}</span>
                    <span style={{ fontSize: 10, fontWeight: 700 }}>{selectedSetup[field.k]}</span>
                  </div>
                  <MetricBar value={selectedSetup[field.k]} min={SETUP_FIELD_DEFS[field.k].min} max={SETUP_FIELD_DEFS[field.k].max} />
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

const panelStyle: CSSProperties = {
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(15, 23, 42, 0.78)",
  overflow: "hidden",
};

const panelHeaderStyle: CSSProperties = {
  padding: "12px 14px",
  borderBottom: "1px solid rgba(255,255,255,0.08)",
  fontSize: 13,
  fontWeight: 700,
};

const cardButtonStyle: CSSProperties = {
  width: "100%",
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: 12,
  borderRadius: 12,
  borderWidth: 1,
  borderStyle: "solid",
  cursor: "pointer",
  color: "#e2e8f0",
};
