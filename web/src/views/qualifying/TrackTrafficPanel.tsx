import { PanelTitle } from '../../ui';
import type { MyLapVM } from './derive/myLap';

interface TrackTrafficPanelProps {
  lap: MyLapVM;
  detail: string;
}

export function TrackTrafficPanel({ lap, detail }: TrackTrafficPanelProps) {
  const threat = lap.aroundMode === 'threat';
  const title = threat ? 'Threat Watch' : 'Track Traffic';
  const unavailable = !lap.hasPlayer ? 'No player car' : !threat && !lap.trackGapsAvailable ? 'Track position unavailable' : null;

  return (
    <section aria-label={title} style={{ background: 'var(--bg-panel)', border: '1px solid var(--bg-panel-border)', borderRadius: 'var(--radius-lg)', padding: 11, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <PanelTitle title={title} tone="primary" detail={`${threat ? 'For' : 'Around'} ${detail}`} />
      {unavailable ? (
        <div role="status" style={{ padding: '12px 0', fontSize: 12, color: 'var(--text-muted)' }}>{unavailable}</div>
      ) : (
        <>
          {threat && <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>In pit · best lap difference</div>}
          <TrafficCar
            label={threat ? `Threat 1 ${lap.aheadPos}` : '▲ Ahead'}
            ariaLabel={threat ? 'First qualifying threat' : 'Car ahead on track'}
            name={lap.aheadName || lap.aheadCode}
            summary={lap.aheadSummary}
            gap={threat && lap.aheadGapText !== '—' ? `${lap.aheadGapText}s` : lap.aheadGapText}
            color={lap.aheadGapColor}
            accent="var(--accent)"
          />
          <TrafficCar
            label={threat ? `Threat 2 ${lap.behindPos}` : '▼ Behind'}
            ariaLabel={threat ? 'Second qualifying threat' : 'Car behind on track'}
            name={lap.behindName || lap.behindCode}
            summary={lap.behindSummary}
            gap={threat && lap.behindGapText !== '—' ? `${lap.behindGapText}s` : lap.behindGapText}
            color={lap.behindGapColor}
            accent="var(--text-secondary)"
          />
        </>
      )}
    </section>
  );
}

interface TrafficCarProps {
  label: string;
  ariaLabel: string;
  name: string;
  summary: string;
  gap: string;
  color: string;
  accent: string;
}

function TrafficCar({ label, ariaLabel, name, summary, gap, color, accent }: TrafficCarProps) {
  return (
    <div role="group" aria-label={ariaLabel} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: 'rgba(14,14,15,.5)', border: '1px solid var(--bg-panel-border)', borderLeft: `3px solid ${accent}`, borderRadius: 2 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 9.5, letterSpacing: '.1em', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>{label}</div>
        <div title={name} style={{ fontFamily: 'var(--font-racing)', fontWeight: 800, fontSize: 14, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>
        <div title={summary} style={{ fontSize: 10.5, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{summary}</div>
      </div>
      <span style={{ fontFamily: 'var(--font-racing)', fontWeight: 800, fontSize: 18, whiteSpace: 'nowrap', color }}>{gap}</span>
    </div>
  );
}
