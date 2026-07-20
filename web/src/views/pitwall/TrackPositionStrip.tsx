export interface TrackPositionStripProps {
  /** 플레이어 드라이버 약어 코드 (deriveDriverCodes). */
  code: string;
  /** 랩 진행률 0..100 (wrapPct 결과). */
  pct: number;
}

/**
 * 리더보드 최상단 현 위치 스트립 (목업 PitWall.dc.html 124–152의 실데이터 부분집합).
 * 베이스라인 바 + 스타트/피니시 틱 + 플레이어 마커 + "{CODE} · {NN%}" 라벨.
 * 코너 라벨·high-wear zone은 실데이터가 없어 미구현(history/20260720 참조 — fabrication 금지).
 * 가드(trackLength/lapDistance 유한성)는 호출부(PitWallView)가 담당 — 불통과 시 미렌더.
 */
export function TrackPositionStrip({ code, pct }: TrackPositionStripProps) {
  const rounded = Math.round(pct);
  return (
    <div
      role="img"
      aria-label={`Track position: ${code} at ${rounded}% of lap`}
      style={{ flex: 'none', position: 'relative', height: 40, margin: '0 2px' }}
    >
      <div style={{ position: 'absolute', left: 0, right: 0, top: 14, height: 9, background: 'rgba(132,147,150,.16)', borderRadius: 2 }} />
      <div style={{ position: 'absolute', top: 10, height: 17, left: 0, borderLeft: '2px solid var(--text-secondary)' }} />
      <div style={{ position: 'absolute', top: 18.5, left: `${pct}%`, transform: 'translate(-50%,-50%)', zIndex: 1, pointerEvents: 'none' }}>
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
          top: 27,
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
        {code} · {rounded}%
      </span>
    </div>
  );
}
