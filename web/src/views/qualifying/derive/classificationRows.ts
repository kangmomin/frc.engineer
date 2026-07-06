import { getQualifyingBestLapTime } from '../../../components/qualifying/leaderboardOrder';
import type { DriverTryState } from '../../../components/qualifying/tryStatus';
import { getTeamColor } from '../../../constants/teamColors';
import { getTyreColor, getTyreShortLabel } from '../../../constants/tyreCompounds';
import type { DriverInfo } from '../../../types/telemetry';
import { formatLapTime } from '../../../utils/formatters';
import { formatSectorTime, type SectorAcc } from '../useSectorAccumulator';
import type { QualiSegmentVM } from './qualiSegment';

const DASH = '—';

/**
 * Classification(리더보드) 행 파생(Phase3 Spec §3/§3.1). `sorted`는 `sortQualifyingDrivers`로
 * 이미 정렬된 배열이라는 전제다 — 여기서는 재정렬하지 않는다.
 */
export interface ClassificationRow {
  index: number;
  pos: string;
  posColor: string;
  /** 이 행 위쪽에 컷오프 구분선 + 라벨을 그린다(안전권의 첫 탈락권 행). */
  isCutoffMark: boolean;
  isDrop: boolean;
  rowBg: string;
  accentColor: string;
  driverCode: string;
  aiShow: boolean;
  nameColor: string;
  best: string;
  bestColor: string;
  last: string;
  s1: string;
  s1Color: string;
  s2: string;
  s2Color: string;
  s3: string;
  s3Color: string;
  gap: string;
  gapColor: string;
  tyre: string;
  tyreColor: string;
  laps: number;
  tryLabel: string;
  tryColor: string;
  tryBg: string;
  trySummary: string;
  statusLabel: string;
  statusColor: string;
  statusBg: string;
}

/** 레거시 `getDriverStatusInfo`(488-498) 이식. 반환 타입만 CSS 모듈 className → 인라인
 * color/bg 토큰으로 조정(Phase2 lift 선례와 동일 방식) — 라벨·우선순위(핏 > 드라이버상태)는 불변. */
function getDriverStatusInfo(pitStatus: number, driverStatus: number): { label: string; color: string; bg: string } {
  if (pitStatus === 1 || pitStatus === 2) return { label: 'PIT', color: '#0c0c0d', bg: 'var(--accent)' };
  switch (driverStatus) {
    case 1:
      return { label: 'FLY', color: 'var(--accent-lime)', bg: 'rgba(205,255,19,.14)' };
    case 2:
      return { label: 'IN', color: 'var(--text-secondary)', bg: 'rgba(132,147,150,.14)' };
    case 3:
      return { label: 'OUT', color: 'var(--accent)', bg: 'rgba(0,229,255,.12)' };
    case 0:
      // 다크칩 배경(a11y #8) — muted 텍스트가 player-tint 행(cyan .12)에서도 대비를 유지하도록
      // 배지에 불투명에 가까운 배경을 깐다(Phase2 FIX-6 tyre/damage 셀과 동일 패턴).
      return { label: 'GAR', color: 'var(--text-muted)', bg: 'rgba(14,14,15,.5)' };
    default:
      return { label: DASH, color: 'var(--text-muted)', bg: 'rgba(14,14,15,.5)' };
  }
}

/** 레거시 `formatGapToLeader`(123-128) 이식(순수 델타 포맷). 리더/POLE 표기는 호출부에서 조립한다.
 * 동타이(비리더가 리더와 정확히 같은 best, 실제로 발생 가능한 0.000s 동률)는 빈 문자열이 아니라
 * `+0.000`을 반환한다(comp m-6/scope L4) — 빈 문자열은 "값 없음"과 "0초 차"를 구분하지 못한다. */
function formatGapDeltaMs(driverBest: number, leaderBest: number): string {
  if (driverBest <= 0 || leaderBest <= 0) return '--';
  if (driverBest === leaderBest) return '+0.000';
  const delta = driverBest - leaderBest;
  return `+${(delta / 1000).toFixed(3)}`;
}

function getTryTone(tone: DriverTryState['tone']): { color: string; bg: string } {
  switch (tone) {
    case 'attack':
      return { color: 'var(--accent-lime)', bg: 'rgba(205,255,19,.14)' };
    case 'watch':
      return { color: 'var(--accent)', bg: 'rgba(0,229,255,.12)' };
    default:
      return { color: 'var(--text-muted)', bg: 'transparent' };
  }
}

function sectorCell(value: number, overallBest: number): { text: string; color: string } {
  const text = formatSectorTime(value);
  const color = value > 0 && overallBest > 0 && value === overallBest ? 'var(--sector-purple)' : 'var(--text-primary)';
  return { text, color };
}

/**
 * [Assumption] Spec 시그니처는 `(sorted, accMap, tryMap, overallBest, segment, player,
 * leaderBest)`이지만, 컨테이너(QualifyingView)가 이미 My Lap/Cutoff Watch와 공유하는
 * `codes` Map을 그대로 받도록 파라미터를 추가했다(comp m-1) — 이전엔 이 함수가 매 렌더 `sorted`로
 * `deriveDriverCodes`를 다시 호출해 O(n log n) 계산을 중복 수행했다. `deriveDriverCodes`는
 * 입력 배열을 index 오름차순으로 재정렬 후 계산하므로 `sorted`(포지션 순)로 부르든 컨테이너의
 * `allDrivers`(원본 순)로 부르든 결과 Map은 동일하다 — 재사용은 순수 성능 개선이다.
 */
export function deriveClassificationRows(
  sorted: DriverInfo[],
  accMap: Map<number, SectorAcc>,
  tryMap: Map<number, DriverTryState>,
  overallBest: SectorAcc,
  segment: QualiSegmentVM,
  player: DriverInfo | null,
  leaderBest: number,
  codes: Map<number, string>,
): ClassificationRow[] {
  return sorted.map((d, i) => {
    const pos = i + 1;
    const isPlayer = player != null && d.index === player.index;
    const isLeader = i === 0;
    const isDrop = !segment.noCutoff && segment.safeCount != null && pos > segment.safeCount;
    const isCutoffMark = !segment.noCutoff && segment.safeCount != null && pos === segment.safeCount + 1;

    const acc = accMap.get(d.index);
    const tryState = tryMap.get(d.index);
    const best = getQualifyingBestLapTime(d);

    // player 행은 드롭 여부와 무관하게 accent(cyan)로 통일한다(a11y #7) — 이전엔 isDrop이
    // isPlayer보다 우선해 player-in-drop 행에서 red 텍스트가 cyan 틴트(rowBg) 위에 얹혀
    // 4.05:1로 대비가 실패했다. 드롭 정보는 이 행의 accentColor(왼쪽 보더, 계속 red)와
    // 컷오프 구분선 + Cutoff Watch 패널 + outLabel로 이미 전달되므로 텍스트 색만 통일한다.
    const posColor = isLeader ? 'var(--sector-purple)' : isPlayer ? 'var(--accent)' : isDrop ? 'var(--accent-red)' : 'var(--text-muted)';
    const nameColor = isPlayer ? 'var(--accent)' : 'var(--text-primary)';
    const rowBg = isPlayer
      ? 'rgba(0,229,255,.12)'
      : isDrop
        ? 'rgba(255,82,92,.08)'
        : isLeader
          ? 'rgba(156,240,255,.06)'
          : i % 2
            ? 'rgba(255,255,255,.015)'
            : 'transparent';
    const accentColor = isDrop ? 'var(--accent-red)' : isPlayer ? 'var(--accent)' : getTeamColor(d.teamId);

    const rawGap = best > 0 ? formatGapDeltaMs(best, leaderBest) : '--';
    const gap = best <= 0 ? DASH : isLeader ? 'POLE' : rawGap === '--' ? DASH : rawGap;
    // dash('—')도 text-secondary로 통일한다(a11y #8) — player-tint 행에서 text-muted 대비 실패.
    const gapColor = gap === 'POLE' ? 'var(--sector-purple)' : 'var(--text-secondary)';

    const s1 = sectorCell(acc?.bestS1 ?? 0, overallBest.bestS1);
    const s2 = sectorCell(acc?.bestS2 ?? 0, overallBest.bestS2);
    const s3 = sectorCell(acc?.bestS3 ?? 0, overallBest.bestS3);

    // driverStatus는 Go DTO omitempty라 GARAGE(0)는 값이 아니라 필드 부재(undefined)로
    // 온다(M1) — 정규화 없이 넘기면 switch(undefined)가 default(dash)로 빠져 GAR이 사라진다.
    const status = getDriverStatusInfo(d.pitStatus, d.driverStatus ?? 0);
    const tryTone = tryState ? getTryTone(tryState.tone) : { color: 'var(--text-muted)', bg: 'transparent' };

    return {
      index: d.index,
      pos: String(pos).padStart(2, '0'),
      posColor,
      isCutoffMark,
      isDrop,
      rowBg,
      accentColor,
      driverCode: codes.get(d.index) ?? DASH,
      aiShow: d.aiControlled,
      nameColor,
      best: formatLapTime(best),
      bestColor: isLeader ? 'var(--sector-purple)' : isPlayer ? 'var(--accent)' : 'var(--text-primary)',
      last: formatLapTime(d.lastLapTime),
      s1: s1.text,
      s1Color: s1.color,
      s2: s2.text,
      s2Color: s2.color,
      s3: s3.text,
      s3Color: s3.color,
      gap,
      gapColor,
      tyre: getTyreShortLabel(d.tireCompound),
      tyreColor: getTyreColor(d.tireCompound),
      laps: d.currentLapNum,
      tryLabel: tryState?.label ?? DASH,
      tryColor: tryTone.color,
      tryBg: tryTone.bg,
      trySummary: tryState?.summary ?? '',
      statusLabel: status.label,
      statusColor: status.color,
      statusBg: status.bg,
    };
  });
}
