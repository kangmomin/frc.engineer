const wrapStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  minWidth: 60,
};

const labelStyle: React.CSSProperties = {
  fontFamily: 'var(--font-body)',
  fontSize: 10,
  color: 'var(--text-secondary)',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
};

const valueStyle: React.CSSProperties = {
  fontFamily: 'var(--font-racing)',
  fontSize: 13,
  color: 'var(--text-primary)',
};

interface SetupValueProps {
  label: string;
  value: string | number;
  unit?: string;
  color?: string;
}

export function SetupValue({ label, value, unit, color }: SetupValueProps) {
  return (
    <div style={wrapStyle}>
      <span style={labelStyle}>{label}</span>
      <span style={{ ...valueStyle, color: color || 'var(--text-primary)' }}>
        {value}{unit ? ` ${unit}` : ''}
      </span>
    </div>
  );
}
