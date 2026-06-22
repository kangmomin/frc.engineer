import { WeatherIcon } from 'minmo-pitwall-ui';

// 아이콘은 100%×100% + currentColor라 부모가 크기·색을 줘야 보인다(표준 사용은 작은 박스 안).
const surface = { background: '#131314', padding: 16, borderRadius: 4, minWidth: 0 };
const cellStyle = { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 };
const cap = { fontFamily: "'Inter', sans-serif", fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#849396' };

export function States() {
  const states = ['clear', 'light cloud', 'overcast', 'storm', 'rain'];
  return (
    <div style={{ ...surface, display: 'flex', gap: 18, flexWrap: 'wrap' }}>
      {states.map((s) => (
        <div key={s} style={cellStyle}>
          <div style={{ width: 28, height: 28, color: '#00e5ff' }}>
            <WeatherIcon weather={s} />
          </div>
          <span style={cap}>{s}</span>
        </div>
      ))}
    </div>
  );
}

export function Forecast() {
  // 심각도별 색을 입힌 랩 구간 예보 스트립.
  const strip = [
    { w: 'clear', c: '#cdff13', lap: 'L12' },
    { w: 'light cloud', c: '#00e5ff', lap: 'L24' },
    { w: 'overcast', c: '#c3f5ff', lap: 'L36' },
    { w: 'storm', c: '#ff525c', lap: 'L48' },
  ];
  return (
    <div style={{ ...surface, display: 'flex', gap: 16 }}>
      {strip.map((s) => (
        <div key={s.lap} style={cellStyle}>
          <div style={{ width: 26, height: 26, color: s.c }}>
            <WeatherIcon weather={s.w} />
          </div>
          <span style={cap}>{s.lap}</span>
        </div>
      ))}
    </div>
  );
}
