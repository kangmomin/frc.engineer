import { PanelTitle } from 'minmo-pitwall-ui';

// 다크 패널 위에서 쓰이는 컴포넌트라 실제 사용처처럼 다크 surface로 감싼다.
const surface = { background: '#131314', padding: 16, borderRadius: 4, minWidth: 0 };
const tones = ['primary', 'secondary', 'tertiary', 'neutral'];

export function Default() {
  return (
    <div style={surface}>
      <PanelTitle title="Sector Times" tone="primary" detail="Lap 24" />
    </div>
  );
}

export function Tones() {
  return (
    <div style={{ ...surface, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {tones.map((t) => (
        <PanelTitle key={t} title={`${t} tone`} tone={t} detail="marker" />
      ))}
    </div>
  );
}

export function WithEndContent() {
  return (
    <div style={surface}>
      <PanelTitle
        title="Tyre Strategy"
        tone="tertiary"
        detail="Stint 2"
        endContent={
          <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 800, fontStyle: 'italic', color: '#cdff13', fontSize: 18 }}>
            P3
          </span>
        }
      />
    </div>
  );
}
