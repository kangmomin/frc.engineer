import { useEffect, useState } from "react";

import { SENDER_TRACK_MAP, TRACKS } from "../../../../shared/setup-manager/catalog";
import { fetchJsonWithSenderDebug } from "../senderDebug";
import { resolveTrackName, type SenderRaceResult } from "../setupDriverPack";
import { DEFAULT_PLATFORM_BASE_URL, normalizeSenderUrl } from "../lib/senderApi";
import type { SenderPlayer, SenderSession, SenderStatus } from "../lib/senderTypes";

export function useSenderConnection(senderUrl: string) {
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<SenderStatus | null>(null);
  const [session, setSession] = useState<SenderSession | null>(null);
  const [player, setPlayer] = useState<SenderPlayer | null>(null);
  const [latestRaceResult, setLatestRaceResult] = useState<SenderRaceResult | null>(null);

  useEffect(() => {
    const normalized = normalizeSenderUrl(senderUrl);
    let active = true;
    let timer: number | null = null;
    // 세대 토큰: 가장 최근 poll의 응답만 상태에 반영
    let pollSeq = 0;

    const poll = async () => {
      const seq = ++pollSeq;
      const isCurrent = () => active && seq === pollSeq;

      try {
        const { data } = await fetchJsonWithSenderDebug<SenderStatus>(normalized, "/api/status", "sender-status", {
          init: { signal: AbortSignal.timeout(5000) },
        });
        const nextStatus = data as SenderStatus;
        if (!isCurrent()) return;
        setStatus(nextStatus);
        setConnected(true);
      } catch {
        if (!isCurrent()) return;
        setConnected(false);
        setStatus(null);
      }

      try {
        const { data } = await fetchJsonWithSenderDebug<{
          pitwallState?: { session?: SenderSession; drivers?: SenderPlayer[]; playerIndex?: number };
        }>(normalized, "/api/debug", "sender-debug", { init: { signal: AbortSignal.timeout(5000) } });
        const debugData = data as {
          pitwallState?: { session?: SenderSession; drivers?: SenderPlayer[]; playerIndex?: number };
        };
        if (!isCurrent()) return;
        const drivers = debugData.pitwallState?.drivers ?? [];
        const playerIndex = debugData.pitwallState?.playerIndex ?? -1;
        setSession(debugData.pitwallState?.session ?? null);
        setPlayer(playerIndex >= 0 && playerIndex < drivers.length ? drivers[playerIndex] ?? null : null);
      } catch {
        if (!isCurrent()) return;
        setSession(null);
        setPlayer(null);
      }

      try {
        const { status, data } = await fetchJsonWithSenderDebug<SenderRaceResult | { error?: string }>(
          normalized,
          "/api/races/latest",
          "latest-race-result",
          { allowStatuses: [404], init: { signal: AbortSignal.timeout(5000) } },
        );
        if (status === 404) {
          if (!isCurrent()) return;
          setLatestRaceResult(null);
          return;
        }
        const nextResult = data as SenderRaceResult;
        if (!isCurrent()) return;
        setLatestRaceResult(nextResult);
      } catch {
        if (!isCurrent()) return;
        setLatestRaceResult(null);
      }
    };

    // setTimeout 체이닝으로 이전 poll이 끝난 뒤에만 다음 poll 예약 (in-flight 중복 방지)
    const schedule = () => {
      if (!active) return;
      timer = window.setTimeout(() => {
        void poll().finally(schedule);
      }, 3000);
    };

    void poll().finally(schedule);
    return () => {
      active = false;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [senderUrl]);

  const rawTrack = status?.currentTrack?.name ?? session?.trackName ?? null;
  const detectedTrack = resolveTrackName(rawTrack, SENDER_TRACK_MAP, TRACKS);

  return { connected, status, session, player, detectedTrack, latestRaceResult };
}

interface SenderUploadStatus {
  paired?: boolean;
  platformBaseUrl?: string;
}

export type PairingGate = "checking" | "paired" | "unpaired";

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

// 구버전 sender(/api/status에 paired 필드 없음) 대응 폴백 조회
async function fetchSenderUploadStatus(senderUrl: string): Promise<SenderUploadStatus | null> {
  try {
    const response = await fetch(`${normalizeSenderUrl(senderUrl)}/api/upload/status`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      return null;
    }
    const data = (await response.json().catch(() => null)) as SenderUploadStatus | null;
    return data;
  } catch {
    return null;
  }
}

export function usePairingGate(senderUrl: string, senderConnected: boolean, senderStatus: SenderStatus | null) {
  const [fallbackPaired, setFallbackPaired] = useState<boolean | null>(null);
  const [platformBaseUrl, setPlatformBaseUrl] = useState(DEFAULT_PLATFORM_BASE_URL);
  const [optimisticPaired, setOptimisticPaired] = useState(false);

  const authoritativePaired = senderStatus?.paired;
  const needsFallback = senderConnected && senderStatus !== null && authoritativePaired === undefined;

  // 연결이 끊기면 폴백 판정 상태를 초기화 (재연결 시 새로 판정)
  useEffect(() => {
    if (!senderConnected) {
      setFallbackPaired(null);
      setOptimisticPaired(false);
    }
  }, [senderConnected]);

  // 신버전 sender: paired boolean이 새 값으로 도착할 때마다 낙관적 상태를 authoritative 값으로 리셋
  useEffect(() => {
    if (senderStatus && senderStatus.paired !== undefined) {
      setOptimisticPaired(false);
    }
  }, [senderStatus]);

  // 구버전 sender 폴백: 연결 시 1회 + unpaired인 동안 3초 간격 재조회
  useEffect(() => {
    if (!needsFallback) {
      return;
    }
    let active = true;
    let timer: number | null = null;

    const poll = async () => {
      const data = await fetchSenderUploadStatus(senderUrl);
      if (!active) return;
      let stillUnpaired = true;
      if (data) {
        setFallbackPaired(data.paired === true);
        setOptimisticPaired(false);
        if (isHttpUrl(data.platformBaseUrl)) {
          setPlatformBaseUrl(data.platformBaseUrl);
        }
        stillUnpaired = data.paired !== true;
      }
      // paired 확정 시 재조회 중단 (조회 실패는 재시도)
      if (!active || !stillUnpaired) return;
      timer = window.setTimeout(() => {
        void poll();
      }, 3000);
    };

    void poll();
    return () => {
      active = false;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [needsFallback, senderUrl]);

  // 신버전 sender에서 unpaired가 확정된 경우: platformBaseUrl 확보를 위해 1회만 조회
  useEffect(() => {
    if (!(senderConnected && authoritativePaired === false)) {
      return;
    }
    let active = true;
    void (async () => {
      const data = await fetchSenderUploadStatus(senderUrl);
      if (!active || !data) return;
      if (isHttpUrl(data.platformBaseUrl)) {
        setPlatformBaseUrl(data.platformBaseUrl);
      }
    })();
    return () => {
      active = false;
    };
  }, [senderConnected, authoritativePaired, senderUrl]);

  let gate: PairingGate;
  if (!senderConnected) {
    gate = "checking";
  } else if (optimisticPaired) {
    gate = "paired";
  } else if (authoritativePaired === true) {
    gate = "paired";
  } else if (authoritativePaired === false) {
    gate = "unpaired";
  } else if (needsFallback) {
    gate = fallbackPaired === null ? "checking" : fallbackPaired ? "paired" : "unpaired";
  } else {
    gate = "checking";
  }

  const markJustPaired = () => setOptimisticPaired(true);

  return { gate, platformBaseUrl, markJustPaired };
}
