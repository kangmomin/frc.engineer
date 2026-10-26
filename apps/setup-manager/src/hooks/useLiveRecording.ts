import { useEffect, useMemo, useState } from "react";

import type { SenderPlayer } from "../lib/senderTypes";

export type Severity = "high" | "med" | "low";

export interface SetupTip {
  issue: string;
  severity: Severity;
  reason: string;
  changes: string[];
}

interface TelemetrySnapshot {
  ts: number;
  player: SenderPlayer;
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
    tips.push({ issue: "Heavy braking", severity: "med", reason: `${dynamics.lockupCount} heavy-braking episodes (brake >90%, speed >80 km/h). Wheel lockup is unconfirmed.`, changes: [] });
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

/** 라이브 플레이어 피드를 폴링 주기마다 쌓아 규칙 기반 세팅 피드백을 만든다. */
export function useLiveRecording(livePlayer: SenderPlayer | null) {
  const [recording, setRecording] = useState(false);
  const [recordedSnaps, setRecordedSnaps] = useState<TelemetrySnapshot[]>([]);

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

  const setupTips = useMemo(() => buildSetupTips(recordedSnaps), [recordedSnaps]);

  return {
    recording,
    sampleCount: recordedSnaps.length,
    setupTips,
    start: () => {
      setRecordedSnaps([]);
      setRecording(true);
    },
    stop: () => setRecording(false),
  };
}

export type LiveRecording = ReturnType<typeof useLiveRecording>;
