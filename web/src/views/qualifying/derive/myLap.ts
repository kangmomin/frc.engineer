import { getQualifyingBestLapTime } from '../../../components/qualifying/leaderboardOrder';
import type { DriverTryState } from '../../../components/qualifying/tryStatus';
import type { QualifyingPhase, QualifyingState } from '../../../hooks/useQualifyingState';
import type { TrackGap } from '../../../hooks/useTrackGaps';
import { nextCornerNumber } from '../../../constants/trackCorners';
import type { DriverInfo, SessionInfo } from '../../../types/telemetry';
import { formatLapTime } from '../../../utils/formatters';
import { formatSectorTime, type SectorAcc } from '../useSectorAccumulator';
import { EMPTY_DISPLAY, type SectorDisplay } from '../useSectorDisplay';
import { deriveThreatCars, type ThreatCar } from './threatWatch';

const DASH = '—';

const PHASE_COLOR: Record<QualifyingPhase, string> = {
  FLYING: 'var(--accent-lime)',
  OUT: 'var(--accent)',
  COOLDOWN: 'var(--text-secondary)',
  GARAGE: 'var(--text-muted)',
  PIT: 'var(--accent-soft)',
  UNKNOWN: 'var(--text-muted)',
};

/** 레거시 `formatDistance`(130-134) 이식(placeholder만 '--'→'—'로 조정, Spec §9). */
function formatDistance(meters: number | null): string {
  if (meters == null) return DASH;
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)}km`;
  return `${Math.round(meters)}m`;
}

/** 레거시 `getGapTone`(136-141) 이식 — CSS 모듈 클래스 대신 색 토큰을 직접 반환. */
function gapTone(meters: number | null): string {
  if (meters == null) return 'var(--text-muted)';
  if (meters < 150) return 'var(--accent-lime)';
  if (meters < 400) return 'var(--accent)';
  return 'var(--text-secondary)';
}

function sectorTone(value: number, bestValue: number | undefined): string {
  if (!bestValue || bestValue <= 0) return 'var(--text-secondary)';
  if (value <= bestValue) return 'var(--sector-purple)';
  return value - bestValue <= 120 ? 'var(--accent-lime)' : 'var(--accent-soft)';
}

export interface MyLapVM {
  hasPlayer: boolean;
  phaseLabel: QualifyingPhase | '—';
  phaseColor: string;
  attemptNumber: number;
  consecutivePushLaps: number;
  bestText: string;
  /** 실 Best 대비 라이브 부분 델타(완료 섹터 델타 합) — 예측 랩이 아니다(Spec §9). */
  deltaText: string;
  deltaColor: string;
  progressPct: number;
  /** 진행바 옆 다음 코너('→ T5'). null = 코너 데이터 없는 트랙 — 미표시(fabrication 금지). */
  nextCornerText: string | null;
  s1Text: string;
  s1Color: string;
  s2Text: string;
  s2Color: string;
  /** S3는 전용 라이브 필드가 없어 usePlayerSectorDisplay가 랩 롤오버 역산으로 채운 직전 완료 랩
   * 값을 표시한다(현재 랩 미완 S3는 지어내지 않음). 값 없으면 대시. */
  s3Text: string;
  s3Color: string;
  /** 'track' = 물리적 앞뒤차(기존). 'threat' = 플레이어가 트랙 밖이라 슬롯이 위협 랭킹
   * 상위 2대로 대체된 상태(threatWatch.ts) — 갭 값은 거리(m)가 아니라 베스트랩 델타(s). */
  aroundMode: 'track' | 'threat';
  aheadCode: string;
  /** threat 모드 전용 순위 표기(`P16`). track 모드는 빈 문자열. */
  aheadPos: string;
  aheadGapText: string;
  aheadGapColor: string;
  aheadSummary: string;
  behindCode: string;
  behindPos: string;
  behindGapText: string;
  behindGapColor: string;
  behindSummary: string;
}

const EMPTY_VM: MyLapVM = {
  hasPlayer: false,
  phaseLabel: '—',
  phaseColor: 'var(--text-muted)',
  attemptNumber: 0,
  consecutivePushLaps: 0,
  bestText: DASH,
  deltaText: DASH,
  deltaColor: 'var(--text-muted)',
  progressPct: 0,
  nextCornerText: null,
  s1Text: DASH,
  s1Color: 'var(--text-muted)',
  s2Text: DASH,
  s2Color: 'var(--text-muted)',
  s3Text: DASH,
  s3Color: 'var(--text-muted)',
  aroundMode: 'track',
  aheadCode: DASH,
  aheadPos: '',
  aheadGapText: DASH,
  aheadGapColor: 'var(--text-muted)',
  aheadSummary: 'No car ahead',
  behindCode: DASH,
  behindPos: '',
  behindGapText: DASH,
  behindGapColor: 'var(--text-muted)',
  behindSummary: 'No car behind',
};

/** threat 갭(베스트랩 델타 ms) 포맷/색 — 거리 기반 `gapTone`은 의미가 달라 재사용 금지.
 * null/0 → '—'/muted (0은 동률 — Go 오버레이의 0 델타 처리와 동일하게 중립 표기해
 * "-0.000" 오표기를 막는다), <0 → 이미 나보다 빠름(red), ≤300ms → 임박(accent). */
function formatThreatDelta(deltaMs: number | null): string {
  if (deltaMs == null || deltaMs === 0) return DASH;
  return `${deltaMs < 0 ? '-' : '+'}${(Math.abs(deltaMs) / 1000).toFixed(3)}`;
}

function threatDeltaTone(deltaMs: number | null): string {
  if (deltaMs == null || deltaMs === 0) return 'var(--text-muted)';
  if (deltaMs < 0) return 'var(--accent-red)';
  if (deltaMs <= 300) return 'var(--accent)';
  return 'var(--text-secondary)';
}

/**
 * My Lap 패널 VM(Phase3 Spec §4.1). [Assumption] Spec 시그니처는 `(player, playerAcc, tryState,
 * trackGap, session)`이지만, §4.1의 ahead/behind "tryState summary" 표기(레거시 gapMeta 계승)를
 * 만족하려면 ahead/behind 드라이버의 try state도 조회해야 한다 — 컨테이너가 Classification과
 * 공유하는 `tryMap`/`codes`를 그대로 전달하도록 시그니처를 확장했다(단일 tryState 대신 tryMap +
 * codes). trackLength는 별도 인자 대신 `session.trackLength`에서 얻는다(Spec 표기와 동일 데이터).
 */
export function deriveMyLap(
  player: DriverInfo | null,
  sorted: DriverInfo[],
  playerAcc: SectorAcc | undefined,
  tryMap: Map<number, DriverTryState>,
  trackGap: TrackGap,
  session: SessionInfo | null,
  codes: Map<number, string>,
  qualiState: QualifyingState,
  sectors: SectorDisplay = EMPTY_DISPLAY,
): MyLapVM {
  if (!player) return EMPTY_VM;

  const best = getQualifyingBestLapTime(player);
  const tryState = tryMap.get(player.index) ?? null;
  const s1Delta = tryState?.sectorDelta1Ms ?? null;
  const s2Delta = tryState?.sectorDelta2Ms ?? null;
  const liveDeltaMs = s1Delta != null || s2Delta != null ? (s1Delta ?? 0) + (s2Delta ?? 0) : null;
  const deltaText = liveDeltaMs == null ? DASH : `${liveDeltaMs <= 0 ? '-' : '+'}${(Math.abs(liveDeltaMs) / 1000).toFixed(3)}`;
  const deltaColor = liveDeltaMs == null ? 'var(--text-muted)' : liveDeltaMs <= 0 ? 'var(--delta-faster)' : 'var(--delta-slower)';

  const trackLength = session?.trackLength ?? 0;
  const progressPct = trackLength > 0 ? Math.min(100, Math.max(0, (player.lapDistance / trackLength) * 100)) : 0;
  const nextCorner = nextCornerNumber(session?.trackId, player.lapDistance, trackLength);

  // 섹터 표시는 usePlayerSectorDisplay가 유지하는 '완료 트리오'를 쓴다 — 라이브 와이어 값은
  // 새 랩 시작 즉시 비워져 너무 빨리 사라지므로, 다음 랩 S1이 완주되기 전까진 직전 완료 섹터를
  // 유지한다(S3는 롤오버 역산치). 값 0은 미표시(대시), anti-fabrication 유지.

  // 플레이어가 트랙 밖(개러지/핏)이면 앞뒤차 대신 threat watch로 폴백한다 — 퀄리 막판
  // 개러지 대기 중 "누가 어택 중인지"가 통째로 사라지던 공백(useTrackGaps EMPTY_GAP) 대체.
  // 후보 0대면 기존 track 표시(대시)로 degrade — 백엔드 빈 표시와 대칭.
  const playerOffTrack = player.pitStatus !== 0 || player.lapDistance < 0;
  const threats = playerOffTrack ? deriveThreatCars(sorted, player, tryMap) : [];

  const ahead = trackGap.aheadDriver;
  const behind = trackGap.behindDriver;
  const aheadTry = ahead ? tryMap.get(ahead.index) ?? null : null;
  const behindTry = behind ? tryMap.get(behind.index) ?? null : null;

  const threatSlot = (threat: ThreatCar | undefined, emptySummary: string) =>
    threat
      ? {
          code: codes.get(threat.driver.index) ?? DASH,
          pos: `P${threat.driver.position}`,
          gapText: formatThreatDelta(threat.deltaMs),
          gapColor: threatDeltaTone(threat.deltaMs),
          summary: threat.tryState?.summary ?? '',
        }
      : { code: DASH, pos: '', gapText: DASH, gapColor: 'var(--text-muted)', summary: emptySummary };

  const around =
    threats.length > 0
      ? {
          aroundMode: 'threat' as const,
          aheadSlot: threatSlot(threats[0], ''),
          behindSlot: threatSlot(threats[1], 'No other car on track'),
        }
      : {
          aroundMode: 'track' as const,
          aheadSlot: {
            code: ahead ? codes.get(ahead.index) ?? DASH : DASH,
            pos: '',
            gapText: formatDistance(trackGap.gapAheadM),
            gapColor: gapTone(trackGap.gapAheadM),
            summary: ahead ? aheadTry?.summary ?? '' : 'No car ahead',
          },
          behindSlot: {
            code: behind ? codes.get(behind.index) ?? DASH : DASH,
            pos: '',
            gapText: formatDistance(trackGap.gapBehindM),
            gapColor: gapTone(trackGap.gapBehindM),
            summary: behind ? behindTry?.summary ?? '' : 'No car behind',
          },
        };

  return {
    hasPlayer: true,
    phaseLabel: qualiState.phase,
    phaseColor: PHASE_COLOR[qualiState.phase],
    attemptNumber: qualiState.attemptNumber,
    consecutivePushLaps: qualiState.consecutivePushLaps,
    bestText: formatLapTime(best),
    deltaText,
    deltaColor,
    progressPct,
    nextCornerText: nextCorner != null ? `→ T${nextCorner}` : null,
    s1Text: sectors.s1 > 0 ? formatSectorTime(sectors.s1) : DASH,
    s1Color: sectors.s1 > 0 ? sectorTone(sectors.s1, playerAcc?.bestS1) : 'var(--text-muted)',
    s2Text: sectors.s2 > 0 ? formatSectorTime(sectors.s2) : DASH,
    s2Color: sectors.s2 > 0 ? sectorTone(sectors.s2, playerAcc?.bestS2) : 'var(--text-muted)',
    s3Text: sectors.s3 > 0 ? formatSectorTime(sectors.s3) : DASH,
    s3Color: sectors.s3 > 0 ? sectorTone(sectors.s3, playerAcc?.bestS3) : 'var(--text-muted)',
    aroundMode: around.aroundMode,
    aheadCode: around.aheadSlot.code,
    aheadPos: around.aheadSlot.pos,
    aheadGapText: around.aheadSlot.gapText,
    aheadGapColor: around.aheadSlot.gapColor,
    aheadSummary: around.aheadSlot.summary,
    behindCode: around.behindSlot.code,
    behindPos: around.behindSlot.pos,
    behindGapText: around.behindSlot.gapText,
    behindGapColor: around.behindSlot.gapColor,
    behindSummary: around.behindSlot.summary,
  };
}
