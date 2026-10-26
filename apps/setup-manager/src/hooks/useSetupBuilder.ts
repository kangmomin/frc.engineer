import { useEffect, useMemo, useRef, useState } from "react";

import {
  SENDER_TRACK_MAP,
  SETUP_META,
  SORTED_TEAMS,
  TRACKS,
  type SetupMeta,
  type SetupValues,
  getCompatibilityScore,
  getDbKey,
  getTrackCatalog,
} from "../../../../shared/setup-manager/catalog";
import {
  buildAutoSetupContext,
  findSavedRecommendation,
  normalizeSavedRecommendations,
  normalizeWeatherMode,
  removeSavedRecommendation,
  resolveTeamName,
  resolveTrackName,
  upsertSavedRecommendation,
  type Mode,
  type SavedRecommendation,
  type SenderRaceResult,
  type WeatherMode,
} from "../setupDriverPack";
import { errorMessage, readStoredValue, writeStoredValue } from "../lib/senderApi";
import type { SenderPlayer, SenderSession } from "../lib/senderTypes";

const SAVED_RECOMMENDATIONS_KEY = "frc_setup_recommendations";

export type SetupGroup = "all" | "Istvan Puki" | "Brendon Leigh";

interface LiveFeed {
  detectedTrack: string | null;
  liveSession: SenderSession | null;
  livePlayer: SenderPlayer | null;
  latestRaceResult: SenderRaceResult | null;
}

/** Setup Builder 상태: 자동 컨텍스트(라이브 세션·최근 결과) + 수동 선택 + 저장된 추천. */
export function useSetupBuilder({ detectedTrack, liveSession, livePlayer, latestRaceResult }: LiveFeed) {
  const [track, setTrack] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(null);
  const [team, setTeam] = useState<string | null>(null);
  const [weather, setWeather] = useState<WeatherMode>(null);
  const [selectedMeta, setSelectedMeta] = useState<SetupMeta | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [group, setGroup] = useState<SetupGroup>("all");
  const [autoContextEnabled, setAutoContextEnabled] = useState(true);
  const [savedRecommendations, setSavedRecommendations] = useState<SavedRecommendation[]>([]);
  const [persistError, setPersistError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const stored = await readStoredValue<unknown>(SAVED_RECOMMENDATIONS_KEY, []);
        if (!active) return;
        setSavedRecommendations(normalizeSavedRecommendations(stored));
      } catch (error) {
        if (!active) return;
        setPersistError(errorMessage(error, "Failed to load persisted state."));
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const persistRecommendations = async (next: SavedRecommendation[]) => {
    const previous = savedRecommendations;
    setSavedRecommendations(next);
    setPersistError(null);
    try {
      await writeStoredValue(SAVED_RECOMMENDATIONS_KEY, next);
    } catch (error) {
      // 저장 실패 시 화면 상태와 스토리지가 어긋나지 않도록 롤백
      setSavedRecommendations(previous);
      setPersistError(errorMessage(error, "Failed to save recommendations."));
    }
  };

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

  const latestResultContext = useMemo(() => {
    if (!latestRaceResult) return null;
    return {
      track: resolveTrackName(latestRaceResult.track?.trackName, SENDER_TRACK_MAP, TRACKS),
      weather: normalizeWeatherMode(latestRaceResult.session?.weather),
      team: resolveTeamName(latestRaceResult.player?.teamId),
      sessionType: latestRaceResult.session?.sessionType ?? null,
    };
  }, [latestRaceResult]);

  // 수동 선택은 자동 동기화를 멈춘다(사용자가 다시 켤 때까지).
  const applyManualContext = (updater: () => void) => {
    setAutoContextEnabled(false);
    updater();
  };

  const selectTrack = (name: string) =>
    applyManualContext(() => {
      setTrack(name);
      setMode(null);
      setTeam(null);
      setWeather(null);
      setSelectedMeta(null);
      setExpanded({});
      setGroup("all");
    });

  const selectMode = (value: Exclude<Mode, null>) =>
    applyManualContext(() => {
      setMode(value);
      setTeam(null);
      setWeather(null);
      setSelectedMeta(null);
      setExpanded({});
    });

  const selectTeam = (name: string) =>
    applyManualContext(() => {
      setTeam(name);
      setWeather(null);
      setSelectedMeta(null);
      setExpanded({});
    });

  const selectWeather = (value: Exclude<WeatherMode, null>) =>
    applyManualContext(() => {
      setWeather(value);
      setSelectedMeta(null);
      setExpanded({});
      setGroup("all");
    });

  const toggleExpanded = (key: string) => setExpanded((current) => ({ ...current, [key]: !current[key] }));

  const applySavedRecommendation = (entry: SavedRecommendation) => {
    applyManualContext(() => {
      setTrack(entry.track);
      setMode(entry.mode);
      setWeather(entry.weather);
      setTeam(entry.mode === "nonequal" ? entry.team : null);
      const meta = SETUP_META.find((item) => item.key === entry.setupKey) ?? null;
      setSelectedMeta(meta);
    });
  };

  const canSaveRecommendation = Boolean(track && weather && mode && selectedMeta && (mode !== "nonequal" || team));

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

  return {
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
    persistError,
    canSaveRecommendation,
    setGroup,
    setSelectedMeta,
    toggleAutoContext: () => setAutoContextEnabled((current) => !current),
    selectTrack,
    selectMode,
    selectTeam,
    selectWeather,
    toggleExpanded,
    applySavedRecommendation,
    saveRecommendation,
    deleteRecommendation,
  };
}

export type SetupBuilder = ReturnType<typeof useSetupBuilder>;
