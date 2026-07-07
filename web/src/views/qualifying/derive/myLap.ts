import { getQualifyingBestLapTime } from '../../../components/qualifying/leaderboardOrder';
import type { DriverTryState } from '../../../components/qualifying/tryStatus';
import type { QualifyingPhase, QualifyingState } from '../../../hooks/useQualifyingState';
import type { TrackGap } from '../../../hooks/useTrackGaps';
import type { DriverInfo, SessionInfo } from '../../../types/telemetry';
import { formatLapTime } from '../../../utils/formatters';
import { formatSectorTime, type SectorAcc } from '../useSectorAccumulator';

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
  s1Text: string;
  s1Color: string;
  s2Text: string;
  s2Color: string;
  /** S3는 라이브 값이 없다(전용 필드 없음) — 진행 중(●●●) 또는 대시만 표기, 역산 금지. */
  s3Text: string;
  aheadCode: string;
  aheadGapText: string;
  aheadGapColor: string;
  aheadSummary: string;
  behindCode: string;
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
  s1Text: DASH,
  s1Color: 'var(--text-muted)',
  s2Text: DASH,
  s2Color: 'var(--text-muted)',
  s3Text: DASH,
  aheadCode: DASH,
  aheadGapText: DASH,
  aheadGapColor: 'var(--text-muted)',
  aheadSummary: 'No car ahead',
  behindCode: DASH,
  behindGapText: DASH,
  behindGapColor: 'var(--text-muted)',
  behindSummary: 'No car behind',
};

/**
 * My Lap 패널 VM(Phase3 Spec §4.1). [Assumption] Spec 시그니처는 `(player, playerAcc, tryState,
 * trackGap, session)`이지만, §4.1의 ahead/behind "tryState summary" 표기(레거시 gapMeta 계승)를
 * 만족하려면 ahead/behind 드라이버의 try state도 조회해야 한다 — 컨테이너가 Classification과
 * 공유하는 `tryMap`/`codes`를 그대로 전달하도록 시그니처를 확장했다(단일 tryState 대신 tryMap +
 * codes). trackLength는 별도 인자 대신 `session.trackLength`에서 얻는다(Spec 표기와 동일 데이터).
 */
export function deriveMyLap(
  player: DriverInfo | null,
  playerAcc: SectorAcc | undefined,
  tryMap: Map<number, DriverTryState>,
  trackGap: TrackGap,
  session: SessionInfo | null,
  codes: Map<number, string>,
  qualiState: QualifyingState,
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

  // currentSector는 0-based 와이어 값(Phase2 FIX-1 교훈 계승) — S1 완료(S2 진입)는 >=1, S2
  // 완료(S3 진입)는 >=2. S3는 라이브 필드가 없어 진행 중 표시(●●●)만 하고 역산하지 않는다.
  // sector1/2TimeMs는 Go DTO omitempty라 미완주 섹터는 undefined다 — 0으로 정규화(0=미완주).
  const s1Ms = player.sector1TimeMs ?? 0;
  const s2Ms = player.sector2TimeMs ?? 0;
  const s1Live = player.currentSector >= 1 && s1Ms > 0;
  const s2Live = player.currentSector >= 2 && s2Ms > 0;

  const ahead = trackGap.aheadDriver;
  const behind = trackGap.behindDriver;
  const aheadTry = ahead ? tryMap.get(ahead.index) ?? null : null;
  const behindTry = behind ? tryMap.get(behind.index) ?? null : null;

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
    s1Text: s1Live ? formatSectorTime(s1Ms) : DASH,
    s1Color: s1Live ? sectorTone(s1Ms, playerAcc?.bestS1) : 'var(--text-muted)',
    s2Text: s2Live ? formatSectorTime(s2Ms) : DASH,
    s2Color: s2Live ? sectorTone(s2Ms, playerAcc?.bestS2) : 'var(--text-muted)',
    s3Text: player.currentSector === 2 ? '•••' : DASH,
    aheadCode: ahead ? codes.get(ahead.index) ?? DASH : DASH,
    aheadGapText: formatDistance(trackGap.gapAheadM),
    aheadGapColor: gapTone(trackGap.gapAheadM),
    aheadSummary: ahead ? (aheadTry?.summary ?? '') : 'No car ahead',
    behindCode: behind ? codes.get(behind.index) ?? DASH : DASH,
    behindGapText: formatDistance(trackGap.gapBehindM),
    behindGapColor: gapTone(trackGap.gapBehindM),
    behindSummary: behind ? (behindTry?.summary ?? '') : 'No car behind',
  };
}
