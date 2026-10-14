import { PanelTitle } from '../../ui';
import type { PitExitNeighbor, PitExitSpace, PitExitVM } from './derive/pitExit';

const tile: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  gap: 2,
  padding: '6px 11px',
  background: 'rgba(14,14,15,.5)',
  border: '1px solid var(--bg-panel-border)',
  borderRadius: 2,
};

const label: React.CSSProperties = {
  fontSize: 9.5,
  letterSpacing: '.08em',
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
};

const SPACE_STYLE: Record<PitExitSpace, { bg: string; border: string; text: string; label: string }> = {
  clear: { bg: 'rgba(205,255,19,.1)', border: 'rgba(205,255,19,.3)', text: 'var(--accent-lime)', label: 'CLEAR AIR' },
  traffic: { bg: 'rgba(234,179,8,.1)', border: 'rgba(234,179,8,.3)', text: '#eab308', label: 'TRAFFIC' },
  drs: { bg: 'rgba(255,64,64,.1)', border: 'rgba(255,64,64,.32)', text: 'var(--accent-red)', label: 'DRS RANGE' },
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ flex: 'none', background: 'var(--bg-panel)', border: '1px solid var(--bg-panel-border)', borderRadius: 'var(--radius-lg)', padding: 11, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {children}
    </div>
  );
}

function NeighborTile({ dir, n }: { dir: '▲' | '▼'; n: PitExitNeighbor | null }) {
  return (
    <div style={{ ...tile, borderLeft: `3px solid ${dir === '▲' ? 'var(--accent)' : 'var(--text-secondary)'}` }}>
      <span style={label}>{dir} {dir === '▲' ? 'Ahead' : 'Behind'}</span>
      {n ? (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'var(--font-racing)', fontWeight: 800, fontSize: 16, color: dir === '▲' ? 'var(--accent)' : 'var(--text-primary)' }}>{n.code}</span>
          <span style={{ fontFamily: 'var(--font-racing)', fontWeight: 700, fontSize: 13, color: 'var(--text-secondary)' }}>{n.gapText}</span>
          {n.neverStopped && (
            <span style={{ fontSize: 8.5, letterSpacing: '.06em', color: '#eab308', border: '1px solid rgba(234,179,8,.35)', borderRadius: 2, padding: '1px 4px', textTransform: 'uppercase' }}>not stopped</span>
          )}
        </div>
      ) : (
        <span style={{ fontFamily: 'var(--font-racing)', fontWeight: 700, fontSize: 15, color: 'var(--text-muted)' }}>—</span>
      )}
    </div>
  );
}

function WingToggle({ on, extraSec, onToggle }: { on: boolean; extraSec: number; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onToggle}
      title="Adds wing-change time to the pit-loss for this stop. Turns off automatically after you exit the pits."
      style={{
        cursor: 'pointer',
        alignSelf: 'flex-start',
        fontWeight: 700,
        fontSize: 10.5,
        letterSpacing: '.04em',
        padding: '4px 10px',
        borderRadius: 999,
        background: on ? 'var(--accent)' : 'transparent',
        color: on ? '#0c0c0d' : 'var(--text-muted)',
        border: `1px solid ${on ? 'var(--accent)' : 'var(--bg-panel-border)'}`,
      }}
    >
      WING CHANGE {on ? 'ON' : 'OFF'} · +{extraSec}s
    </button>
  );
}

export interface PitExitPanelProps {
  vm: PitExitVM | null;
  /** 이번 스톱 윙 교체 예정(피트아웃 시 자동 해제). */
  wingChange: boolean;
  wingExtraSec: number;
  onToggleWing: () => void;
}

/**
 * "지금 박스하면 어디로 나오는가" 패널. derivePitExit VM만 받는 순수 컴포넌트다.
 * 시나리오는 <details>로 접히고, 이미 피트 중(vm.pitting)이면 강제로 열려 게임 projection을
 * 보여준다(계산 갭은 이중계산이라 억제 — Codex REVISE). 모든 수치는 추정임을 라벨로 명시한다.
 */
export function PitExitPanel({ vm, wingChange, wingExtraSec, onToggleWing }: PitExitPanelProps) {
  if (!vm) {
    return (
      <Shell>
        <PanelTitle title="Pit Exit" tone="tertiary" detail="Projection" />
        <div role="status" style={{ padding: '10px 0', textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
          Pit-loss data unavailable
        </div>
      </Shell>
    );
  }

  // ── 피트 중: 계산 억제, 게임 projection만 ──
  if (vm.pitting) {
    return (
      <Shell>
        <PanelTitle title="Pit Exit" tone="tertiary" detail="In pit" />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', background: 'rgba(0,229,255,.08)', border: '1px solid rgba(0,229,255,.28)', borderRadius: 'var(--radius-md)' }}>
          <span style={label}>Rejoin</span>
          <span style={{ fontFamily: 'var(--font-racing)', fontWeight: 800, fontStyle: 'italic', fontSize: 26, lineHeight: 1, color: 'var(--accent)' }}>
            {vm.gameRejoin != null ? `P${vm.gameRejoin}` : '…'}
          </span>
          <span style={{ fontSize: 9.5, color: 'var(--text-muted)', marginLeft: 'auto' }}>{vm.gameRejoin != null ? 'game' : 'in pit lane'}</span>
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.4 }}>
          Pre-stop scenarios hidden — pit-loss is now live.{wingChange ? ' Wing change resets on pit exit.' : ''}
        </div>
      </Shell>
    );
  }

  // headline은 표시된 피트로스로 계산한 추정 순위다(입력/윙 토글이 즉시 반영). 게임 projection은
  // 게임 자체 피트로스 모델이라 사용자 입력과 무관 — 보조 표기로만 둔다.
  const posText = `${vm.approximate ? '~' : ''}P${vm.estPosition}`;
  const posTag = vm.approximate ? 'est · partial grid' : 'est';
  const sp = vm.space ? SPACE_STYLE[vm.space] : null;
  // 출처 표기(anti-fabrication): 실측=live, 사용자 폴백=set, 트랙 baseline=무표기.
  const lossTag = vm.pitLossSource === 'measured' ? ' (live)' : vm.pitLossSource === 'user' ? ' (set)' : '';

  return (
    <Shell>
      <PanelTitle title="Pit Exit" tone="tertiary" detail={`If boxing now · loss ${vm.pitLossText ?? '—'}${lossTag}${wingChange ? ' +wing' : ''}`} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 11px', background: 'rgba(14,14,15,.5)', border: '1px solid var(--bg-panel-border)', borderRadius: 'var(--radius-md)' }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={label}>Rejoin</span>
          <span style={{ fontFamily: 'var(--font-racing)', fontWeight: 800, fontStyle: 'italic', fontSize: 30, lineHeight: 1, color: 'var(--accent)' }}>{posText}</span>
        </div>
        <div style={{ marginLeft: 'auto', textAlign: 'right', display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ fontSize: 9, letterSpacing: '.08em', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{posTag}</span>
          {vm.gameRejoin != null && <span style={{ fontSize: 9.5, color: 'var(--text-muted)' }}>game P{vm.gameRejoin}</span>}
          {sp && (
            <span style={{ fontFamily: 'var(--font-racing)', fontWeight: 800, fontSize: 11, letterSpacing: '.04em', color: sp.text, background: sp.bg, border: `1px solid ${sp.border}`, borderRadius: 2, padding: '2px 6px' }}>{sp.label}</span>
          )}
        </div>
      </div>

      <WingToggle on={wingChange} extraSec={wingExtraSec} onToggle={onToggleWing} />

      <div style={{ display: 'flex', gap: 7 }}>
        <NeighborTile dir="▲" n={vm.ahead} />
        <NeighborTile dir="▼" n={vm.behind} />
      </div>

      {vm.scenarios.length > 0 ? (
        <details style={{ border: '1px solid var(--bg-panel-border)', borderRadius: 3, background: 'rgba(14,14,15,.35)' }}>
          <summary style={{ cursor: 'pointer', listStyle: 'none', padding: '6px 9px', fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--text-muted)', userSelect: 'none' }}>
            Scenarios · nearby non-pitted
          </summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: '2px 9px 9px' }}>
            {vm.scenarios.map((s) => (
              <div key={s.key} style={{ display: 'flex', flexDirection: 'column', gap: 1, paddingLeft: 8, borderLeft: `2px solid ${s.estimate ? 'var(--accent)' : 'var(--text-muted)'}` }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)' }}>
                  {s.label}
                  {!s.estimate && <span style={{ marginLeft: 5, fontSize: 8.5, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.05em' }}>projection</span>}
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-primary)', lineHeight: 1.35 }}>{s.outcome}</span>
              </div>
            ))}
          </div>
        </details>
      ) : (
        <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.4 }}>
          Nearby cars have all pitted — no undercut battle.
        </div>
      )}
    </Shell>
  );
}
