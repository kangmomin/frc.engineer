import { useEffect, useRef, useState } from 'react';
import type { DriverInfo, SessionInfo } from '../../types/telemetry';

/**
 * My Lap 섹터 슬롯(S1/S2/S3)의 "표시 유지" 상태. 라이브 와이어 필드는 새 랩이 시작되면
 * (currentSector=0, sectorNTimeMs 리셋) 곧바로 비워지므로, 순수 유도만으로는 완료된 섹터가
 * 즉시 대시로 사라진다. 이 hook은 마지막으로 완주한 섹터 기록을 붙들어 **다음 랩 S1이
 * 완주되기 전까지** 트리오를 유지한다(사용자 요구).
 *
 * S3는 전용 라이브 필드가 없어, 랩 롤오버(currentLapNum 증가) 직전 스냅샷의
 * lastLapTime - s1 - s2로 역산한다 — useSectorAccumulator가 bestS3에 이미 채택·배포한
 * 동일 기법이다(신규 fabrication이 아니라 완료된 실측 섹터의 재사용). 현재 진행 중 랩의
 * 미완 S3를 지어내지 않고, 직전 '완료 랩'의 S3만 보여준다.
 */
export interface SectorDisplay {
  s1: number;
  s2: number;
  s3: number;
}

export const EMPTY_DISPLAY: SectorDisplay = { s1: 0, s2: 0, s3: 0 };

interface HeldState extends SectorDisplay {
  /** 현재 표시 중인 S1이 속한 랩 번호. 새 랩 S1이 완주되면(cur.lap !== s1Lap) 트리오를 리셋한다. */
  s1Lap: number;
}

interface FrameSnap {
  lap: number;
  lastLapTime: number;
  s1: number;
  s2: number;
}

const INIT: HeldState = { s1: 0, s2: 0, s3: 0, s1Lap: -1 };

/**
 * 표시 상태 전이(순수). 직전 프레임 스냅샷 `prev`와 현재 프레임 `cur`로 다음 표시 트리오를 만든다.
 * 변화가 없으면 입력 `held`를 그대로 반환한다(참조 동일 → 렌더 dedup).
 */
export function advanceSectorDisplay(held: HeldState, prev: FrameSnap | null, cur: FrameSnap): HeldState {
  let next = held;

  // 1) 랩 롤오버 → 직전 랩 S3 역산 + 완료 트리오 확정. 세 필드는 롤오버 직전 틱에 이미 '같은 랩'
  //    값으로 갱신돼 있다(useSectorAccumulator 선례의 텔레메트리 갱신 타이밍 가정).
  if (prev && cur.lap > prev.lap && prev.lastLapTime > 0 && prev.s1 > 0 && prev.s2 > 0) {
    const s3 = prev.lastLapTime - prev.s1 - prev.s2;
    if (s3 > 0) next = { s1: prev.s1, s2: prev.s2, s3, s1Lap: prev.lap };
  }

  // 2) 새 랩 S1 완주 → 트리오 리셋(S1=신규, S2/S3 비움). "다음 S1 전까지 유지"의 종료 지점.
  if (cur.s1 > 0 && cur.lap !== next.s1Lap) {
    next = { s1: cur.s1, s2: 0, s3: 0, s1Lap: cur.lap };
  }

  // 3) 같은 랩 S2 완주 → S2 갱신.
  if (cur.s2 > 0 && cur.lap === next.s1Lap && cur.s2 !== next.s2) {
    next = { ...next, s2: cur.s2 };
  }

  return next;
}

/**
 * 플레이어의 섹터 표시 트리오를 프레임 간 유지한다. 세션 전환(trackId|sessionType|epoch) 또는
 * 리플레이 rewind(랩 되감김) 시 리셋 — useSectorAccumulator의 리셋 규약과 동일하다.
 */
export function usePlayerSectorDisplay(
  player: DriverInfo | null,
  session: SessionInfo | null,
  epoch: number,
): SectorDisplay {
  const [disp, setDisp] = useState<SectorDisplay>(EMPTY_DISPLAY);
  const heldRef = useRef<HeldState>(INIT);
  const prevRef = useRef<FrameSnap | null>(null);
  const sessionKeyRef = useRef('');
  const maxLapRef = useRef(0);

  const sessionKey = `${session?.trackId ?? ''}|${session?.sessionType ?? ''}|${epoch}`;
  useEffect(() => {
    if (sessionKeyRef.current && sessionKeyRef.current !== sessionKey) {
      heldRef.current = INIT;
      prevRef.current = null;
      maxLapRef.current = 0;
      setDisp(EMPTY_DISPLAY);
    }
    sessionKeyRef.current = sessionKey;
  }, [sessionKey]);

  useEffect(() => {
    if (!player) return;
    const lap = player.currentLapNum ?? 0;

    // 리플레이 rewind 감지: 랩 번호 되감김 시 직전 구간 섹터가 잔류하지 않게 비운다.
    if (lap < maxLapRef.current) {
      heldRef.current = INIT;
      prevRef.current = null;
    }
    maxLapRef.current = Math.max(maxLapRef.current, lap);

    const cur: FrameSnap = {
      lap,
      lastLapTime: player.lastLapTime,
      s1: player.sector1TimeMs ?? 0,
      s2: player.sector2TimeMs ?? 0,
    };
    const nextHeld = advanceSectorDisplay(heldRef.current, prevRef.current, cur);
    heldRef.current = nextHeld;
    prevRef.current = cur;
    setDisp((d) => (d.s1 === nextHeld.s1 && d.s2 === nextHeld.s2 && d.s3 === nextHeld.s3 ? d : { s1: nextHeld.s1, s2: nextHeld.s2, s3: nextHeld.s3 }));
  }, [player]);

  return disp;
}
