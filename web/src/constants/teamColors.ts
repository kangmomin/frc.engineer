/**
 * F1 Team Colors
 * Team ID to color mapping based on official team colors.
 * 0-11: F1 25(0-10) + F1 26이 덧붙인 Cadillac(11) / 476-486: 2026 Season Pack
 */
export const TEAM_COLORS: Record<number, string> = {
  0: '#27f4d2',   // Mercedes
  1: '#e8002d',   // Ferrari
  2: '#3671c6',   // Red Bull Racing
  3: '#64c4ff',   // Williams
  4: '#229971',   // Aston Martin
  5: '#ff87bc',   // Alpine
  6: '#6692ff',   // RB
  7: '#b6babd',   // Haas
  8: '#ff8000',   // McLaren
  9: '#52e252',   // Kick Sauber
  10: '#f50537',  // Audi
  11: '#c8a25f',  // Cadillac (F1 26 라이브 실측 — 486과 같은 팀)
  255: '#6f7070', // Unknown/Safety Car
  // 2026 Season Pack team IDs
  476: '#27f4d2', // Mercedes '26
  477: '#e8002d', // Ferrari '26
  478: '#3671c6', // Red Bull Racing '26
  479: '#64c4ff', // Williams '26
  480: '#229971', // Aston Martin '26
  481: '#ff87bc', // Alpine '26
  482: '#6692ff', // RB '26
  483: '#b6babd', // Haas '26
  484: '#ff8000', // McLaren '26
  485: '#f50537', // Audi '26
  486: '#c8a25f', // Cadillac '26 (gold)
};

/**
 * Get team color by team ID
 * Returns default gray if team ID is not found
 */
export function getTeamColor(teamId: number): string {
  return TEAM_COLORS[teamId] ?? '#6f7070';
}

/**
 * Short team badges for the leaderboard driver cell. Same ID set as TEAM_NAMES
 * (0-11 / 255 / 476-486). 미매핑은 getTeamShort가 `T{id}`로 노출한다.
 */
export const TEAM_SHORT: Record<number, string> = {
  0: 'MER',
  1: 'FER',
  2: 'RBR',
  3: 'WIL',
  4: 'AST',
  5: 'ALP',
  6: 'RB',
  7: 'HAA',
  8: 'MCL',
  9: 'SAU',
  10: 'AUD',
  11: 'CAD',
  255: '—',
  // 2026 Season Pack team IDs
  476: 'MER',
  477: 'FER',
  478: 'RBR',
  479: 'WIL',
  480: 'AST',
  481: 'ALP',
  482: 'RB',
  483: 'HAA',
  484: 'MCL',
  485: 'AUD',
  486: 'CAD',
};

/**
 * Get short team badge by team ID.
 *
 * 매핑에 없는 ID는 '—'로 가리지 않고 `T{id}`로 그대로 노출한다. 게임이 새 팀 ID
 * 대역을 보내기 시작하면 '—'가 실제 값을 삼켜버려 원인 파악이 불가능했다
 * (hub의 teamIdentity()가 이미 `Team #${id}`로 같은 방침을 쓴다).
 * 다만 값 자체가 없는 경우(런타임 결측)는 'Tundefined'가 되지 않도록 '—'로 떨군다.
 */
export function getTeamShort(teamId: number): string {
  const known = TEAM_SHORT[teamId];
  if (known !== undefined) return known; // 255(무팀 센티넬)의 '—'도 이 경로
  if (!Number.isFinite(teamId)) return '—';
  return `T${teamId}`;
}

/**
 * Team names for display
 */
export const TEAM_NAMES: Record<number, string> = {
  0: 'Mercedes',
  1: 'Ferrari',
  2: 'Red Bull',
  3: 'Williams',
  4: 'Aston Martin',
  5: 'Alpine',
  6: 'RB',
  7: 'Haas',
  8: 'McLaren',
  9: 'Kick Sauber',
  10: 'Audi',
  11: 'Cadillac',
  255: 'Unknown',
  // 2026 Season Pack team IDs
  476: 'Mercedes',
  477: 'Ferrari',
  478: 'Red Bull',
  479: 'Williams',
  480: 'Aston Martin',
  481: 'Alpine',
  482: 'RB',
  483: 'Haas',
  484: 'McLaren',
  485: 'Audi',
  486: 'Cadillac',
};

export function getTeamName(teamId: number): string {
  return TEAM_NAMES[teamId] ?? 'Unknown';
}

/**
 * 로고 마크 식별자. F1 25/26(0-11)과 2026 Season Pack(476-486)이 같은 팀에 서로 다른
 * ID를 쓰므로, 마크를 고르기 전에 하나의 키로 정규화한다. 컬러/약어와 달리 마크는
 * ID가 아니라 '팀'에 종속되기 때문에 별도 테이블이 필요하다.
 */
export type TeamKey =
  | 'mercedes'
  | 'ferrari'
  | 'redbull'
  | 'williams'
  | 'aston'
  | 'alpine'
  | 'rb'
  | 'haas'
  | 'mclaren'
  | 'sauber'
  | 'audi'
  | 'cadillac';

const TEAM_KEYS: Record<number, TeamKey> = {
  0: 'mercedes',
  1: 'ferrari',
  2: 'redbull',
  3: 'williams',
  4: 'aston',
  5: 'alpine',
  6: 'rb',
  7: 'haas',
  8: 'mclaren',
  9: 'sauber',
  10: 'audi',
  11: 'cadillac',
  // 2026 Season Pack team IDs
  476: 'mercedes',
  477: 'ferrari',
  478: 'redbull',
  479: 'williams',
  480: 'aston',
  481: 'alpine',
  482: 'rb',
  483: 'haas',
  484: 'mclaren',
  485: 'audi',
  486: 'cadillac',
};

/**
 * F1 26에서 소속이 바뀐 팀 ID를 정규 ID로 접는다.
 *
 * 킥 자우버(9)는 F1 26에서 아우디가 됐다. 게임이 그 슬롯을 그대로 재사용하면
 * 2026 세션인데 'SAU'로 표시되므로 아우디(10)로 접는다. 반대로 F1 26이 아우디에
 * 새 ID(10)를 주고 9를 아예 안 보낼 수도 있는데, 그 경우 이 함수는 무동작이라
 * 어느 쪽이든 화면은 맞는다. 캐딜락(11)은 F1 25에 없던 팀이라 접을 대상이 없다.
 *
 * 색·약어·마크를 각각 분기하지 않고 ID 하나만 접는 이유: 세 테이블이 모두 같은
 * 키를 쓰므로 입구에서 한 번 정규화하면 하위는 손댈 필요가 없다.
 */
const TEAM_ID_2026: Record<number, number> = {
  9: 10, // Kick Sauber → Audi
};

/** 게임 버전에 따라 달라지는 팀 ID를 정규 ID로 접는다. F1 25는 원본 그대로. */
export function resolveTeamId(teamId: number, is2026: boolean): number {
  if (!is2026) return teamId;
  return TEAM_ID_2026[teamId] ?? teamId;
}

/** 팀 마크 키. 미매핑 ID와 255(무팀)는 null — 호출부가 중립 폴백을 그린다. */
export function getTeamKey(teamId: number): TeamKey | null {
  return TEAM_KEYS[teamId] ?? null;
}
