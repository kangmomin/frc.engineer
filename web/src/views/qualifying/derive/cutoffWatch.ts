import { getQualifyingBestLapTime } from '../../../components/qualifying/leaderboardOrder';
import type { DriverInfo } from '../../../types/telemetry';
import type { QualiSegmentVM } from './qualiSegment';

const DASH = '—';
const CLOCK_WARNING_SECONDS = 90;
const MARGIN_TERTIARY_THRESHOLD_S = 0.3;

export interface CutoffWatchVM {
  hasPlayer: boolean;
  showCutoff: boolean;
  myPos: string;
  statusLabel: string;
  statusColor: string;
  marginText: string;
  marginColor: string;
  cutoffPosText: string;
  cutoffCodeText: string;
  marginTileText: string;
  marginTileTone: 'tertiary' | 'secondary';
  advice: string;
}

/** segment.noCutoff은 Q3/SS3(폴 슛아웃)뿐 아니라 Short Q/OSQ 등 비표준 포맷(구조를 알 수 없어
 * safeCount가 null로 degrade된 경우)에서도 true다(qualiSegment.ts) — "폴을 다툰다"는 문구는
 * 실제 폴 슛아웃(Q3/SS3)일 때만 정확하므로 별도로 구분한다(scope L3). */
function isPoleShootout(segment: QualiSegmentVM): boolean {
  return segment.segment === 'Q3' || segment.segment === 'SS3';
}

function deriveAdvice(segment: QualiSegmentVM, sessionTimeLeft: number | undefined): string {
  if (sessionTimeLeft != null && sessionTimeLeft < CLOCK_WARNING_SECONDS) {
    return "Under 90s — make sure you're on a lap";
  }
  if (isPoleShootout(segment)) return 'Final runs — one lap for pole';
  return 'Clear track ahead';
}

/**
 * Cutoff Watch 패널 VM(Phase3 Spec §4.3). [Assumption] Spec 시그니처 `(player, sorted, segment)`에
 * cutoff 드라이버 코드 표기·클록 기반 advice를 위해 `codes`/`sessionTimeLeft`를 추가했다(다른
 * 패널과 동일한 코드 맵 재사용, myLap.ts와 동일한 확장 방식).
 */
export function deriveCutoffWatch(
  player: DriverInfo | null,
  sorted: DriverInfo[],
  segment: QualiSegmentVM,
  sessionTimeLeft: number | undefined,
  codes: Map<number, string>,
): CutoffWatchVM {
  const advice = deriveAdvice(segment, sessionTimeLeft);

  if (!player) {
    return {
      hasPlayer: false,
      showCutoff: false,
      myPos: DASH,
      statusLabel: DASH,
      statusColor: 'var(--text-muted)',
      marginText: DASH,
      marginColor: 'var(--text-muted)',
      cutoffPosText: DASH,
      cutoffCodeText: DASH,
      marginTileText: DASH,
      marginTileTone: 'secondary',
      advice: 'No player car',
    };
  }

  const myPos = `P${player.position}`;
  const showCutoff = !segment.noCutoff && segment.safeCount != null;

  if (!showCutoff) {
    // "Fighting for pole"는 실제 폴 슛아웃(Q3/SS3)일 때만 정확하다(scope L3) — Short Q/OSQ 같은
    // 비표준 포맷은 구조를 알 수 없으므로(noCutoff=true지만 폴 슛아웃이 아님) 정직하게 대시로
    // degrade한다(조작 금지, qualiSegment.ts의 동일 철학).
    const poleShootout = isPoleShootout(segment);
    return {
      hasPlayer: true,
      showCutoff: false,
      myPos,
      statusLabel: poleShootout ? 'Fighting for pole' : DASH,
      statusColor: poleShootout ? 'var(--accent)' : 'var(--text-muted)',
      marginText: DASH,
      marginColor: 'var(--text-muted)',
      cutoffPosText: DASH,
      cutoffCodeText: DASH,
      marginTileText: DASH,
      marginTileTone: 'secondary',
      advice,
    };
  }

  const safeCount = segment.safeCount as number;
  // 0-idx sorted 배열에서 safeCount번째 원소 = (safeCount+1)번째 순위 = 첫 탈락권.
  const cutoffDriver = sorted[safeCount] ?? null;
  const isSafe = player.position <= safeCount;

  const playerBest = getQualifyingBestLapTime(player);
  const cutoffBest = cutoffDriver ? getQualifyingBestLapTime(cutoffDriver) : 0;
  const marginMs = playerBest > 0 && cutoffBest > 0 ? playerBest - cutoffBest : null;
  const marginAbsS = marginMs != null ? Math.abs(marginMs) / 1000 : null;

  const marginText = marginAbsS == null ? DASH : isSafe ? `Safe by ${marginAbsS.toFixed(3)}s` : `Need ${marginAbsS.toFixed(3)}s`;
  const statusColor = isSafe ? 'var(--accent-lime)' : 'var(--accent-red)';

  return {
    hasPlayer: true,
    showCutoff: true,
    myPos,
    statusLabel: isSafe ? 'PROVISIONALLY THROUGH' : 'IN THE DROP ZONE',
    statusColor,
    marginText,
    marginColor: marginAbsS == null ? 'var(--text-muted)' : statusColor,
    cutoffPosText: `P${safeCount + 1}`,
    cutoffCodeText: cutoffDriver ? codes.get(cutoffDriver.index) ?? DASH : DASH,
    marginTileText: marginAbsS == null ? DASH : `+${marginAbsS.toFixed(3)}s`,
    marginTileTone: marginAbsS != null && marginAbsS > MARGIN_TERTIARY_THRESHOLD_S ? 'tertiary' : 'secondary',
    advice,
  };
}
