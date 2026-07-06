import type { DriverInfo } from '../../../types/telemetry';

/**
 * 3글자 방송용 드라이버 코드 파생.
 *
 * driver.index 오름차순으로 순회한다(포지션 기준이 아님) — 순위는 랩마다 바뀌므로
 * 포지션 기준 순회 시 동명 충돌 dedup 결과(VER/VE2 등)가 랩마다 뒤바뀌는 깜빡임이
 * 생긴다. index는 세션 내내 고정이므로 안정적인 코드 배정을 보장한다.
 *
 * 알고리즘: 이름 마지막 토큰 → 유니코드 문자/숫자 외 제거 → 대문자 3글자.
 * 동일 3글자(base) 충돌 시, 두 번째 이후 등장은 base.slice(0,2) + 등장순번으로 dedup.
 * 정제 후 빈 문자열이면(빈 이름/기호만인 이름) `C{index}`(2자리 zero-pad)로 대체.
 */
export function deriveDriverCodes(drivers: DriverInfo[]): Map<number, string> {
  const ordered = [...drivers].sort((a, b) => a.index - b.index);
  const baseOccurrences = new Map<string, number>();
  const codes = new Map<number, string>();

  for (const driver of ordered) {
    const tokens = driver.name.trim().split(/\s+/).filter(Boolean);
    const lastToken = tokens[tokens.length - 1] ?? '';
    const cleaned = lastToken.replace(/[^\p{L}\p{N}]/gu, '').toUpperCase();
    const base = cleaned.slice(0, 3);

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
