import { PanelTitle } from '../../ui';
import type { MyLapVM } from './derive/myLap';

const tile: React.CSSProperties = {
  padding: '6px 9px',
  background: 'rgba(14,14,15,.5)',
  border: '1px solid var(--bg-panel-border)',
  borderRadius: 2,
};

const tileLabel: React.CSSProperties = {
  fontSize: 9.5,
  letterSpacing: '.08em',
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
};

const tileValue: React.CSSProperties = { fontFamily: 'var(--font-racing)', fontWeight: 800, fontSize: 14 };

export interface MyLapPanelProps {
  lap: MyLapVM;
  detail: string;
}

/** My Lap 사이드바 패널(Phase3 Spec §4.1) — phase + best/라이브 델타 + progress + 라이브 섹터
 * + ahead/behind. VM만 받는 순수 컴포넌트. */
export function MyLapPanel({ lap, detail }: MyLapPanelProps) {
  if (!lap.hasPlayer) {
    return (
      <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--bg-panel-border)', borderRadius: 'var(--radius-lg)', padding: 11, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <PanelTitle title="My Lap" tone="primary" detail={detail} />
        <div role="status" style={{ padding: '16px 0', textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>No player car</div>
      </div>
    );
  }

  return (
    <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--bg-panel-border)', borderRadius: 'var(--radius-lg)', padding: 11, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <PanelTitle title="My Lap" tone="primary" detail={detail} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '7px 11px', background: 'rgba(14,14,15,.5)', border: '1px solid var(--bg-panel-border)', borderLeft: `3px solid ${lap.phaseColor}`, borderRadius: 2 }}>
        <span style={{ fontSize: 9.5, letterSpacing: '.14em', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Lap Phase</span>
        <span style={{ fontFamily: 'var(--font-racing)', fontWeight: 800, fontSize: 16, color: lap.phaseColor }}>{lap.phaseLabel}</span>
        <span style={{ fontSize: 10.5, color: 'var(--text-secondary)' }}>Run #{lap.attemptNumber} · Push {lap.consecutivePushLaps}</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
        <div style={tile}>
          <div style={tileLabel}>Best</div>
          <div style={{ ...tileValue, color: 'var(--text-primary)' }}>{lap.bestText}</div>
        </div>
        <div style={tile}>
          <div style={tileLabel}>Δ to Best (live)</div>
          <div style={{ ...tileValue, color: lap.deltaColor }}>{lap.deltaText}</div>
        </div>
      </div>

      <div
        role="progressbar"
        aria-label="Lap progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(lap.progressPct)}
        style={{ width: '100%', height: 5, background: 'rgba(132,147,150,.18)', borderRadius: 3, overflow: 'hidden' }}
      >
        <div style={{ height: '100%', background: 'linear-gradient(90deg,var(--accent),var(--accent-lime))', width: `${lap.progressPct}%` }} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 7 }}>
        <div style={tile}>
          <div style={tileLabel}>S1</div>
          <div style={{ ...tileValue, color: lap.s1Color }}>{lap.s1Text}</div>
        </div>
        <div style={tile}>
          <div style={tileLabel}>S2</div>
          <div style={{ ...tileValue, color: lap.s2Color }}>{lap.s2Text}</div>
        </div>
        <div style={tile}>
          <div style={tileLabel}>S3</div>
          <div style={{ ...tileValue, color: 'var(--text-muted)' }}>{lap.s3Text}</div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {/* threat 모드: 플레이어가 트랙 밖이라 슬롯이 앞뒤차가 아니라 위협 랭킹 상위 2대 —
            라벨을 ⚠+순위로 바꿔 "물리적 앞/뒤"로 오독되지 않게 한다(갭 값도 거리→베스트랩 델타). */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 11px', background: 'rgba(14,14,15,.5)', border: '1px solid var(--bg-panel-border)', borderLeft: '3px solid var(--accent)', borderRadius: 2 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, letterSpacing: '.1em', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
              {lap.aroundMode === 'threat' ? `⚠ ${lap.aheadCode} ${lap.aheadPos}`.trim() : `▲ ${lap.aheadCode}`}
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{lap.aheadSummary}</div>
          </div>
          <span style={{ fontFamily: 'var(--font-racing)', fontWeight: 800, fontSize: 16, color: lap.aheadGapColor }}>{lap.aheadGapText}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 11px', background: 'rgba(14,14,15,.5)', border: '1px solid var(--bg-panel-border)', borderLeft: '3px solid var(--text-secondary)', borderRadius: 2 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, letterSpacing: '.1em', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
              {lap.aroundMode === 'threat' ? `⚠ ${lap.behindCode} ${lap.behindPos}`.trim() : `▼ ${lap.behindCode}`}
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{lap.behindSummary}</div>
          </div>
          <span style={{ fontFamily: 'var(--font-racing)', fontWeight: 800, fontSize: 16, color: lap.behindGapColor }}>{lap.behindGapText}</span>
        </div>
      </div>
    </div>
  );
}
