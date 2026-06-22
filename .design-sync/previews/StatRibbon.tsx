import { StatRibbon } from 'minmo-pitwall-ui';

// detail span은 데스크톱에서 숨겨지는 게 원본 디자인. value(racing 폰트)가 핵심.
const surface = { background: '#131314', padding: 16, borderRadius: 4, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 };

export function Default() {
  return (
    <div style={surface}>
      <StatRibbon label="Last Lap" value="1:24.318" detail="-0.214 vs best" tone="primary" />
    </div>
  );
}

export function Tones() {
  const rows = [
    { label: 'Last Lap', value: '1:24.318', tone: 'primary' },
    { label: 'Gap Ahead', value: '+1.2s', tone: 'secondary' },
    { label: 'Best Lap', value: '1:23.904', tone: 'tertiary' },
    { label: 'Position', value: 'P4', tone: 'neutral' },
  ];
  return (
    <div style={surface}>
      {rows.map((r) => (
        <StatRibbon key={r.tone} label={r.label} value={r.value} detail="" tone={r.tone} />
      ))}
    </div>
  );
}

export function Dense() {
  return (
    <div style={surface}>
      <StatRibbon label="Tyre Age" value="18 laps" detail="" tone="tertiary" dense />
      <StatRibbon label="Fuel" value="34.2 kg" detail="" tone="primary" dense />
    </div>
  );
}
