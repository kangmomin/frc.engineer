import type { Mode, WeatherMode } from "../setupDriverPack";
import type { SenderStorageMode } from "./senderTypes";

export function formatLapTime(value?: number | null): string {
  return typeof value === "number" && value > 0 ? `${(value / 1000).toFixed(3)}s` : "--";
}

export function formatTrackTemp(value?: number | null): string {
  return typeof value === "number" ? `${value.toFixed(0)}°C` : "--";
}

export function formatWeather(weather: WeatherMode): string {
  return weather === "rain" ? "Wet" : weather === "dry" ? "Dry" : "--";
}

export function formatContextLabel(snapshot: {
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
  return parts.join(" · ");
}

export function formatModeLabel(mode: Mode): string {
  if (mode === "nonequal") return "Non-equal";
  if (mode === "equal") return "Equal";
  return "Unset";
}

export function formatSenderStorageModeLabel(mode?: SenderStorageMode | "off" | null): string {
  switch (mode) {
    case "advanced":
      return "Advanced";
    case "summary":
      return "Summary Replay";
    case "resultOnly":
      return "Result Only";
    case "off":
      return "Off";
    default:
      return "--";
  }
}
