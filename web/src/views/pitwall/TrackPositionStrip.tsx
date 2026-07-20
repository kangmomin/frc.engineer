import type { CornerMark } from '../../ui/TrackStrip.derive';

export interface TrackPositionStripProps {
  /** 플레이어 드라이버 약어 코드 (deriveDriverCodes). */
  code: string;
  /** 랩 진행률 0..100 (wrapPct 결과). */
  pct: number;
  /** 현재 섹터(1-based: 1/2/3). null = 미표시. */
  sector?: number | null;
  /** 실측 코너 마커(buildCornerMarks 결과, trackId/trackLength 기준 메모이즈).
   * null/미지정 = 코너 데이터 없는 트랙 — 기존 렌더와 동일 (fabrication 금지). */
  cornerMarks?: CornerMark[] | null;
  /** 다음 코너 라벨('→ T5'). null = 미표시. */
  nextCornerText?: string | null;
}

/**
 * 리더보드 최상단 현 위치 스트립 (목업 PitWall.dc.html 124–152의 실데이터 부분집합).
 * 베이스라인 바 + 스타트/피니시 틱 + 플레이어 마커 + "{CODE} · {NN%}" 라벨.
 * 코너 틱·라벨은 MultiViewer 실측 데이터(constants/trackCorners)가 있는 트랙에서만
 * 렌더한다 — 데이터 없는 트랙(리버스·Madring)은 bandH=0으로 기존과 동일 렌더.
 * 가드(trackLength/lapDistance 유한성)는 호출부(PitWallView)가 담당 — 불통과 시 미렌더.
 */
export function TrackPositionStrip({ code, pct, sector, cornerMarks, nextCornerText }: TrackPositionStripProps) {
  const rounded = Math.round(pct);
  // 코너 밴드 높이 — 코너 없으면 0으로 강등되어 모든 오프셋이 기존 값과 일치한다.
  const bandH = cornerMarks?.length ? 16 : 0;
  return (
    <div
      role="img"
      aria-label={`Track position: ${code} at ${rounded}% of lap${sector != null ? `, in sector ${sector}` : ''}${nextCornerText ? `, approaching ${nextCornerText.replace(/^→\s*/, '')}` : ''}`}
      style={{ flex: 'none', position: 'relative', height: 40 + bandH, margin: '0 2px' }}
    >
      {cornerMarks?.map((mark, i) => (
        <span
          key={i}
          style={{
            position: 'absolute',
            // 2층 배치(base/raised) — 시케인 등 인접 코너 라벨 겹침 회피 (buildCornerMarks).
            top: mark.raised ? 0 : 8,
            left: `${mark.pct}%`,
            transform: 'translateX(-50%)',
            fontSize: 8,
            lineHeight: '8px',
            letterSpacing: '.04em',
            color: 'var(--text-muted)',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
          }}
        >
          T{mark.corner.number}
        </span>
      ))}
      {cornerMarks?.map((mark, i) => (
        <span
          key={`tick-${i}`}
          style={{ position: 'absolute', top: bandH + 10, height: 4, width: 1, left: `${mark.pct}%`, background: 'var(--text-muted)', opacity: 0.55 }}
        />
      ))}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 14 + bandH, height: 9, background: 'rgba(132,147,150,.16)', borderRadius: 2 }} />
      <div style={{ position: 'absolute', top: 10 + bandH, height: 17, left: 0, borderLeft: '2px solid var(--text-secondary)' }} />
      <div style={{ position: 'absolute', top: 18.5 + bandH, left: `${pct}%`, transform: 'translate(-50%,-50%)', zIndex: 1, pointerEvents: 'none' }}>
        <span
          style={{
            display: 'block',
            width: 11,
            height: 11,
            borderRadius: '50%',
            background: 'var(--accent)',
            border: '2px solid #0c0c0d',
            boxShadow: '0 0 10px var(--accent)',
          }}
        />
      </div>
      <span
        style={{
          position: 'absolute',
          top: 27 + bandH,
          // 마커가 패널 가장자리에 있어도 라벨은 잘리지 않게 클램프
          left: `clamp(30px, ${pct}%, calc(100% - 30px))`,
          transform: 'translateX(-50%)',
          fontFamily: 'var(--font-racing)',
          fontWeight: 800,
          fontSize: 9,
          color: 'var(--accent)',
          whiteSpace: 'nowrap',
        }}
      >
        {code} · {rounded}%{sector != null ? ` · S${sector}` : ''}{nextCornerText ? ` · ${nextCornerText}` : ''}
      </span>
    </div>
  );
}
