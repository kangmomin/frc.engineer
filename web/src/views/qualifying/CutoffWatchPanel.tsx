import { MetricTile, PanelTitle } from '../../ui';
import type { CutoffWatchVM } from './derive/cutoffWatch';

export interface CutoffWatchPanelProps {
  cutoff: CutoffWatchVM;
  detail: string;
}

/** Cutoff Watch 사이드바 패널(Phase3 Spec §4.3) — VM만 받는 순수 컴포넌트. */
export function CutoffWatchPanel({ cutoff, detail }: CutoffWatchPanelProps) {
  if (!cutoff.hasPlayer) {
    return (
      <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--bg-panel-border)', borderRadius: 'var(--radius-lg)', padding: 11, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <PanelTitle title="Cutoff Watch" tone="primary" detail={detail} />
        <div role="status" style={{ padding: '16px 0', textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>No player car</div>
      </div>
    );
  }

  return (
    <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--bg-panel-border)', borderRadius: 'var(--radius-lg)', padding: 11, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <PanelTitle title="Cutoff Watch" tone="primary" detail={detail} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 11px', borderRadius: 'var(--radius-md)', background: 'rgba(14,14,15,.5)', border: `1px solid ${cutoff.statusColor}` }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 9.5, letterSpacing: '.1em', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{cutoff.myPos}</div>
          <div style={{ fontFamily: 'var(--font-racing)', fontWeight: 800, fontSize: 13.5, color: cutoff.statusColor }}>{cutoff.statusLabel}</div>
        </div>
      </div>

      <div style={{ fontSize: 11.5, color: cutoff.marginColor }}>{cutoff.marginText}</div>

      {cutoff.showCutoff && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
          <MetricTile label="Cutoff Pos" value={cutoff.cutoffPosText} note={cutoff.cutoffCodeText} tone="neutral" />
          <MetricTile label="Margin" value={cutoff.marginTileText} tone={cutoff.marginTileTone} />
        </div>
      )}

      <div style={{ padding: '7px 10px', borderRadius: 'var(--radius-sm)', background: 'rgba(0,229,255,.06)', borderLeft: '3px solid var(--accent)', fontSize: 11.5, color: 'var(--text-secondary)' }}>
        {cutoff.advice}
      </div>
    </div>
  );
}
