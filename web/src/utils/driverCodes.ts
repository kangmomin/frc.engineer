import type { DriverInfo } from '../types/telemetry';

/**
 * 3글자 드라이버 코드 파생 공유 모듈(FIX-5). PitWall(leaderboardRows/myCar)과
 * Broadcast(BroadcastView)가 각자 다른 이름 정제/폴백 로직을 갖고 있던 것을 하나로 합쳐,
 * RACE/WORLD 탭 간 동일 드라이버의 코드 표기가 어긋나던 불일치를 없앤다.
 *
 * 알고리즘: 이름 마지막 토큰 → 유니코드 문자/숫자 외 제거 → 대문자 3글자.
 */
function extractBase(name: string): string {
  const trimmed = name?.trim() ?? '';
  if (!trimmed) return '';
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  const lastToken = tokens[tokens.length - 1] ?? '';
  return lastToken.replace(/[^\p{L}\p{N}]/gu, '').toUpperCase().slice(0, 3);
}

/**
 * 전체 드라이버 목록 → index별 코드 Map. driver.index 오름차순으로 순회한다(포지션 기준이
 * 아님) — 순위는 랩마다 바뀌므로 포지션 기준 순회 시 동명 충돌 dedup 결과(VER/VE2 등)가
 * 랩마다 뒤바뀌는 깜빡임이 생긴다. index는 세션 내내 고정이므로 안정적인 코드 배정을 보장한다.
 *
 * 동일 3글자(base) 충돌 시, 두 번째 이후 등장은 base.slice(0,2) + 등장순번으로 dedup.
 * 정제 후 빈 문자열이면(빈 이름/기호만인 이름) `C{index}`(2자리 zero-pad)로 대체.
 */
export function deriveDriverCodes(drivers: DriverInfo[]): Map<number, string> {
  const ordered = [...drivers].sort((a, b) => a.index - b.index);
  const baseOccurrences = new Map<string, number>();
  const codes = new Map<number, string>();

  for (const driver of ordered) {
    const base = extractBase(driver.name);

    let code: string;
    if (base.length === 0) {
      code = `C${String(driver.index).padStart(2, '0')}`;
    } else {
      const priorCount = baseOccurrences.get(base) ?? 0;
      code = priorCount === 0 ? base : `${base.slice(0, 2)}${priorCount + 1}`;
      baseOccurrences.set(base, priorCount + 1);
    }

    codes.set(driver.index, code);
  }

  return codes;
}

/**
 * 단발 이름 → 코드 파생(dedup 없음). 현재 drivers 목록에 없는 드라이버(예: 세션 중 퇴장한
 * 드라이버의 과거 race-control 알림)를 이름만으로 표기해야 할 때 쓴다 — deriveDriverCodes와
 * 동일한 extractBase를 공유해 이름 정제 결과가 항상 일치한다.
 */
export function codeFromDriverName(name: string): string {
  return extractBase(name) || '—';
}
