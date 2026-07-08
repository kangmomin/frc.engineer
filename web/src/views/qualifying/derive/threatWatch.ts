import type { DriverTryState } from '../../../components/qualifying/tryStatus';
import type { DriverInfo } from '../../../types/telemetry';

/**
 * Threat Watch 후보 파생 — 플레이어가 트랙 밖(개러지/핏)일 때 My Lap의 앞뒤차 슬롯을
 * 대체할 "내 순위를 위협할 수 있는 트랙 위 차량" 상위 2대를 고른다.
 *
 * 랭킹(백엔드 internal/telemetry/qualifying_overlay.go fillQualifyingThreatsLocked와
 * 동일 의미 — 데이터 소스가 달라 동일 결과는 보장하지 않음):
 *   ① 포지션 위협(raw position > 플레이어 position — 내 뒤 순위만 나를 끌어내릴 수 있음)
 *   ② try tone: attack(TRY) > watch(BUILD) > standby(COOL)
 *   ③ raw position 오름차순  ④ index 오름차순(결정적 tiebreak)
 * 순위 비교는 게임 raw position 필드만 쓴다 — 입력 배열의 정렬 순서는 판정에 쓰지 않는다.
 * 내 뒤 차량이 전부 COOL이어도 표시한다("가장 가까운 라이벌이 안 밀고 있다"도 유효한 신호).
 */
export interface ThreatCar {
  driver: DriverInfo;
  tryState: DriverTryState | null;
  /** 후보 best − 플레이어 best. 둘 다 유효한 bestLapTime(>0)일 때만 — lastLapTime 폴백
   * 금지(아웃랩 타임이 위협 마진을 왜곡). 계산 불가면 null. */
  deltaMs: number | null;
}

const TONE_RANK: Record<DriverTryState['tone'], number> = { attack: 0, watch: 1, standby: 2 };

function toneRank(tryState: DriverTryState | null): number {
  return tryState ? TONE_RANK[tryState.tone] : 2;
}

function validBest(ms: number): boolean {
  return Number.isFinite(ms) && ms > 0;
}

export function deriveThreatCars(
  drivers: DriverInfo[],
  player: DriverInfo,
  tryMap: Map<number, DriverTryState>,
): ThreatCar[] {
  // 플레이어 순위를 모르면 위협 판정이 불가능하다(백엔드 발동 전제와 대칭).
  if (player.position <= 0) return [];

  const candidates = drivers
    .filter(
      (d) =>
        d.index !== player.index
        && d.pitStatus === 0
        && d.lapDistance >= 0
        // resultStatus는 Go DTO omitempty — 비활성(0)은 필드 부재(undefined)로 온다(classificationRows 선례).
        && ((d.resultStatus ?? 0) === 2 || (d.resultStatus ?? 0) === 3)
        && d.position > 0,
    )
    .map((d) => ({ driver: d, tryState: tryMap.get(d.index) ?? null }));

  candidates.sort((a, b) => {
    const aThreat = a.driver.position > player.position;
    const bThreat = b.driver.position > player.position;
    if (aThreat !== bThreat) return aThreat ? -1 : 1;
    const tone = toneRank(a.tryState) - toneRank(b.tryState);
    if (tone !== 0) return tone;
    if (a.driver.position !== b.driver.position) return a.driver.position - b.driver.position;
    return a.driver.index - b.driver.index;
  });

  const playerBest = validBest(player.bestLapTime) ? player.bestLapTime : 0;
  return candidates.slice(0, 2).map(({ driver, tryState }) => ({
    driver,
    tryState,
    deltaMs: playerBest > 0 && validBest(driver.bestLapTime) ? driver.bestLapTime - playerBest : null,
  }));
}
