import { useEffect, useRef, useState } from 'react';
import type { TrySectorBaseline } from '../../components/qualifying/tryStatus';
import type { DriverInfo, SessionInfo } from '../../types/telemetry';

/**
 * 레거시 `components/qualifying/QualifyingDashboard.tsx`(byte-frozen, 48-114)의
 * `useSectorAccumulator`를 이식한 hook 파일(Phase3 Spec §3.2/§6). bestS1/S2는 라이브
 * sector1/2TimeMs의 최소(>0)이고, bestS3는 전용 필드가 없어 랩 롤오버(currentLapNum 증가) 시
 * lastLapTime - sector1TimeMs - sector2TimeMs로 역산한다.
 *   ⚠ 실측 캡처(test-sets/quali-full-session) 검증 결과: lastLapTime·currentLapNum 증가·섹터
 *   리셋은 "같은 패킷에서 원자적으로" 뒤집힌다(직전 틱 선반영이라는 옛 주석은 사실과 반대였다).
 *   따라서 완주 랩 총합은 롤오버 프레임의 d.lastLapTime이고, 그 랩의 S1/S2는 직전 스냅샷(snap)에
 *   남아 있다 → s3 = d.lastLapTime - snap.s1 - snap.s2. (과거 snap.lastLapTime 사용은 '직전 랩'
 *   총합이라 bestS3가 틀리거나 첫 완주 랩까지 비어 있었다 — history 20260720 참조.)
 * sessionKey(trackId|sessionType|epoch) 변경 시 리셋 — epoch는
 * raceMetaStore가 라이브 세션 리스타트(리더 랩 되감김) 시 증가시키는 값이다. 리플레이
 * 재생 중에는 ingest가 스킵되어 epoch가 갱신되지 않으므로, 리플레이 rewind는 아래
 * 효과에서 랩 번호 되감김을 직접 감지해 별도로 리셋한다.
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

export function useSectorAccumulator(drivers: DriverInfo[], session: SessionInfo | null, epoch: number) {
  const [accMap, setAccMap] = useState<Map<number, SectorAcc>>(() => new Map());
  const prevRef = useRef<Map<number, PrevSnap>>(new Map());
  const sessionKeyRef = useRef('');
  const maxLapRef = useRef(0);

  const sessionKey = `${session?.trackId ?? ''}|${session?.sessionType ?? ''}|${epoch}`;
  useEffect(() => {
    if (sessionKeyRef.current && sessionKeyRef.current !== sessionKey) {
      setAccMap(new Map());
      prevRef.current = new Map();
      maxLapRef.current = 0;
    }
    sessionKeyRef.current = sessionKey;
  }, [sessionKey]);

  useEffect(() => {
    if (drivers.length === 0) return;

    // 리플레이 rewind 감지: 재생 중에는 raceMetaStore가 ingest를 건너뛰어 epoch가 갱신되지
    // 않으므로(sessionKey 불변) 세션 리셋이 걸리지 않는다. 랩 번호 되감김을 직접 감지해
    // 이전 구간의 베스트 섹터가 잔류하지 않게 accMap/prevRef를 비운다.
    let maxLap = 0;
    for (const d of drivers) {
      const lap = d.currentLapNum ?? 0;
      if (lap > maxLap) maxLap = lap;
    }
    if (maxLap < maxLapRef.current) {
      setAccMap(new Map());
      prevRef.current = new Map();
    }
    maxLapRef.current = maxLap;

    // Capture previous snapshots BEFORE the state update — not inside the updater
    const capturedPrev = prevRef.current;

    let changed = false;
    setAccMap((prev) => {
      const next = new Map(prev);
      for (const d of drivers) {
        const snap = capturedPrev.get(d.index);
        let acc = next.get(d.index) ?? { bestS1: 0, bestS2: 0, bestS3: 0 };
        let accChanged = false;

        // sector1/2TimeMs는 Go DTO omitempty라 미완주 섹터는 undefined다 — 0으로 정규화(0=미완주, `> 0` 가드가 배제).
        const s1 = d.sector1TimeMs ?? 0;
        const s2 = d.sector2TimeMs ?? 0;
        if (s1 > 0 && (acc.bestS1 === 0 || s1 < acc.bestS1)) {
          acc = { ...acc, bestS1: s1 };
          accChanged = true;
        }
        if (s2 > 0 && (acc.bestS2 === 0 || s2 < acc.bestS2)) {
          acc = { ...acc, bestS2: s2 };
          accChanged = true;
        }
        // 원자적 롤오버: 완주 랩 총합은 롤오버 프레임 d.lastLapTime, 그 랩 섹터는 snap(직전 프레임).
        // 프레임 드랍(+N 점프)은 snap 섹터가 d.lastLapTime의 랩과 어긋나므로 +1 롤오버만 신뢰한다.
        if (snap && d.currentLapNum === snap.currentLapNum + 1 && d.lastLapTime > 0 && snap.sector1TimeMs > 0 && snap.sector2TimeMs > 0) {
          const s3 = d.lastLapTime - snap.sector1TimeMs - snap.sector2TimeMs;
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
        sector1TimeMs: d.sector1TimeMs ?? 0,
        sector2TimeMs: d.sector2TimeMs ?? 0,
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
