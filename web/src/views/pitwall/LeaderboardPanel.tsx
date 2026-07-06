import { PanelTitle } from '../../ui';
import { COL_ALIGN, COL_ORDER, MAX_COL_WIDTH, MIN_COL_WIDTH, columnHeadLabel, type ColumnKey } from './columns';
import type { LeaderRow } from './derive/leaderboardRows';

const RESIZE_STEP_PX = 10;

const headLabel: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: '.1em',
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
};

const raceFont: React.CSSProperties = { fontFamily: 'var(--font-racing)', fontWeight: 700 };

export interface LeaderboardPanelProps {
  rows: LeaderRow[];
  cols: Record<ColumnKey, boolean>;
  colW: Record<ColumnKey, number>;
  is2026: boolean;
  detail: string;
  onResizeStart: (key: ColumnKey, e: React.PointerEvent<HTMLDivElement>) => void;
  onNudgeWidth: (key: ColumnKey, delta: number) => void;
}

/** 목업 리더보드 섹션의 가변 컬럼 레이아웃을 실데이터(LeaderRow)로 렌더하는 순수 컴포넌트. */
export function LeaderboardPanel({ rows, cols, colW, is2026, detail, onResizeStart, onNudgeWidth }: LeaderboardPanelProps) {
  const active = COL_ORDER.filter((k) => cols[k]);
  const gridTemplate = `38px minmax(128px,1.1fr) ${active.map((k) => `${colW[k]}px`).join(' ')}`;

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
      <PanelTitle title="Cockpit Leaderboard" tone="primary" detail={detail} />
      <div style={{ flex: 1, minHeight: 0, overflowX: 'auto', overflowY: 'hidden' }}>
        <div style={{ minWidth: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              flex: 'none',
              display: 'grid',
              gridTemplateColumns: gridTemplate,
              alignItems: 'center',
              gap: 9,
              padding: '0 10px 8px',
              background: 'var(--bg-panel)',
              borderBottom: '1px solid var(--bg-panel-border)',
            }}
          >
            <span style={headLabel}>Pos</span>
            <span style={headLabel}>Driver</span>
            {active.map((k) => (
              <div key={k} style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: COL_ALIGN[k], minWidth: 0 }}>
                <span style={{ ...headLabel, letterSpacing: '.08em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {columnHeadLabel(k, is2026)}
                </span>
                <div
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={`Resize ${columnHeadLabel(k, is2026)} column`}
                  aria-valuenow={colW[k]}
                  aria-valuemin={MIN_COL_WIDTH}
                  aria-valuemax={MAX_COL_WIDTH}
                  tabIndex={0}
                  onPointerDown={(e) => onResizeStart(k, e)}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowLeft') {
                      e.preventDefault();
                      onNudgeWidth(k, -RESIZE_STEP_PX);
                    } else if (e.key === 'ArrowRight') {
                      e.preventDefault();
                      onNudgeWidth(k, RESIZE_STEP_PX);
                    }
                  }}
                  title="Drag to resize column"
                  style={{ position: 'absolute', right: -6, top: -4, bottom: -4, width: 11, cursor: 'col-resize', zIndex: 5, display: 'flex', justifyContent: 'center' }}
                >
                  <span style={{ width: 2, background: 'rgba(132,147,150,.35)', borderRadius: 1 }} />
                </div>
              </div>
            ))}
          </div>
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
            {rows.map((row) => (
              <div
                key={row.index}
                style={{
                  flex: 'none',
                  display: 'grid',
                  gridTemplateColumns: gridTemplate,
                  alignItems: 'center',
                  gap: 9,
                  padding: '3px 10px',
                  background: row.rowBg,
                  borderLeft: `3px solid ${row.teamColor}`,
                }}
              >
                <span style={{ ...raceFont, fontWeight: 800, fontSize: 15, color: row.posColor }}>{row.pos}</span>
                <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ ...raceFont, fontWeight: 800, fontSize: 14, letterSpacing: '.04em', color: row.nameColor, whiteSpace: 'nowrap' }}>
                    {row.name}
                  </span>
                  {row.aiShow && (
                    <span style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '.06em', color: 'var(--text-muted)', border: '1px solid var(--bg-panel-border)', borderRadius: 3, padding: '1px 4px' }}>
                      AI
                    </span>
                  )}
                </div>
                {cols.drs && (
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <span style={{ ...raceFont, fontWeight: 800, fontSize: 11, letterSpacing: '.04em', padding: '2px 8px', borderRadius: 4, background: row.drsBg, color: row.drsColor }}>
                      {row.drsLabel}
                    </span>
                  </div>
                )}
                {cols.ers && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <div style={{ flex: 1, height: 6, background: 'rgba(132,147,150,.2)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: row.ersW, background: row.ersColor }} />
                    </div>
                    <span style={{ ...raceFont, fontSize: 12, color: 'var(--text-secondary)', width: 30, textAlign: 'right' }}>{row.ersPct}</span>
                  </div>
                )}
                {cols.gap && <span style={{ ...raceFont, fontSize: 13, color: row.toYouColor, textAlign: 'right' }}>{row.toYou}</span>}
                {cols.interval && <span style={{ ...raceFont, fontSize: 13, color: 'var(--text-secondary)', textAlign: 'right' }}>{row.interval}</span>}
                {cols.lastLap && <span style={{ ...raceFont, fontSize: 13, color: row.lastColor, textAlign: 'right' }}>{row.lastLap}</span>}
                {cols.penalty && (
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <span style={{ ...raceFont, fontSize: 11, padding: '2px 7px', borderRadius: 4, background: row.penBg, color: row.penColor }}>{row.penLabel}</span>
                  </div>
                )}
                {cols.tyre && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: 2 }}>
                      {row.stintDots.map((dot, i) => (
                        <span key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: dot.color }} />
                      ))}
                    </div>
                    <span
                      style={{
                        flex: 'none',
                        width: 22,
                        height: 22,
                        borderRadius: '50%',
                        border: `2px solid ${row.compoundColor}`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        ...raceFont,
                        fontWeight: 800,
                        fontSize: 11,
                        color: row.compoundColor,
                      }}
                    >
                      {row.compound}
                    </span>
                    <span style={{ ...raceFont, fontSize: 13, color: 'var(--text-primary)' }}>{row.age}</span>
                    <span style={{ fontSize: 10.5, color: 'var(--text-muted)', letterSpacing: '.02em' }}>{row.tyreLife}</span>
                  </div>
                )}
                {cols.pit && (
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <span style={{ ...raceFont, fontSize: 11, padding: '2px 7px', borderRadius: 4, background: row.pitBg, color: row.pitColor }}>{row.pitLabel}</span>
                  </div>
                )}
                {cols.vmax && <span style={{ ...raceFont, fontSize: 13, color: 'var(--text-secondary)', textAlign: 'right' }}>{row.vmax}</span>}
                {cols.sector && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
                    <span style={{ ...raceFont, fontSize: 11.5, color: row.s1c, textAlign: 'center' }}>{row.s1}</span>
                    <span style={{ ...raceFont, fontSize: 11.5, color: row.s2c, textAlign: 'center' }}>{row.s2}</span>
                    <span style={{ ...raceFont, fontSize: 11.5, color: row.s3c, textAlign: 'center' }}>{row.s3}</span>
                  </div>
                )}
                {cols.damage && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr', gap: 3 }}>
                    <span style={{ fontSize: 9.5, fontWeight: 600, textAlign: 'center', padding: '1px 0', borderRadius: 3, background: 'rgba(14,14,15,.5)', color: row.dmgFLc }}>FL {row.dmgFL}</span>
                    <span style={{ fontSize: 9.5, fontWeight: 600, textAlign: 'center', padding: '1px 0', borderRadius: 3, background: 'rgba(14,14,15,.5)', color: row.dmgFRc }}>FR {row.dmgFR}</span>
                    <span style={{ fontSize: 9.5, fontWeight: 600, textAlign: 'center', padding: '1px 0', borderRadius: 3, background: 'rgba(14,14,15,.5)', color: row.dmgRWc }}>RW {row.dmgRW}</span>
                    <span style={{ fontSize: 9.5, fontWeight: 600, textAlign: 'center', padding: '1px 0', borderRadius: 3, background: 'rgba(14,14,15,.5)', color: row.dmgOTHc }}>OT {row.dmgOTH}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
