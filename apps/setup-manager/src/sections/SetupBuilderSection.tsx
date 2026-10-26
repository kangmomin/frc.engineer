import {
  SETUP_FIELDS,
  SETUP_FIELD_DEFS,
  SORTED_TEAMS,
  TRACKS,
  type SetupValues,
  getCompatibilityLabel,
  getCompatibilityScore,
  getDbKey,
  getSetupFeel,
  getSetupTags,
} from "../../../../shared/setup-manager/catalog";
import type { SenderRaceResult } from "../setupDriverPack";
import type { SetupBuilder, SetupGroup } from "../hooks/useSetupBuilder";
import { formatContextLabel, formatLapTime, formatModeLabel, formatTrackTemp, formatWeather } from "../lib/format";
import {
  Badge,
  Button,
  Card,
  Grid,
  Hint,
  MetricBar,
  MetricTile,
  Notice,
  OptionButton,
  Panel,
  Segmented,
  Spread,
} from "../ui";

const GROUP_ITEMS: ReadonlyArray<{ id: SetupGroup; label: string }> = [
  { id: "all", label: "ALL" },
  { id: "Istvan Puki", label: "PUKI" },
  { id: "Brendon Leigh", label: "BL" },
];

export function SetupBuilderSection({
  builder,
  setupAllowed,
  detectedTrack,
  latestRaceResult,
}: {
  builder: SetupBuilder;
  setupAllowed: boolean;
  detectedTrack: string | null;
  latestRaceResult: SenderRaceResult | null;
}) {
  const {
    track,
    mode,
    team,
    weather,
    group,
    expanded,
    selectedMeta,
    selectedSetup,
    selectedTeam,
    isNonEqual,
    catalog,
    visibleMeta,
    autoContext,
    autoContextEnabled,
    latestResultContext,
    matchingRecommendation,
    savedRecommendationList,
  } = builder;

  if (!setupAllowed) {
    return (
      <Panel title="Setup Catalog" tone="secondary">
        <Notice tone="error" title="셋업 카탈로그 이용 권한이 없습니다 — 운영자에게 문의하세요.">
          플랫폼 계정에 sender.setup.read 권한이 없는 상태입니다. 레이더 / 전략 / 세션 분석 등 다른 기능은 계속 사용할 수 있습니다.
        </Notice>
      </Panel>
    );
  }

  return (
    <>
      {builder.persistError ? <Notice tone="error">{builder.persistError}</Notice> : null}

      <Panel
        title="Auto Context"
        detail={autoContext ? (autoContext.source === "live-session" ? "Live session" : "Latest result") : "Waiting"}
        actions={
          <Button size="sm" variant={autoContextEnabled ? "primary" : "ghost"} onClick={builder.toggleAutoContext}>
            {autoContextEnabled ? "Auto On" : "Resume Auto"}
          </Button>
        }
      >
        <Hint>
          {autoContext
            ? `Auto sync uses ${autoContext.source === "live-session" ? "the current session" : "the latest race result"} to prefill track, weather, and team.`
            : "No live session or recent race result is available yet."}{" "}
          Manual changes pause auto sync until you resume it.
        </Hint>

        {autoContext ? (
          <Grid cols={3}>
            <MetricTile compact label="Source" value={autoContext.source === "live-session" ? "Live Session" : "Latest Result"} tone="primary" />
            <MetricTile compact label="Track" value={autoContext.track ?? "--"} tone="neutral" />
            <MetricTile compact label="Session" value={autoContext.sessionType ?? "--"} tone="neutral" />
            <MetricTile compact label="Weather" value={formatWeather(autoContext.weather)} tone="neutral" />
            <MetricTile compact label="Team" value={autoContext.team ?? "--"} tone="neutral" />
            <MetricTile compact label="Best Lap" value={formatLapTime(autoContext.bestLapTime)} tone="tertiary" />
          </Grid>
        ) : null}

        {latestRaceResult ? (
          <Card title="Latest Race Result" aside={<Hint>{latestRaceResult.savedAtLocal ?? "Unknown save time"}</Hint>}>
            <Hint>
              {formatContextLabel({
                track: latestResultContext?.track ?? null,
                weather: latestResultContext?.weather ?? null,
                team: latestResultContext?.team ?? null,
                sessionType: latestResultContext?.sessionType ?? null,
              })}
            </Hint>
            <Grid cols={3}>
              <MetricTile compact label="Driver" value={latestRaceResult.player?.name ?? "--"} tone="neutral" />
              <MetricTile
                compact
                label="Finish"
                value={typeof latestRaceResult.player?.finalPosition === "number" ? `P${latestRaceResult.player.finalPosition}` : "--"}
                tone="primary"
              />
              <MetricTile compact label="Best Lap" value={formatLapTime(latestRaceResult.player?.bestLapMs)} tone="tertiary" />
            </Grid>
          </Card>
        ) : null}
      </Panel>

      <Panel title="Track" detail={track ?? "Select a circuit"}>
        <Grid cols={3} gap={6}>
          {TRACKS.map((item) => (
            <OptionButton
              key={item.name}
              selected={track === item.name}
              title={`${item.name}${item.sprint ? " S" : ""}`}
              meta={`R${item.round}${detectedTrack === item.name ? " · Live" : ""}`}
              onClick={() => builder.selectTrack(item.name)}
            />
          ))}
        </Grid>
      </Panel>

      {track ? (
        <Panel title="Mode">
          <Grid cols={2}>
            <OptionButton selected={mode === "equal"} title="Equal performance" onClick={() => builder.selectMode("equal")} />
            <OptionButton selected={mode === "nonequal"} title="Non-equal performance" onClick={() => builder.selectMode("nonequal")} />
          </Grid>
        </Panel>
      ) : null}

      {mode === "nonequal" ? (
        <Panel title="Team">
          <Grid cols={2} gap={6}>
            {SORTED_TEAMS.map((item) => (
              <OptionButton key={item.name} selected={team === item.name} title={item.name} meta={`Score ${item.total}`} onClick={() => builder.selectTeam(item.name)} />
            ))}
          </Grid>
        </Panel>
      ) : null}

      {mode ? (
        <Panel title="Weather">
          <Grid cols={2}>
            <OptionButton selected={weather === "dry"} title="Dry" onClick={() => builder.selectWeather("dry")} />
            <OptionButton selected={weather === "rain"} title="Wet" onClick={() => builder.selectWeather("rain")} />
          </Grid>
        </Panel>
      ) : null}

      {weather && catalog ? (
        <Panel
          title="Setups"
          detail={`${visibleMeta.length} available`}
          actions={weather === "dry" ? <Segmented<SetupGroup> items={GROUP_ITEMS} value={group} onChange={builder.setGroup} ariaLabel="Setup author" /> : undefined}
        >
          <Hint>{catalog.track.notes}</Hint>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {visibleMeta.map((meta) => {
              const setup = catalog[getDbKey(meta)] as SetupValues;
              const isExpanded = Boolean(expanded[meta.key]);
              const isSelected = selectedMeta?.key === meta.key;
              const compatibility = isNonEqual ? getCompatibilityScore(setup, selectedTeam) : null;
              const compatibilityLabel = typeof compatibility === "number" ? getCompatibilityLabel(compatibility) : null;

              return (
                <Card key={meta.key} selectedColor={isSelected ? meta.color : undefined}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: meta.color, boxShadow: `0 0 10px ${meta.color}`, flex: "none" }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: isSelected ? meta.color : "var(--text-primary)" }}>{meta.label}</div>
                      <Hint>{getSetupFeel(setup)}</Hint>
                    </div>
                    <Button size="sm" style={{ background: meta.color }} onClick={() => builder.setSelectedMeta(meta)}>
                      Select
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => builder.toggleExpanded(meta.key)}>
                      {isExpanded ? "Hide" : "Open"}
                    </Button>
                  </div>
                  {compatibilityLabel && typeof compatibility === "number" ? (
                    <div>
                      <Badge color={compatibilityLabel.color}>
                        {compatibilityLabel.icon} {selectedTeam?.name} {compatibilityLabel.label} / {compatibility}
                      </Badge>
                    </div>
                  ) : null}
                  {isExpanded ? (
                    <>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {getSetupTags(setup).map((tag) => (
                          <Badge key={tag.label} color={tag.color}>
                            {tag.label}
                          </Badge>
                        ))}
                      </div>
                      <Grid cols={2} style={{ gap: "8px 14px" }}>
                        {SETUP_FIELDS.map((field) => (
                          <div key={field.k}>
                            <Spread style={{ marginBottom: 3 }}>
                              <span style={{ fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-muted)" }}>{field.l}</span>
                              <span style={{ fontFamily: "var(--font-racing)", fontSize: 12, fontWeight: 700 }}>{setup[field.k]}</span>
                            </Spread>
                            <MetricBar value={setup[field.k]} min={SETUP_FIELD_DEFS[field.k].min} max={SETUP_FIELD_DEFS[field.k].max} />
                          </div>
                        ))}
                      </Grid>
                    </>
                  ) : null}
                </Card>
              );
            })}
          </div>
        </Panel>
      ) : null}

      {selectedSetup && selectedMeta && catalog ? (
        <Panel title="Review" tone="tertiary">
          <Card selectedColor={selectedMeta.color}>
            <Spread>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: "var(--font-racing)", fontSize: 15, fontWeight: 800, color: selectedMeta.color }}>{selectedMeta.label}</div>
                <Hint>
                  {track} · {formatModeLabel(mode)} · {weather === "rain" ? "Wet" : "Dry"}
                  {selectedTeam ? ` · ${selectedTeam.name}` : ""}
                </Hint>
              </div>
              <Button variant="go" onClick={() => void builder.saveRecommendation()} disabled={!builder.canSaveRecommendation}>
                Save Recommendation
              </Button>
            </Spread>
            {selectedSetup.note ? <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{selectedSetup.note}</div> : null}
            {matchingRecommendation?.setupKey === selectedMeta.key ? (
              <div>
                <Badge color="var(--accent-lime)">Saved for current context · {matchingRecommendation.savedAtLocal}</Badge>
              </div>
            ) : null}
          </Card>
          <Grid cols={2}>
            <MetricTile compact label="Strategy" value={catalog.track.strategy} tone="neutral" />
            <MetricTile compact label="Pit Window" value={catalog.track.pitWindow50} tone="neutral" />
            <MetricTile compact label="Quali Fuel" value={catalog.track.qualiFuel ?? "N/A"} tone="neutral" />
            <MetricTile compact label="ERS Trigger" value={catalog.track.ersEnable ?? "N/A"} tone="neutral" />
          </Grid>
        </Panel>
      ) : null}

      {savedRecommendationList.length ? (
        <Panel title="Saved Recommendations" detail={`${savedRecommendationList.length} saved`}>
          {savedRecommendationList.map((entry) => {
            const current = matchingRecommendation?.id === entry.id;
            return (
              <Card key={entry.id} selectedColor={current ? "var(--accent-lime)" : undefined}>
                <Spread>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: current ? "var(--accent-lime)" : "var(--text-primary)" }}>{entry.label}</div>
                    <Hint>
                      {entry.track} · {entry.weather === "rain" ? "Wet" : "Dry"} · {formatModeLabel(entry.mode)}
                      {entry.team ? ` · ${entry.team}` : ""}
                    </Hint>
                    <Hint style={{ fontSize: 10.5 }}>
                      Saved {entry.savedAtLocal}
                      {entry.sessionType ? ` · ${entry.sessionType}` : ""}
                      {entry.trackTemp != null ? ` · ${formatTrackTemp(entry.trackTemp)}` : ""}
                    </Hint>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <Button size="sm" onClick={() => builder.applySavedRecommendation(entry)}>
                      Apply
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void builder.deleteRecommendation(entry.id)}>
                      Delete
                    </Button>
                  </div>
                </Spread>
              </Card>
            );
          })}
        </Panel>
      ) : null}
    </>
  );
}
