import { PanelTitle } from '../../ui';
import type { StrategyGuideState } from './useStrategyGuide';

function EmptyState({ text }: { text: string }) {
  return (
    <div style={{ flex: 1, minHeight: 0, background: 'var(--bg-panel)', border: '1px solid var(--bg-panel-border)', borderRadius: 'var(--radius-lg)', padding: 11, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <PanelTitle title="Strategy Guide" tone="secondary" detail="Live" />
      <div role="status" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>{text}</div>
    </div>
  );
}

/**
 * 구 "Team Radio"(synthetic 대사) 대체. getStrategyGuide RPC 실데이터만 표시하고,
 * 조작된 라디오 메시지는 없다(Spec §4.4). 목업에 대응 화면이 없어 앱의 기존 우측 레일
 * 카드 언어(rgba(14,14,15,.5) 타일 + font-racing 강조 숫자)를 그대로 따른다.
 */
export function StrategyGuidePanel({ state, is2026 }: { state: StrategyGuideState; is2026: boolean }) {
  if (state.status === 'idle') return <EmptyState text="Waiting for track data…" />;
  if (state.status === 'loading') return <EmptyState text="Loading track guide…" />;
  if (state.status === 'unavailable' || !state.data) return <EmptyState text="Track guide unavailable" />;

  const track = state.data.track;
  const tyreLife = Object.entries(track.tyre_strategy?.tyre_life_50pct ?? {});
  const plan = track.race_strategy?.plan_a ?? track.race_strategy?.plan_b ?? null;
  // 2026 세션: 가이드 수치는 F1 25 스크랩 기반 추정치다 — 출처를 정직하게 표기한다
  // (legacy CockpitDashboard의 strategy_meta 표기 이식, anti-fabrication).
  const meta = track.strategy_meta;
  const c6Downgraded = meta?.adjustments?.includes('c6_downgraded_to_c5');

  return (
    <div style={{ flex: 1, minHeight: 0, background: 'var(--bg-panel)', border: '1px solid var(--bg-panel-border)', borderRadius: 'var(--radius-lg)', padding: 11, display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto' }}>
      <PanelTitle title="Strategy Guide" tone="secondary" detail={track.track} />
      <div style={{ padding: '7px 9px', background: 'rgba(14,14,15,.5)', border: '1px solid var(--bg-panel-border)', borderRadius: 3 }}>
        <div style={{ fontSize: 9.5, letterSpacing: '.08em', color: 'var(--text-muted)', textTransform: 'uppercase' }}>50% Baseline</div>
        <div style={{ fontFamily: 'var(--font-racing)', fontWeight: 800, fontSize: 16 }}>{track.track_info?.laps_50pct ?? '—'}L</div>
      </div>
      {tyreLife.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 9.5, letterSpacing: '.08em', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Tyre Life (50%)</span>
          {tyreLife.map(([compound, value]) => (
            <div key={compound} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 9px', background: 'rgba(14,14,15,.5)', border: '1px solid var(--bg-panel-border)', borderRadius: 2 }}>
              <span style={{ color: 'var(--text-secondary)', textTransform: 'capitalize' }}>{compound}</span>
              <span style={{ fontFamily: 'var(--font-racing)', fontWeight: 700 }}>{value.laps}L</span>
            </div>
          ))}
        </div>
      )}
      {plan && (
        <div style={{ padding: '7px 9px', background: 'rgba(0,229,255,.06)', border: '1px solid rgba(0,229,255,.2)', borderRadius: 3 }}>
          <div style={{ fontSize: 9.5, letterSpacing: '.08em', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Recommended Pit Window</div>
          <div style={{ fontFamily: 'var(--font-racing)', fontWeight: 700, fontSize: 13, color: 'var(--accent)' }}>{plan.pit_window_display}</div>
        </div>
      )}
      {is2026 && (
        <div
          title={meta?.notes?.join('\n')}
          style={{ fontSize: 10, color: '#eab308', padding: '4px 9px', background: 'rgba(234,179,8,.07)', border: '1px solid rgba(234,179,8,.25)', borderRadius: 2 }}
        >
          {'⚠'} F1 25 baseline{c6Downgraded ? ' · C6→C5 (2026: C1–C5)' : ''} · no DRS
        </div>
      )}
    </div>
  );
}
