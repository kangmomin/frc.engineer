// MultiViewer 서킷 API에서 코너(번호 + 랩 대비 비율) 데이터를 받아
// src/constants/trackCorners.data.ts 를 재생성한다. 수동 실행 전용(빌드타임 아님):
//
//   node scripts/fetch-track-corners.mjs        (web/ 어디서 실행해도 무방)
//
// 거리는 절대 미터가 아니라 랩 대비 비율(pct)로 저장한다 — 런타임에 게임의
// session.trackLength 를 곱해 사용하므로 실측/게임 트랙 길이 차이가 흡수된다.
// API 는 요청 연도 데이터가 없으면 보유한 최신 빈티지로 폴백하므로, 실제 반환된
// year 를 트랙별 주석으로 기록한다.

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API_BASE = 'https://api.multiviewer.app/api/v1/circuits';
const REQUEST_YEAR = 2025;
const OUT_PATH = join(dirname(fileURLToPath(import.meta.url)), '../src/constants/trackCorners.data.ts');

// canonical trackId(internal/tracks/names.go) → MultiViewer circuitKey.
// 리버스 3종(39-41)과 Madring(42)은 공식 코너 데이터 소스가 없어 의도적으로 제외.
const TRACKS = [
  { trackId: 0, name: 'Melbourne', circuitKey: 10 },
  { trackId: 2, name: 'Shanghai', circuitKey: 49 },
  { trackId: 3, name: 'Sakhir', circuitKey: 63 },
  { trackId: 4, name: 'Catalunya', circuitKey: 15 },
  { trackId: 5, name: 'Monte Carlo', circuitKey: 22 },
  { trackId: 6, name: 'Montreal', circuitKey: 23 },
  { trackId: 7, name: 'Silverstone', circuitKey: 2 },
  { trackId: 8, name: 'Hungaroring', circuitKey: 4 },
  { trackId: 9, name: 'Spa-Francorchamps', circuitKey: 7 },
  { trackId: 10, name: 'Monza', circuitKey: 39 },
  { trackId: 11, name: 'Singapore', circuitKey: 61 },
  { trackId: 12, name: 'Suzuka', circuitKey: 46 },
  { trackId: 13, name: 'Yas Marina', circuitKey: 70 },
  { trackId: 14, name: 'Austin', circuitKey: 9 },
  { trackId: 16, name: 'Interlagos', circuitKey: 14 },
  { trackId: 17, name: 'Spielberg', circuitKey: 19 },
  { trackId: 19, name: 'Mexico City', circuitKey: 65 },
  { trackId: 20, name: 'Baku', circuitKey: 144 },
  { trackId: 23, name: 'Zandvoort', circuitKey: 55 },
  { trackId: 24, name: 'Imola', circuitKey: 6 },
  { trackId: 25, name: 'Jeddah', circuitKey: 149 },
  { trackId: 26, name: 'Miami', circuitKey: 151 },
  { trackId: 27, name: 'Losail', circuitKey: 150 },
  { trackId: 28, name: 'Las Vegas', circuitKey: 152 },
];

function pathLength(xs, ys) {
  let total = 0;
  for (let i = 1; i < xs.length; i++) {
    total += Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
  }
  return total;
}

// 쓰기 전 불변식 검증 — 위반 시 파일을 만들지 않고 즉시 중단한다.
// 코너 번호는 순증가가 아니라 "비감소"다: 일부 빈티지(예: Hungaroring 2021)는
// 같은 번호의 이중 apex 를 원본 그대로 노출하며, 이를 가공 없이 유지한다.
function validate(name, corners) {
  if (corners.length === 0) throw new Error(`${name}: no corners`);
  for (let i = 0; i < corners.length; i++) {
    const { n, pct } = corners[i];
    if (!Number.isInteger(n) || n < 1) throw new Error(`${name}: invalid corner number ${n}`);
    if (!(pct > 0 && pct < 1)) throw new Error(`${name}: pct out of (0,1): ${pct}`);
    if (i > 0 && pct <= corners[i - 1].pct) throw new Error(`${name}: pct not strictly increasing at index ${i}`);
    if (i > 0 && n < corners[i - 1].n) throw new Error(`${name}: corner numbers decreasing at index ${i}`);
  }
}

const entries = [];
for (const { trackId, name, circuitKey } of TRACKS) {
  const res = await fetch(`${API_BASE}/${circuitKey}/${REQUEST_YEAR}`);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const data = await res.json();

  const total = pathLength(data.x, data.y);
  if (!(total > 0)) throw new Error(`${name}: invalid outline path length`);

  const corners = [...data.corners]
    .sort((a, b) => a.length - b.length)
    .map((c) => ({ n: c.number, pct: +(c.length / total).toFixed(4) }));
  validate(name, corners);

  entries.push({ trackId, name, circuitKey, year: data.year, corners });
  console.log(`${name.padEnd(18)} trackId=${trackId} circuitKey=${circuitKey} year=${data.year} corners=${corners.length}`);
}

entries.sort((a, b) => a.trackId - b.trackId);

const lines = [
  '// GENERATED FILE — do not edit; regenerate: node scripts/fetch-track-corners.mjs',
  `// Source: ${API_BASE}/{circuitKey}/{year} (requested year ${REQUEST_YEAR}; per-track returned vintage below).`,
  '// pct = 코너 apex 의 랩 대비 비율(스타트라인 기준) — 런타임에 session.trackLength(m)를 곱해 사용.',
  '// 리버스 트랙(39-41)·Madring(42)은 공식 코너 데이터가 존재하지 않아 의도적으로 부재 (fabrication 금지).',
  '',
  'export interface TrackCornerPct {',
  '  /** 공식 코너 번호 (이중 apex 는 같은 번호가 연속 등장할 수 있음). */',
  '  n: number;',
  '  /** 랩 대비 비율 (0,1) 개구간, 오름차순. */',
  '  pct: number;',
  '}',
  '',
  '/** canonical trackId → 코너 apex 목록 (랩 비율 오름차순). */',
  'export const TRACK_CORNER_PCTS: Record<number, readonly TrackCornerPct[]> = {',
];
for (const e of entries) {
  lines.push(`  // trackId ${e.trackId} · ${e.name} · circuitKey ${e.circuitKey} · MultiViewer year ${e.year}`);
  const body = e.corners.map((c) => `{ n: ${c.n}, pct: ${c.pct} }`).join(', ');
  lines.push(`  ${e.trackId}: [${body}],`);
}
lines.push('};', '');

writeFileSync(OUT_PATH, lines.join('\n'));
console.log(`\nwrote ${OUT_PATH} (${entries.length} tracks)`);
