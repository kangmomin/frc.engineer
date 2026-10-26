import type { SenderStorageMode } from "./senderTypes";

export function formatLapTime(value?: number | null): string {
  return typeof value === "number" && value > 0 ? `${(value / 1000).toFixed(3)}s` : "--";
}

export function formatTrackTemp(value?: number | null): string {
  return typeof value === "number" ? `${value.toFixed(0)}°C` : "--";
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
