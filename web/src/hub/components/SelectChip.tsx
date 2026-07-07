// Shared labeled <select> chip used by the leaderboard and market track/format
// pickers, so both screens select context the same way.
import type { HubTheme } from '../theme';

const MONO = "'JetBrains Mono',monospace";

export interface SelectOption {
  value: string;
  label: string;
}

export function SelectChip({ t, label, value, options, onChange }: {
  t: HubTheme;
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
}) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, background: t.panel, border: `1px solid ${t.line}`, borderRadius: 8, padding: '8px 13px', fontSize: 12, color: t.t1, cursor: 'pointer' }}>
      <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '.1em', color: t.t3 }}>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ background: 'transparent', border: 0, color: t.t1, fontSize: 12, fontFamily: 'inherit', cursor: 'pointer', outline: 'none' }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} style={{ color: '#111' }}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}
