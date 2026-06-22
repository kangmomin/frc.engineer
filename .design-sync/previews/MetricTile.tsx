import { MetricTile } from 'minmo-pitwall-ui';

const surface = { background: '#131314', padding: 16, borderRadius: 4, minWidth: 0 };
const grid2 = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 };

export function Default() {
  return (
    <div style={surface}>
      <MetricTile label="Tyre Temp" value="92°C" tone="primary" note="Front Left" />
    </div>
  );
}

export function Tones() {
  const tiles = [
    { label: 'ERS Store', value: '4.0 MJ', tone: 'primary' },
    { label: 'Brake', value: '480°C', tone: 'secondary' },
    { label: 'DRS', value: 'Open', tone: 'tertiary' },
    { label: 'Gear', value: '7', tone: 'neutral' },
  ];
  return (
    <div style={{ ...surface, ...grid2 }}>
      {tiles.map((t) => (
        <MetricTile key={t.tone} label={t.label} value={t.value} tone={t.tone} note={`${t.tone} tone`} />
      ))}
    </div>
  );
}

export function Compact() {
  return (
    <div style={{ ...surface, ...grid2 }}>
      <MetricTile label="Lap" value="24/58" tone="primary" compact />
      <MetricTile label="Position" value="P4" tone="tertiary" compact />
      <MetricTile label="Pit Stops" value="1 stop" tone="secondary" compact />
      <MetricTile label="Compound" value="Soft" tone="neutral" compact />
    </div>
  );
}
