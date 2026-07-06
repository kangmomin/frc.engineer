import { useEffect, useRef, useState } from 'react';
import type { TrySectorBaseline } from '../../components/qualifying/tryStatus';
import type { DriverInfo, SessionInfo } from '../../types/telemetry';

/**
 * 레거시 `components/qualifying/QualifyingDashboard.tsx`(byte-frozen, 48-114)의
 * `useSectorAccumulator`를 그대로 이식한 신규 hook 파일(Phase3 Spec §3.2/§6). 로직은 원본과
 * 동일하다 — bestS1/S2는 라이브 sector1/2TimeMs의 최소(>0)이고, bestS3는 전용 필드가 없어
 * 랩 롤오버(currentLapNum 증가) 시 "직전 스냅샷"의 lastLapTime - sector1TimeMs - sector2TimeMs로
 * 역산한다. 이 세 필드는 롤오버 직전 틱에 이미 "같은 랩" 값으로 갱신되어 있다(실 텔레메트리
 * 필드 갱신 타이밍) — Pit Wall(Phase 2)이 포기하고 '—'로 degrade했던 정확한 S3를 Qualifying은
 * 이 역산으로 얻는다. sessionKey(trackId|sessionType) 변경 시 리셋.
 */

export interface SectorAcc {
  bestS1: number;
  bestS2: number;
  bestS3: number;
}

interface PrevSnap {
  currentLapNum: number;
  lastLapTime: number;
  sector1TimeMs: number;
  sector2TimeMs: number;
}

export function useSectorAccumulator(drivers: DriverInfo[], session: SessionInfo | null) {
  const [accMap, setAccMap] = useState<Map<number, SectorAcc>>(() => new Map());
  const prevRef = useRef<Map<number, PrevSnap>>(new Map());
  const sessionKeyRef = useRef('');

  const sessionKey = `${session?.trackId ?? ''}|${session?.sessionType ?? ''}`;
  useEffect(() => {
    if (sessionKeyRef.current && sessionKeyRef.current !== sessionKey) {
      setAccMap(new Map());
      prevRef.current = new Map();
    }
    sessionKeyRef.current = sessionKey;
  }, [sessionKey]);

  useEffect(() => {
    if (drivers.length === 0) return;

    // Capture previous snapshots BEFORE the state update — not inside the updater
    const capturedPrev = prevRef.current;

    let changed = false;
    setAccMap((prev) => {
      const next = new Map(prev);
      for (const d of drivers) {
        const snap = capturedPrev.get(d.index);
        let acc = next.get(d.index) ?? { bestS1: 0, bestS2: 0, bestS3: 0 };
        let accChanged = false;

        if (d.sector1TimeMs > 0 && (acc.bestS1 === 0 || d.sector1TimeMs < acc.bestS1)) {
          acc = { ...acc, bestS1: d.sector1TimeMs };
          accChanged = true;
        }
        if (d.sector2TimeMs > 0 && (acc.bestS2 === 0 || d.sector2TimeMs < acc.bestS2)) {
          acc = { ...acc, bestS2: d.sector2TimeMs };
          accChanged = true;
        }
        if (snap && d.currentLapNum > snap.currentLapNum && snap.lastLapTime > 0 && snap.sector1TimeMs > 0 && snap.sector2TimeMs > 0) {
          const s3 = snap.lastLapTime - snap.sector1TimeMs - snap.sector2TimeMs;
          if (s3 > 0 && (acc.bestS3 === 0 || s3 < acc.bestS3)) {
            acc = { ...acc, bestS3: s3 };
            accChanged = true;
          }
        }

        if (accChanged || !next.has(d.index)) {
          next.set(d.index, acc);
          changed = true;
        }
      }
      return changed ? next : prev;
    });

    // Advance ref AFTER state update, outside the updater
    const nextPrev = new Map<number, PrevSnap>();
    for (const d of drivers) {
      nextPrev.set(d.index, {
        currentLapNum: d.currentLapNum,
        lastLapTime: d.lastLapTime,
        sector1TimeMs: d.sector1TimeMs,
        sector2TimeMs: d.sector2TimeMs,
      });
    }
    prevRef.current = nextPrev;
  }, [drivers]);

  return accMap;
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
