import type { Severity } from '../SetupCard';

const borderColors: Record<Severity, string> = {
  green: 'rgba(0, 255, 0, 0.3)',
  yellow: 'rgba(255, 204, 0, 0.3)',
  red: 'rgba(225, 6, 0, 0.3)',
};

const bgColors: Record<Severity, string> = {
  green: 'rgba(0, 255, 0, 0.05)',
  yellow: 'rgba(255, 204, 0, 0.05)',
  red: 'rgba(225, 6, 0, 0.05)',
};

interface RecommendationRowProps {
  severity: Severity;
  text: string;
}

export function RecommendationRow({ severity, text }: RecommendationRowProps) {
  return (
    <div
      style={{
        padding: '6px 12px',
        borderLeft: `3px solid ${borderColors[severity]}`,
        background: bgColors[severity],
        fontFamily: 'var(--font-body)',
        fontSize: 11,
        color: 'var(--text-primary)',
      }}
    >
      {text}
    </div>
  );
}
