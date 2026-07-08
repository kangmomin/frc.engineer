// TrackStrip의 좌표·배치 계산 (렌더 없는 순수 함수 — TrackStrip.test.ts가 고정).

export interface TrackStripCorner {
  /** 공식 코너 번호 — "T{number}" 라벨로 표시. */
  number: number;
  /** 코너(apex)의 lapDistance (m). */
  distance: number;
}

export interface CornerMark {
  corner: TrackStripCorner;
  pct: number;
  raised: boolean;
}

/** 인접 코너 라벨 겹침 회피 임계(%p) — 같은 층에서 이보다 가까우면 다른 층으로 보낸다 (라벨 폭 근사). */
const RAISE_THRESHOLD_PCT = 2.5;

/** lapDistance → 0..100(%). 음수/트랙 길이 초과 값은 한 랩 기준으로 래핑하고, 비유한 입력은 0으로 강등한다. */
export function wrapPct(distance: number, trackLength: number): number {
  if (!Number.isFinite(distance) || !Number.isFinite(trackLength) || trackLength <= 0) return 0;
  return ((((distance % trackLength) + trackLength) % trackLength) / trackLength) * 100;
}

/** 래핑 없이 0..100%로 클램프 — 섹터 경계용 (마지막 경계 = trackLength = 100%). */
export function clampPct(distance: number, trackLength: number): number {
  if (!Number.isFinite(distance) || !Number.isFinite(trackLength) || trackLength <= 0) return 0;
  return Math.max(0, Math.min(100, (distance / trackLength) * 100));
}

/** 섹터 경계 [0, S1끝, S2끝, 길이]를 단조 비감소로 강제 — 역전·비유한 split이 섹터를 겹쳐 그리지 않게. */
export function monotonicBounds(
  sectorSplits: [number, number],
  trackLength: number,
): [number, number, number, number] {
  const raw: [number, number, number, number] = [0, sectorSplits[0], sectorSplits[1], trackLength];
  const bounds: [number, number, number, number] = [0, 0, 0, 0];
  for (let i = 1; i < 4; i++) {
    const v = raw[i];
    bounds[i] = Number.isFinite(v) ? Math.max(bounds[i - 1], v) : bounds[i - 1];
  }
  return bounds;
}

/**
 * 코너를 트랙 위치(%) 기준으로 정렬하고, 층(base/raised)별 마지막 라벨과 비교해
 * 겹치지 않는 층에 배치한다 — 시케인·3연속 복합 코너의 라벨 겹침 대응.
 * (정렬을 래핑된 pct로 하는 이유: 범위 밖 distance가 정렬 순서와 표시 위치를 어긋나게 하지 않도록.)
 */
export function buildCornerMarks(corners: TrackStripCorner[], trackLength: number): CornerMark[] {
  const marks: CornerMark[] = corners
    .map((corner) => ({ corner, pct: wrapPct(corner.distance, trackLength), raised: false }))
    .sort((a, b) => a.pct - b.pct);
  let lastBase = -Infinity;
  let lastRaised = -Infinity;
  for (const mark of marks) {
    const fitsBase = mark.pct - lastBase >= RAISE_THRESHOLD_PCT;
    const fitsRaised = mark.pct - lastRaised >= RAISE_THRESHOLD_PCT;
    // 아래층 우선, 안 맞으면 위층, 둘 다 겹치면 마지막 라벨이 더 먼 층으로.
    mark.raised = fitsBase ? false : fitsRaised ? true : lastRaised < lastBase;
    if (mark.raised) lastRaised = mark.pct;
    else lastBase = mark.pct;
  }
  return marks;
}
