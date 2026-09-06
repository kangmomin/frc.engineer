import { useEffect, useRef, useState } from 'react';
import type { TrySectorBaseline } from '../../components/qualifying/tryStatus';
import type { DriverInfo, SessionInfo } from '../../types/telemetry';

import { createSectorAccumulator, type SectorAcc } from '../../components/qualifying/sectorAccumulator';
export { createSectorAccumulator, type SectorAcc } from '../../components/qualifying/sectorAccumulator';

const EMPTY_SECTORS = new Map<number, SectorAcc>();

export function useSectorAccumulator(drivers: DriverInfo[], session: SessionInfo | null, epoch: number | string, enabled = true) {
  const accumulator = useRef<ReturnType<typeof createSectorAccumulator> | null>(null);
  if (!accumulator.current) accumulator.current = createSectorAccumulator();
  const sessionKey = `${session?.sessionUid ?? ''}|${session?.trackId ?? ''}|${session?.sessionType ?? ''}|${epoch}`;
  const [state, setState] = useState(() => ({ key: '', sectors: EMPTY_SECTORS }));
  useEffect(() => {
    if (!enabled) return;
    const sectors = accumulator.current!.ingest(drivers, sessionKey);
    setState((previous) => previous.key === sessionKey && previous.sectors === sectors ? previous : { key: sessionKey, sectors });
  }, [drivers, sessionKey, enabled]);
  return state.key === sessionKey ? state.sectors : EMPTY_SECTORS;
}

/** 레거시 `buildTryBaseline`(160-166) 이식. 드라이버 자체 bestSectorNMs가 있으면 우선하고,
 * 없으면(대부분의 실전 피드) 위 누적기 결과로 폴백한다. */
export function buildTryBaseline(driver: DriverInfo, acc?: SectorAcc): TrySectorBaseline {
  return {
    s1: driver.bestSector1Ms ?? acc?.bestS1 ?? 0,
    s2: driver.bestSector2Ms ?? acc?.bestS2 ?? 0,
    s3: driver.bestSector3Ms ?? acc?.bestS3 ?? 0,
  };
}

/** 레거시 `overallBestSectors`(204-212) 이식 — accMap 전체에서 섹터별 최소값(퍼플 하이라이트 기준). */
export function computeOverallBestSectors(accMap: Map<number, SectorAcc>): SectorAcc {
  let s1 = 0;
  let s2 = 0;
  let s3 = 0;
  for (const acc of accMap.values()) {
    if (acc.bestS1 > 0 && (s1 === 0 || acc.bestS1 < s1)) s1 = acc.bestS1;
    if (acc.bestS2 > 0 && (s2 === 0 || acc.bestS2 < s2)) s2 = acc.bestS2;
    if (acc.bestS3 > 0 && (s3 === 0 || acc.bestS3 < s3)) s3 = acc.bestS3;
  }
  return { bestS1: s1, bestS2: s2, bestS3: s3 };
}

/** 레거시 `formatSectorTime`(118-121) 이식. 결측 placeholder는 Spec §9(0.000 금지 · '—' 정규화)에
 * 맞춰 legacy의 '--'에서 '—'로 조정한다(Phase2 `derive/myCar.ts`와 동일한 조정 선례). */
export function formatSectorTime(ms: number): string {
  if (ms <= 0) return '—';
  return (ms / 1000).toFixed(3);
}
