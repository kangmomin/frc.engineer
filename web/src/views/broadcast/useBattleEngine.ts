import { useEffect, useRef, useState } from 'react';
import type { DriverInfo } from '../../types/telemetry';
import { driverCanArmDrs } from '../../utils/raceDisplay';
import { battleConfidence, ratePerLapMs, rangeLabel, trendFromSlope } from './battleMath';

const WINDOW_MS = 25_000;
const BASELINE_MS = 4_000;
const MAX_SAMPLES = 128;
const STALE_MS = 5_000;
const ENTER_MS = 1_000;
const EXIT_MS = 1_200;
const MAX_BATTLES = 4;
// [Assumption] ratePerLapMs 환산에 필요한 "랩 소요시간(초)". 훅 인자에 랩타임이 없어
// defender/attacker의 실측 lastLapTime(ms)을 우선 사용하고, 레이스 극초반(둘 다 0)만
// 임의 F1 평균 랩타임(90s)으로 폴백한다.
const DEFAULT_LAP_SEC = 90;

export type BattleTrend = 'closing' | 'opening' | 'stable' | 'unknown';

export interface BattleInfo {
  key: string;
  forPosition: number;
  defenderIndex: number;
  attackerIndex: number;
  gapMs: number;
  trend: BattleTrend;
  ratePerLapMs: number | null;
  range: { kind: 'OVT' | 'DRS' | 'CHASE'; text: string };
  confidencePct: number | null;
  predictionText: string;
}

interface GapSample {
  t: number;
  gapMs: number;
}

interface PairHistory {
  samples: GapSample[];
  active: boolean;
  lastSeenAt: number;
}

function predictionTextForConfidence(confidencePct: number): string {
  if (confidencePct >= 70) return 'Overtake likely soon';
  if (confidencePct >= 45) return 'Pressure building';
  if (confidencePct >= 25) return 'Defender in control';
  return 'Defence holds';
}

function estimateLapSec(defender: DriverInfo, attacker: DriverInfo): number {
  if (defender.lastLapTime > 0) return defender.lastLapTime / 1000;
  if (attacker.lastLapTime > 0) return attacker.lastLapTime / 1000;
  return DEFAULT_LAP_SEC;
}

function isSafetyCarActive(safetyCar: string | undefined): boolean {
  return safetyCar === 'full' || (safetyCar?.startsWith('virtual') ?? false);
}

/**
 * 풀필드 배틀 엔진.
 *
 * 위치정렬 인접쌍마다 deltaToCarInFront 히스토리(25s 윈도우)를 단일 Map ref에 쌓아
 * slope → trend/ratePerLapMs를 계산하고, 신뢰도·레인지를 붙여 상위 MAX_BATTLES개를
 * gap 오름차순으로 골라 forPosition 오름차순으로 정렬해 반환한다.
 *
 * 훅 규칙(hook 수 상수) 준수를 위해 페어별 useState를 두지 않고 단일 Map ref +
 * 단일 출력 state만 사용한다. effect는 2개: (1) sessionKey/epoch 변경 시 전체 리셋,
 * (2) drivers 변경(=매 텔레메트리 프레임)마다 재계산.
 *
 * 핏/랩다운(currentLapNum 불일치) 쌍은 제외한다. 제외 여부의 진입/이탈에는
 * 1s/1.2s 히스테리시스를 적용해 순간적인 핏/랩 플래그 흔들림으로 배틀이
 * 깜빡이지 않게 한다. 더 이상 위치상 인접하지 않게 된 쌍은 5s간 관측되지
 * 않으면 히스토리에서 완전히 제거한다(stale sweep).
 */
export function useBattleEngine(
  drivers: DriverInfo[],
  sessionKey: string,
  epoch: number,
  is2026: boolean,
  safetyCar: string | undefined,
): BattleInfo[] {
  const historyRef = useRef<Map<string, PairHistory>>(new Map());
  const [battles, setBattles] = useState<BattleInfo[]>([]);

  // 세션 변경/리스타트·리플레이 rewind(epoch bump) 시 히스토리 전체 리셋.
  useEffect(() => {
    historyRef.current = new Map();
    setBattles([]);
  }, [sessionKey, epoch]);

  useEffect(() => {
    if (drivers.length < 2) {
      setBattles([]);
      return;
    }

    const now = Date.now();
    const history = historyRef.current;
    const sorted = [...drivers].sort((a, b) => a.position - b.position);
    const scActive = isSafetyCarActive(safetyCar);

    const frameKeys = new Set<string>();
    const candidates: BattleInfo[] = [];

    for (let i = 1; i < sorted.length; i++) {
      const defender = sorted[i - 1];
      const attacker = sorted[i];
      const key = `${defender.index}-${attacker.index}`;
      frameKeys.add(key);

      const liveGapMs = attacker.deltaToCarInFront;
      const excluded =
        defender.pitStatus > 0 ||
        attacker.pitStatus > 0 ||
        defender.currentLapNum !== attacker.currentLapNum ||
        liveGapMs === undefined;

      let h = history.get(key);
      if (!h) {
        h = { samples: [], active: false, lastSeenAt: now };
        history.set(key, h);
      }
      h.lastSeenAt = now;

      // gap-히스테리시스: 진입은 gap ≤ ENTER_MS(1s, 사정권), 유지는 gap ≤ EXIT_MS(1.2s)로
      // 1s 경계 플리커를 완충. 핏/랩다운/무데이터 쌍은 제외하고 즉시 비활성화·샘플 폐기.
      const threshold = h.active ? EXIT_MS : ENTER_MS;
      if (!excluded && liveGapMs !== undefined && liveGapMs <= threshold) {
        h.active = true;
        h.samples.push({ t: now, gapMs: liveGapMs });
        while (h.samples.length > 0 && now - h.samples[0].t > WINDOW_MS) h.samples.shift();
        if (h.samples.length > MAX_SAMPLES) h.samples.splice(0, h.samples.length - MAX_SAMPLES);
      } else {
        h.active = false;
        h.samples = [];
      }

      if (!h.active || h.samples.length === 0) continue;

      // slope: 가장 오래된 샘플이 BASELINE_MS 이상 지난 경우에만 사용(짧은 노이즈 윈도우 배제).
      const newest = h.samples[h.samples.length - 1];
      const oldest = h.samples[0];
      let rate: number | null = null;
      let trend: BattleTrend = 'unknown';

      if (newest.t - oldest.t >= BASELINE_MS) {
        const dtSec = (newest.t - oldest.t) / 1000;
        const slopeMsPerSec = dtSec > 0 ? (newest.gapMs - oldest.gapMs) / dtSec : 0;
        rate = ratePerLapMs(slopeMsPerSec, estimateLapSec(defender, attacker));
        trend = trendFromSlope(slopeMsPerSec);
      }

      const currentGapMs = liveGapMs ?? newest.gapMs;
      const canArmDrs = driverCanArmDrs(attacker, is2026);
      // trend이 stable(±40ms/s deadband 내)이면 rate를 신뢰도에 반영하지 않는다: 짧은 윈도우의
      // slope를 랩당(≈90s)으로 외삽하면 노이즈 수준(±9ms/s)에도 rateScore가 포화돼 "Gap stable
      // 인데 Overtake likely soon" 모순이 생긴다. closing/opening만 rate를 반영(stable은 0=중립).
      const confRate = trend === 'stable' ? 0 : rate;
      const confidencePct = battleConfidence(currentGapMs, confRate, canArmDrs);
      const range = rangeLabel(currentGapMs, is2026, attacker.overtakeAvailable);
      const predictionText =
        rate === null ? 'building read' : predictionTextForConfidence(confidencePct ?? 0);

      let info: BattleInfo = {
        key,
        forPosition: defender.position,
        defenderIndex: defender.index,
        attackerIndex: attacker.index,
        gapMs: currentGapMs,
        trend,
        ratePerLapMs: rate,
        range,
        confidencePct,
        predictionText,
      };

      if (scActive) {
        info = {
          ...info,
          trend: 'stable',
          ratePerLapMs: null,
          confidencePct: null,
          predictionText: 'SC — gaps neutralised',
        };
      }

      candidates.push(info);
    }

    // stale sweep: 이번 프레임에 인접쌍으로 등장하지 않은 채 STALE_MS 경과한 항목 제거.
    for (const [key, h] of history) {
      if (!frameKeys.has(key) && now - h.lastSeenAt > STALE_MS) {
        history.delete(key);
      }
    }

    const top = candidates
      .sort((a, b) => a.gapMs - b.gapMs)
      .slice(0, MAX_BATTLES)
      .sort((a, b) => a.forPosition - b.forPosition);

    setBattles(top);
    // drivers 참조가 바뀔 때(=매 텔레메트리 프레임)만 재계산한다. is2026/safetyCar는
    // 동일 프레임의 session에서 함께 갱신되므로 drivers 변경에 자연히 동기화되고,
    // sessionKey/epoch는 별도 리셋 effect가 전담한다 — 의도적으로 deps에서 제외.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drivers]);

  return battles;
}
