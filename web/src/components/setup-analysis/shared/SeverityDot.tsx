import type { Severity } from '../SetupCard';

const colors: Record<Severity, string> = {
  green: '#00ff00',
  yellow: '#ffcc00',
  red: '#e10600',
};

export function SeverityDot({ severity }: { severity: Severity }) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: colors[severity],
        flexShrink: 0,
      }}
    />
  );
}
