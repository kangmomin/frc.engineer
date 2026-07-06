import { PanelTitle } from '../../ui';
import type { ClassificationRow } from './derive/classificationRows';

const GRID_TEMPLATE = '36px minmax(120px,1.1fr) 84px 78px 58px 58px 58px 72px 62px 42px 66px 66px';

const headLabel: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: '.1em',
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
};

const raceFont: React.CSSProperties = { fontFamily: 'var(--font-racing)', fontWeight: 700 };

export interface ClassificationPanelProps {
  rows: ClassificationRow[];
  detail: string;
  /** 컷오프 구분선 위에 얹는 라벨, 예: "Q1 CUTOFF". */
  cutoffLabel: string;
}

/** 목업 리더보드(12컬럼)를 실데이터(ClassificationRow)로 렌더하는 순수 컴포넌트(Phase3 Spec §3). */
export function ClassificationPanel({ rows, detail, cutoffLabel }: ClassificationPanelProps) {
  return (
    <section
      style={{
        minHeight: 0,
        background: 'var(--bg-panel)',
        border: '1px solid var(--bg-panel-border)',
        borderRadius: 'var(--radius-lg)',
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        overflow: 'hidden',
      }}
    >
      <PanelTitle title="Qualifying Classification" tone="primary" detail={detail} />
      {/* Phase2 LeaderboardPanel과 동일한 ARIA table 구조(FIX-6 계승): role=table의 직계
          자식은 header row, 이후 rowgroup 안에 데이터 row들. 행 자체엔 aria-live를 달지 않는다
          (랩마다 갱신되는 리더보드를 스크린리더가 매번 읽으면 과도하다). rows가 빈 경우(a11y #4)
          rowgroup 자체를 렌더하지 않고 status 메시지로 완전히 대체한다(rowgroup 내부에 role 없는
          방어 분기를 두지 않는다 — 컨테이너 게이트 상 도달 불가하지만 ARIA 체인은 항상 유효해야
          한다). 컷오프 마커가 있는 행은 [마커 div + row div]를 감싸는 wrapper가 필요한데, 이
          wrapper는 role="presentation"으로 밝혀 rowgroup→row 체인이 끊기지 않게 한다(a11y #1/
          comp M-1/scope L2). 마커 자체는 장식용 구분선이라 aria-hidden으로 숨긴다. */}
      <div role="table" aria-label="Qualifying Classification" style={{ flex: 1, minHeight: 0, overflowX: 'auto', overflowY: 'hidden' }}>
        <div role="presentation" style={{ minWidth: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
          <div
            role="row"
            style={{
              flex: 'none',
              display: 'grid',
              gridTemplateColumns: GRID_TEMPLATE,
              alignItems: 'center',
              gap: 9,
              padding: '0 10px 8px',
              background: 'var(--bg-panel)',
              borderBottom: '1px solid var(--bg-panel-border)',
            }}
          >
            <span role="columnheader" style={headLabel}>Pos</span>
            <span role="columnheader" style={headLabel}>Driver</span>
            <span role="columnheader" style={{ ...headLabel, textAlign: 'right' }}>Best Lap</span>
            <span role="columnheader" style={{ ...headLabel, textAlign: 'right' }}>Last Lap</span>
            <span role="columnheader" style={{ ...headLabel, textAlign: 'center' }}>S1</span>
            <span role="columnheader" style={{ ...headLabel, textAlign: 'center' }}>S2</span>
            <span role="columnheader" style={{ ...headLabel, textAlign: 'center' }}>S3</span>
            <span role="columnheader" style={{ ...headLabel, textAlign: 'right' }}>Gap</span>
            <span role="columnheader" style={{ ...headLabel, textAlign: 'center' }}>Tyre</span>
            <span role="columnheader" style={{ ...headLabel, textAlign: 'center' }}>Laps</span>
            <span role="columnheader" style={{ ...headLabel, textAlign: 'center' }}>Try</span>
            <span role="columnheader" style={{ ...headLabel, textAlign: 'center' }}>Status</span>
          </div>
          {rows.length === 0 ? (
            <div role="status" style={{ padding: '16px 0', textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
              No drivers in feed
            </div>
          ) : (
            <div role="rowgroup" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
              {rows.map((row) => (
                <div key={row.index} role="presentation">
                  {row.isCutoffMark && (
                    <div
                      aria-hidden="true"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '3px 10px',
                        borderTop: '1px dashed var(--accent-red)',
                      }}
                    >
                      <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.12em', color: 'var(--accent-red)', textTransform: 'uppercase' }}>
                        {cutoffLabel}
                      </span>
                    </div>
                  )}
                  <div
                    role="row"
                    style={{
                      display: 'grid',
                      gridTemplateColumns: GRID_TEMPLATE,
                      alignItems: 'center',
                      gap: 9,
                      padding: '3px 10px',
                      background: row.rowBg,
                      borderLeft: `3px solid ${row.accentColor}`,
                    }}
                  >
                    <span role="cell" style={{ ...raceFont, fontWeight: 800, fontSize: 14, color: row.posColor }}>{row.pos}</span>
                    <div role="cell" style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 7 }}>
                      <span style={{ ...raceFont, fontWeight: 800, fontSize: 13, letterSpacing: '.03em', color: row.nameColor, whiteSpace: 'nowrap' }}>
                        {row.driverCode}
                      </span>
                      {row.aiShow && (
                        <span
                          style={{
                            fontSize: 8.5,
                            fontWeight: 700,
                            letterSpacing: '.06em',
                            color: 'var(--text-muted)',
                            background: 'rgba(14,14,15,.5)',
                            border: '1px solid var(--bg-panel-border)',
                            borderRadius: 3,
                            padding: '1px 4px',
                          }}
                        >
                          AI
                        </span>
                      )}
                    </div>
                    <span role="cell" style={{ ...raceFont, fontSize: 13, textAlign: 'right', color: row.bestColor }}>{row.best}</span>
                    <span role="cell" style={{ ...raceFont, fontSize: 12.5, textAlign: 'right', color: 'var(--text-secondary)' }}>{row.last}</span>
                    <span role="cell" style={{ ...raceFont, fontSize: 12, textAlign: 'center', color: row.s1Color }}>{row.s1}</span>
                    <span role="cell" style={{ ...raceFont, fontSize: 12, textAlign: 'center', color: row.s2Color }}>{row.s2}</span>
                    <span role="cell" style={{ ...raceFont, fontSize: 12, textAlign: 'center', color: row.s3Color }}>{row.s3}</span>
                    <span role="cell" style={{ ...raceFont, fontSize: 12.5, textAlign: 'right', color: row.gapColor }}>{row.gap}</span>
                    <div role="cell" style={{ display: 'flex', justifyContent: 'center' }}>
                      <span
                        style={{
                          ...raceFont,
                          fontSize: 10.5,
                          padding: '2px 7px',
                          borderRadius: 4,
                          border: `1px solid ${row.tyreColor}`,
                          // 다크칩 배경(a11y #6) — soft(#ff3333 계열) 타이어 배지가 드롭 행
                          // 틴트(rgba(255,82,92,.08)) 위에서 3.53:1로 실패하던 것을 해소한다
                          // (TYRE_COLORS 자체는 불변, Phase2 FIX-6 tyre/damage 셀과 동일 패턴).
                          background: 'rgba(14,14,15,.5)',
                          color: row.tyreColor,
                        }}
                      >
                        {row.tyre}
                      </span>
                    </div>
                    <span role="cell" style={{ ...raceFont, fontSize: 12.5, textAlign: 'center', color: 'var(--text-secondary)' }}>{row.laps}</span>
                    {/* aria-label을 배지 span이 아니라 부모 role=cell div로 옮긴다(a11y #3) —
                        일반 span에 실린 aria-label은 셀의 접근 가능한 이름으로 안정적으로
                        노출되지 않는다(Phase2 DRS 배지와 동일 패턴, 그쪽은 별도 트래킹). */}
                    <div role="cell" aria-label={`${row.tryLabel}: ${row.trySummary}`} style={{ display: 'flex', justifyContent: 'center' }}>
                      <span
                        title={row.trySummary}
                        style={{ ...raceFont, fontSize: 10, fontWeight: 800, letterSpacing: '.04em', padding: '2px 7px', borderRadius: 4, background: row.tryBg, color: row.tryColor }}
                      >
                        {row.tryLabel}
                      </span>
                    </div>
                    <div role="cell" style={{ display: 'flex', justifyContent: 'center' }}>
                      <span style={{ ...raceFont, fontSize: 10, fontWeight: 800, letterSpacing: '.04em', padding: '2px 7px', borderRadius: 4, background: row.statusBg, color: row.statusColor }}>
                        {row.statusLabel}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
