import { PanelTitle } from '../../ui';
import styles from './BroadcastView.module.css';

const COLOR: Record<'red' | 'soft' | 'muted' | 'cyan', string> = {
  red: 'var(--accent-red)',
  soft: 'var(--accent-soft)',
  muted: 'var(--text-muted)',
  cyan: 'var(--accent)',
};

export interface IssueItem {
  id: string;
  lapTag: string;
  code: string;
  text: string;
  colorKey: 'red' | 'soft' | 'muted' | 'cyan';
  highlight: boolean;
}

export function IssueFeedPanel({ items }: { items: IssueItem[] }) {
  return (
    <div style={{ flex: 1, minHeight: 0, background: 'var(--bg-panel)', border: '1px solid var(--bg-panel-border)', borderRadius: 'var(--radius-lg)', padding: 13, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <PanelTitle title="Issue Feed" tone="secondary" detail="Live" />
      <div className={styles.noScroll} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 6, overflowY: 'auto' }}>
        {items.length === 0 ? (
          <div style={{ padding: '16px 0', textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>No race-control incidents</div>
        ) : (
          items.map((i) => {
            const color = COLOR[i.colorKey];
            return (
              <div key={i.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '7px 9px', background: i.highlight ? 'rgba(0,229,255,.05)' : 'rgba(14,14,15,.5)', border: '1px solid var(--bg-panel-border)', borderLeft: `2px solid ${color}`, borderRadius: 2 }}>
                <span style={{ flex: 'none', fontFamily: 'var(--font-racing)', fontWeight: 700, fontSize: 10.5, color: 'var(--text-muted)', paddingTop: 1, width: 30 }}>{i.lapTag}</span>
                <span style={{ flex: 'none', fontFamily: 'var(--font-racing)', fontWeight: 800, fontSize: 11.5, color, width: 34 }}>{i.code}</span>
                <span style={{ flex: 1, fontSize: 11.5, lineHeight: 1.3, color: 'var(--text-secondary)' }}>{i.text}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
