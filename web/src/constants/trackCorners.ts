// 실측 코너 데이터(trackCorners.data.ts) 조회 헬퍼 — 게임 UDP에는 코너 정보가
// 없으므로 MultiViewer 실측 데이터를 랩 비율로 매칭한다. 데이터가 없는 트랙
// (리버스 39-41, Madring 42)에서는 모든 함수가 null을 반환해 UI가 기존 렌더를
// 유지한다 (fabrication 금지).

import { wrapPct } from '../ui/TrackStrip.derive';
import { TRACK_CORNER_PCTS } from './trackCorners.data';

/** ui TrackStripCorner({number, distance})와 구조 호환 — ui import 없이 사용 가능. */
export interface CornerPoint {
  number: number;
  distance: number;
}

/** trackId + trackLength(m) → apex lapDistance(m) 목록. 데이터 없음/비유한 길이 → null. */
export function cornersFor(trackId: number | undefined, trackLength: number | undefined): CornerPoint[] | null {
  if (trackId === undefined || trackLength === undefined) return null;
  if (!Number.isFinite(trackLength) || trackLength <= 0) return null;
  const pcts = TRACK_CORNER_PCTS[trackId];
  if (!pcts) return null;
  return pcts.map((c) => ({ number: c.n, distance: c.pct * trackLength }));
}

/**
 * 현재 위치 기준 다음 코너 번호. apex에 정확히 도달한 순간 통과로 간주해 라벨이
 * 전진하며, 마지막 apex 이후에는 첫 코너로 랩어라운드한다. 음수 lapDistance
 * (라인 통과 전)·랩 초과 값은 wrapPct가 한 랩 기준으로 래핑한다.
 * 데이터 없는 trackId / 비유한 입력 → null.
 */
export function nextCornerNumber(
  trackId: number | undefined,
  lapDistance: number | undefined,
  trackLength: number | undefined,
): number | null {
  if (trackId === undefined || lapDistance === undefined || trackLength === undefined) return null;
  if (!Number.isFinite(lapDistance) || !Number.isFinite(trackLength) || trackLength <= 0) return null;
  const pcts = TRACK_CORNER_PCTS[trackId];
  if (!pcts) return null;
  const frac = wrapPct(lapDistance, trackLength) / 100;
  const next = pcts.find((c) => c.pct > frac) ?? pcts[0];
  return next.n;
}
