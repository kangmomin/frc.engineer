import { TrackStrip } from 'minmo-pitwall-ui';

// 트랙 전장을 1차원으로 편 막대 — 섹터 3분할 + T{n} 코너 마커 + 드라이버 위치 동그라미.
// 가로로 긴 풀폭 컴포넌트라 cfg.overrides.TrackStrip = { cardMode: 'column' }.
const surface = { background: '#131314', padding: 20, borderRadius: 4, minWidth: 560, display: 'flex', flexDirection: 'column', gap: 24 };

// 몬차 근사 데이터 (시안용 mock — 실측 아님). T1/T2, T4/T5, T8-T10 시케인의 라벨 겹침 회피 확인용.
const MONZA_CORNERS = [
  { number: 1, distance: 620 },
  { number: 2, distance: 700 },
  { number: 3, distance: 1120 },
  { number: 4, distance: 1850 },
  { number: 5, distance: 1930 },
  { number: 6, distance: 2270 },
  { number: 7, distance: 2560 },
  { number: 8, distance: 3540 },
  { number: 9, distance: 3620 },
  { number: 10, distance: 3700 },
  { number: 11, distance: 4880 },
];

export function Default() {
  return (
    <div style={surface}>
      <TrackStrip
        trackLength={5793}
        sectorSplits={[1930, 3800]}
        corners={MONZA_CORNERS}
        drivers={[
          { code: 'VER', distance: 1450, color: '#3671c6', focused: true },
          { code: 'LEC', distance: 1615, color: '#e8002d' },
          { code: 'PIA', distance: 240, color: '#ff8000' },
          { code: 'NOR', distance: 2540, color: '#ff8000' },
          { code: 'HAM', distance: 3120, color: '#27f4d2' },
          { code: 'ALO', distance: 4390, color: '#229971' },
          { code: 'RUS', distance: 5210, color: '#27f4d2' },
        ]}
      />
    </div>
  );
}

// 잔트보르트 근사 — 코너 14개 밀집 트랙 + 백마커 트래픽 + 핏레인 2대(반투명).
const ZANDVOORT_CORNERS = [
  { number: 1, distance: 260 },
  { number: 2, distance: 480 },
  { number: 3, distance: 780 },
  { number: 4, distance: 1080 },
  { number: 5, distance: 1290 },
  { number: 6, distance: 1480 },
  { number: 7, distance: 1830 },
  { number: 8, distance: 2010 },
  { number: 9, distance: 2320 },
  { number: 10, distance: 2610 },
  { number: 11, distance: 2900 },
  { number: 12, distance: 3280 },
  { number: 13, distance: 3680 },
  { number: 14, distance: 4030 },
];

export function CrowdedField() {
  return (
    <div style={surface}>
      <TrackStrip
        trackLength={4259}
        sectorSplits={[1420, 2890]}
        corners={ZANDVOORT_CORNERS}
        drivers={[
          { code: 'NOR', distance: 2450, color: '#ff8000', focused: true },
          { code: 'VER', distance: 2510, color: '#3671c6' },
          { code: 'LEC', distance: 2380, color: '#e8002d' },
          { code: 'HAM', distance: 1140, color: '#27f4d2' },
          { code: 'RUS', distance: 1190, color: '#27f4d2' },
          { code: 'SAI', distance: 780, color: '#64c4ff' },
          { code: 'ALB', distance: 3420, color: '#64c4ff' },
          { code: 'ALO', distance: 3980, color: '#229971' },
          { code: 'GAS', distance: 340, color: '#0093cc' },
          { code: 'TSU', distance: 4180, color: '#6692ff' },
          { code: 'OCO', distance: 60, color: '#0093cc', inPit: true },
          { code: 'STR', distance: 4240, color: '#229971', inPit: true },
        ]}
      />
    </div>
  );
}

// tone 4종 — focused 드라이버는 color를 생략해 tone 액센트 fill로 차이를 드러낸다.
export function Tones() {
  const corners = [
    { number: 1, distance: 480 },
    { number: 2, distance: 1150 },
    { number: 3, distance: 2050 },
    { number: 4, distance: 2900 },
  ];
  return (
    <div style={surface}>
      {['primary', 'secondary', 'tertiary', 'neutral'].map((tone) => (
        <div key={tone} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#849396' }}>
            {tone}
          </span>
          <TrackStrip
            trackLength={3600}
            sectorSplits={[1200, 2400]}
            corners={corners}
            tone={tone}
            drivers={[
              { code: 'MIN', distance: 1560, focused: true },
              { code: 'GAS', distance: 620, color: '#0093cc' },
              { code: 'SAI', distance: 3050, color: '#64c4ff' },
            ]}
          />
        </div>
      ))}
    </div>
  );
}
