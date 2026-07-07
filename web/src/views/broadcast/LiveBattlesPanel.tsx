import { PanelTitle } from '../../ui';

export interface BattleCard {
  key: string;
  posLabel: string;
  closing: boolean;
  trendText: string;
  atkCode: string;
  atkTyre: string;
  atkTyreColor: string;
  atkAge: number;
  atkColor: string;
  defCode: string;
  defTyre: string;
  defTyreColor: string;
  defAge: number;
  defColor: string;
  gap: string;
  inRange: boolean;
  rangeText: string;
  predict: string;
  confidence: number | null;
}

export function LiveBattlesPanel({ cards, detail }: { cards: BattleCard[]; detail: string }) {
  return (
    <div style={{ flex: 'none', background: 'var(--bg-panel)', border: '1px solid var(--bg-panel-border)', borderRadius: 'var(--radius-lg)', padding: 13, display: 'flex', flexDirection: 'column', gap: 9 }}>
      <PanelTitle title="Live Battles" tone="secondary" detail={detail} />
      {cards.length === 0 ? (
        <div style={{ padding: '18px 0', textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>No cars within striking range</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          {cards.map((b) => {
            const accent = b.closing ? 'var(--accent-lime)' : 'var(--accent-soft)';
            return (
              <div key={b.key} style={{ background: 'rgba(14,14,15,.5)', border: '1px solid var(--bg-panel-border)', borderLeft: `3px solid ${accent}`, borderRadius: 'var(--radius-md)', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontFamily: 'var(--font-racing)', fontWeight: 800, fontSize: 12, letterSpacing: '0.06em', color: accent }}>BATTLE FOR {b.posLabel}</span>
                  <span style={{ fontSize: 10.5, letterSpacing: '0.04em', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{b.trendText}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, justifyContent: 'flex-end' }}>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontFamily: 'var(--font-racing)', fontWeight: 800, fontSize: 16, color: 'var(--text-primary)' }}>{b.atkCode}</div>
                      <div style={{ fontSize: 9.5, color: b.atkTyreColor }}>{b.atkTyre} · {b.atkAge}L</div>
                    </div>
                    <span style={{ width: 4, height: 26, background: b.atkColor, borderRadius: 2 }} />
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontFamily: 'var(--font-racing)', fontWeight: 800, fontStyle: 'italic', fontSize: 20, color: b.inRange ? 'var(--accent-lime)' : 'var(--text-primary)', lineHeight: 1 }}>{b.gap}</div>
                    <div style={{ fontSize: 9, letterSpacing: '0.1em', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{b.rangeText}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span style={{ width: 4, height: 26, background: b.defColor, borderRadius: 2 }} />
                    <div>
                      <div style={{ fontFamily: 'var(--font-racing)', fontWeight: 800, fontSize: 16, color: 'var(--text-primary)' }}>{b.defCode}</div>
                      <div style={{ fontSize: 9.5, color: b.defTyreColor }}>{b.defTyre} · {b.defAge}L</div>
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <span style={{ flex: 'none', fontSize: 9, letterSpacing: '0.1em', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Predict</span>
                  <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: accent }}>{b.predict}</span>
                  <div style={{ flex: 'none', width: 60, height: 5, background: 'rgba(132,147,150,.2)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${b.confidence ?? 0}%`, background: accent }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
