/**
 * sessionType → 세그먼트 표시 정보(Phase3 Spec §1/§5/§6). Q1/Q2는 안전권 인원(safeCount)이
 * 있고, Q3(폴 슛아웃)는 컷오프가 없다(noCutoff). Short Q/OSQ 등 비표준 포맷은 세그먼트 구조를
 * 알 수 없으므로 조작하지 않고 정직하게 degrade한다(safeCount=null, outLabel='—').
 *
 * outLabel의 "P16–20 out" 류 문구는 실측 드라이버 수가 아니라 F1 규정상 고정된 그리드 구조
 * (20→15→10→폴)를 서술한다 — 세션마다 달라지는 실측 값이 아니므로 조작(fabrication)이 아니다.
 */

export interface QualiSegmentVM {
  /** 표시용 세그먼트 라벨. 표준 세그먼트(Q1/Q2/Q3/SS1-3)는 정규화된 대문자, 아니면 원본 sessionType. */
  segment: string;
  /** 안전권(다음 세그먼트 진출) 인원. 컷오프가 없거나(Q3) 알 수 없는 포맷이면 null. */
  safeCount: number | null;
  /** safeCount === null 여부 — cutoffWatch/classificationRows의 명시적 게이트. */
  noCutoff: boolean;
  /** 세그먼트 아웃 라벨. 예: "P16–20 out · Top 15 advance", Q3는 "Pole Shootout". */
  outLabel: string;
}

const SAFE_COUNT: Record<string, number> = {
  Q1: 15,
  SS1: 15,
  Q2: 10,
  SS2: 10,
};

function normalizeSegment(sessionType: string | null | undefined): string {
  return (sessionType ?? '').trim().toUpperCase();
}

export function deriveQualiSegment(sessionType: string | null | undefined): QualiSegmentVM {
  const normalized = normalizeSegment(sessionType);
  const safeCount = SAFE_COUNT[normalized] ?? null;
  const noCutoff = safeCount === null;

  let outLabel: string;
  if (normalized === 'Q1' || normalized === 'SS1') {
    outLabel = 'P16–20 out · Top 15 advance';
  } else if (normalized === 'Q2' || normalized === 'SS2') {
    outLabel = 'P11–15 out · Top 10 advance';
  } else if (normalized === 'Q3' || normalized === 'SS3') {
    outLabel = 'Pole Shootout';
  } else {
    outLabel = '—';
  }

  return {
    // normalized는 sessionType이 null/undefined/빈 문자열/공백일 때 모두 ''(falsy)이므로
    // 세 경우 전부 '—'로 균일하게 degrade한다. 표준 세그먼트가 아닌 실값(예: "Short Q")은
    // 조작하지 않고 정규화된 원본 그대로 노출한다.
    segment: normalized || '—',
    safeCount,
    noCutoff,
    outLabel,
  };
}
