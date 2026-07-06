import { MetricTile, PanelTitle } from '../../ui';
import type { StrategyBoard } from './derive/strategyBoard';

/**
 * 목업의 "Predicted Finish"(백엔드 예측 모델 부재로 조작 데이터)를 대체하는
 * 실데이터 전략 패널. pit 재합류 예상순위·pit 윈도우·dry/wet 크로스오버만 표시(추측 0).
 */
export function StrategyPanel({ strategy }: { strategy: StrategyBoard }) {
  const { rejoinPosition, windowIdealLap, windowLatestLap, crossover } = strategy;
  const hasWindow = windowIdealLap != null || windowLatestLap != null;
  const hasAny = rejoinPosition != null || hasWindow || crossover != null;

  return (
    <div style={{ flex: 1, minHeight: 0, background: 'var(--bg-panel)', border: '1px solid var(--bg-panel-border)', borderRadius: 'var(--radius-lg)', padding: 13, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <PanelTitle title="Strategy · Pit Window" tone="tertiary" detail="Live game data" />

      {!hasAny ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
          No pit-window data · single-stint pace
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <MetricTile
              label="Pit Exit"
              value={rejoinPosition != null ? `P${rejoinPosition}` : '—'}
              tone="tertiary"
              note="if boxing now"
            />
            <MetricTile
              label="Window"
              value={hasWindow ? `L${windowIdealLap ?? '?'}–${windowLatestLap ?? '?'}` : '—'}
              tone="primary"
              note="ideal – latest lap"
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 9, letterSpacing: '0.12em', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Dry / Wet Crossover</span>
            {crossover ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: 'rgba(14,14,15,.5)', border: '1px solid var(--bg-panel-border)', borderLeft: '3px solid var(--accent)', borderRadius: 'var(--radius-md)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontFamily: 'var(--font-racing)', fontWeight: 800, fontSize: 13, color: 'var(--text-primary)' }}>
                    {crossover.dryGroup.toUpperCase()} vs {crossover.wetGroup.toUpperCase()}
                  </span>
                  <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>current pace delta</span>
                </div>
                <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                  <div style={{ fontFamily: 'var(--font-racing)', fontWeight: 800, fontStyle: 'italic', fontSize: 18, color: crossover.deltaMs <= 0 ? 'var(--accent-lime)' : 'var(--text-primary)', lineHeight: 1 }}>
                    {crossover.deltaMs >= 0 ? '+' : ''}{(crossover.deltaMs / 1000).toFixed(1)}s
                  </div>
                  <div style={{ fontSize: 9.5, color: 'var(--text-muted)' }}>
                    {crossover.trendMsPerLap >= 0 ? '+' : ''}{(crossover.trendMsPerLap / 1000).toFixed(2)}s/lap
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ padding: '10px 12px', background: 'rgba(14,14,15,.5)', border: '1px solid var(--bg-panel-border)', borderRadius: 'var(--radius-md)', fontSize: 12, color: 'var(--text-muted)' }}>
                Stable conditions — no crossover in play
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
