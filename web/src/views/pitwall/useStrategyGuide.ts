import { useEffect, useState } from 'react';
import { useTelemetryStore } from '../../store/telemetryStore';
import type { SessionInfo, StrategyGuideResponse, WSRequest } from '../../types/telemetry';

export type StrategyGuideStatus = 'idle' | 'loading' | 'ready' | 'unavailable';

export interface StrategyGuideState {
  status: StrategyGuideStatus;
  data: StrategyGuideResponse | null;
}

/** AppShell의 useWebRTCDataChannel().request와 동일한 시그니처. */
export type RequestFn = <T = unknown>(
  request: WSRequest,
  options?: { signal?: AbortSignal; timeoutMs?: number },
) => Promise<T>;

const STRATEGY_GUIDE_TIMEOUT_MS = 15_000;

/**
 * legacy CockpitDashboard.tsx의 loadStrategyGuide(636-705) 이식 — REST 폴백은 제외한다
 * (신규 shell은 P2P RPC만 사용). 구 "Team Radio"(synthetic) 자리를 대체하는 실데이터 RPC.
 * trackId<0(트랙 미확정)이면 idle, 요청 중 loading, 성공 시 ready, 실패/타임아웃/mock
 * 미응답은 모두 동일하게 unavailable로 graceful degrade한다(Spec §4.4).
 *
 * connectionState를 effect deps에 포함한다(FIX-2) — 트랙이 바뀌지 않아도 연결이 끊겼다
 * 살아나면(reconnecting→connected) 재조회하도록 해, 일시 단절 중 실패한 요청 때문에
 * 'unavailable'에 영구 고착되는 문제를 해소한다.
 */
export function useStrategyGuide(
  request: RequestFn,
  session: SessionInfo | null,
  gameFormat: number | undefined,
): StrategyGuideState {
  const [state, setState] = useState<StrategyGuideState>({ status: 'idle', data: null });
  const trackId = session?.trackId ?? -1;
  const trackName = session?.trackName ?? '';
  const connectionState = useTelemetryStore((s) => s.connectionState);

  useEffect(() => {
    if (trackId < 0) {
      setState({ status: 'idle', data: null });
      return;
    }

    const controller = new AbortController();
    setState({ status: 'loading', data: null });

    request<StrategyGuideResponse>(
      { type: 'getStrategyGuide', data: { trackId, trackName, gameFormat } },
      { signal: controller.signal, timeoutMs: STRATEGY_GUIDE_TIMEOUT_MS },
    )
      .then((data) => {
        if (!controller.signal.aborted) setState({ status: 'ready', data });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: 'unavailable', data: null });
      });

    return () => controller.abort();
  }, [request, trackId, trackName, gameFormat, connectionState]);

  return state;
}
