import type { LapDataResponse } from '../../types/telemetry';

interface SectorDeltaPanelProps {
  lapData: LapDataResponse | null;
}

function formatSectorTime(ms: number): string {
  if (ms <= 0) return '-';
  return (ms / 1000).toFixed(3);
}

export function SectorDeltaPanel({ lapData }: SectorDeltaPanelProps) {
  const bestLap = lapData?.bestLap;
  if (!bestLap) {
    return (
      <div style={{
        background: 'var(--bg-panel)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--spacing-md)',
        fontFamily: 'var(--font-body)',
        fontSize: '0.8rem',
        color: 'var(--color-text-secondary)',
      }}>
        <div style={{
          fontFamily: 'var(--font-racing)',
          fontSize: '0.9rem',
          color: 'var(--color-text)',
          textTransform: 'uppercase' as const,
          letterSpacing: '0.05em',
          marginBottom: 'var(--spacing-sm)',
        }}>
          Sector Analysis
        </div>
        <span style={{ fontStyle: 'italic' }}>No best lap data</span>
      </div>
    );
  }

  const sectors = [
    { name: 'S1', time: bestLap.sector1Ms },
    { name: 'S2', time: bestLap.sector2Ms },
    { name: 'S3', time: bestLap.sector3Ms },
  ];

  const slowest = sectors.reduce((max, s) => s.time > max.time ? s : max, sectors[0]);

  return (
    <div style={{
      background: 'var(--bg-panel)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--spacing-md)',
      fontFamily: 'var(--font-body)',
      fontSize: '0.8rem',
    }}>
      <div style={{
        fontFamily: 'var(--font-racing)',
        fontSize: '0.9rem',
        color: 'var(--color-text)',
        textTransform: 'uppercase' as const,
        letterSpacing: '0.05em',
        marginBottom: 'var(--spacing-sm)',
      }}>
        Sector Analysis
      </div>
      <div style={{ display: 'flex', gap: '16px' }}>
        {sectors.map(s => (
          <div key={s.name} style={{
            flex: 1,
            textAlign: 'center',
            padding: '8px',
            borderRadius: '4px',
            background: s === slowest ? 'rgba(255, 170, 0, 0.15)' : 'rgba(255, 255, 255, 0.05)',
          }}>
            <div style={{
              fontFamily: 'var(--font-racing)',
              fontSize: '0.75rem',
              color: 'var(--color-text-secondary)',
              marginBottom: '4px',
            }}>
              {s.name}
            </div>
            <div style={{
              fontFamily: 'var(--font-racing)',
              fontSize: '1rem',
              color: s === slowest ? '#ffaa00' : '#00ff88',
            }}>
              {formatSectorTime(s.time)}
            </div>
          </div>
        ))}
      </div>
      {slowest && slowest.time > 0 && (
        <div style={{
          marginTop: '8px',
          color: '#ffaa00',
          fontSize: '0.75rem',
        }}>
          Focus: {slowest.name} is the slowest sector ({formatSectorTime(slowest.time)}s)
        </div>
      )}
    </div>
  );
}
