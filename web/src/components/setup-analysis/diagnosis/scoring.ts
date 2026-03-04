import type { Severity } from '../SetupCard';
import type { DriverInfo } from '../../../types/telemetry';

export type SymptomId =
  | 'understeer'
  | 'exitOversteer'
  | 'entryOversteer'
  | 'bottoming'
  | 'brakeLockup'
  | 'tyreOverheat';

export interface DiagnosisResult {
  id: SymptomId;
  weight: number;
  telemetryDetected: boolean;
  userSelected: boolean;
  confidence: 'high' | 'medium' | 'low';
  severity: Severity;
  title: string;
  cause: string;
  adjustments: { label: string; value: string }[];
}

interface SymptomDef {
  id: SymptomId;
  weight: number;
  title: string;
  detect: (d: DriverInfo) => boolean;
  cause: string;
  adjustments: { label: string; value: string }[];
}

function latestLap(d: DriverInfo) {
  const laps = d.setupAnalysis ?? [];
  return laps[laps.length - 1] ?? null;
}

function latestDynamics(d: DriverInfo) {
  const dyn = d.dynamics ?? [];
  return dyn[dyn.length - 1] ?? null;
}

const SYMPTOMS: SymptomDef[] = [
  {
    id: 'tyreOverheat',
    weight: 10,
    title: '타이어 과열',
    detect: (d) => {
      const lap = latestLap(d);
      return lap != null && lap.avgTyreInnerTemp.some((t) => t > 100);
    },
    cause: '타이어 내부 온도 과다 → 그립 저하 및 마모 가속',
    adjustments: [
      { label: 'Tyre Pressure', value: '과열 휠 -0.5 ~ -1.0 PSI' },
      { label: 'Camber', value: '해당 축 캠버 감소' },
      { label: '휠스핀 동반 시', value: 'Exit Oversteer 항목 병행 조정' },
    ],
  },
  {
    id: 'bottoming',
    weight: 7,
    title: '바텀아웃',
    detect: (d) => {
      const lap = latestLap(d);
      const floorDmg = d.damage?.floor ?? 0;
      return (lap != null && lap.bottomingPct > 10) || floorDmg > 10;
    },
    cause: '차체 바닥이 노면에 접촉 → 에어로 손실 및 플로어 손상',
    adjustments: [
      { label: 'Front Ride Height', value: '+2 ~ +3' },
      { label: 'Rear Ride Height', value: '+2 ~ +3' },
      { label: 'Front Suspension', value: '-2 (강하게)' },
      { label: 'Rear Suspension', value: '-2 (강하게)' },
    ],
  },
  {
    id: 'brakeLockup',
    weight: 5,
    title: '브레이크 락업',
    detect: (d) => {
      const lap = latestLap(d);
      return lap != null && (lap.frontLockupPct > 10 || lap.rearLockupPct > 10);
    },
    cause: '제동 시 휠 잠김 → 플랫스팟 발생 및 제동 거리 증가',
    adjustments: [
      { label: '프론트 락업 시', value: 'Brake Bias -1 ~ -2% (뒤쪽으로)' },
      { label: '리어 락업 시', value: 'Brake Bias +1 ~ +2% (앞쪽으로)' },
      { label: 'Brake Pressure', value: '-2 ~ -5%' },
    ],
  },
  {
    id: 'exitOversteer',
    weight: 4,
    title: '탈출 오버스티어',
    detect: (d) => {
      const lap = latestLap(d);
      return lap != null && lap.wheelspinPct > 15;
    },
    cause: '코너 탈출 시 휠스핀으로 인한 후방 불안정',
    adjustments: [
      { label: 'On-Throttle Diff', value: '-5%' },
      { label: 'Rear Suspension', value: '-1 ~ -2 (강하게)' },
      { label: 'Rear Tyre Pressure', value: '-0.5 PSI' },
    ],
  },
  {
    id: 'entryOversteer',
    weight: 3,
    title: '진입 오버스티어',
    detect: (d) => {
      const dyn = latestDynamics(d);
      return dyn != null && dyn.oversteerPct > 15;
    },
    cause: '코너 진입 시 트레일 브레이킹 중 후방 불안정',
    adjustments: [
      { label: 'Off-Throttle Diff', value: '+5%' },
      { label: 'Brake Bias', value: '+1 ~ +2% (앞쪽으로)' },
    ],
  },
  {
    id: 'understeer',
    weight: 3,
    title: '언더스티어',
    detect: (d) => {
      const dyn = latestDynamics(d);
      return dyn != null && dyn.understeerPct > 15;
    },
    cause: '프론트 그립 부족 → 코너에서 차가 바깥으로 밀림',
    adjustments: [
      { label: 'Front Wing', value: '+1 ~ +2' },
      { label: 'Front Anti-Roll Bar', value: '-1 ~ -2' },
      { label: 'Front Ride Height', value: '-1 ~ -2' },
    ],
  },
];

function confidence(telemetry: boolean, user: boolean): 'high' | 'medium' | 'low' {
  if (telemetry && user) return 'high';
  if (telemetry) return 'medium';
  return 'low';
}

function severity(conf: 'high' | 'medium' | 'low'): Severity {
  if (conf === 'high') return 'red';
  if (conf === 'medium') return 'yellow';
  return 'green';
}

export function diagnose(
  driver: DriverInfo,
  selectedSymptoms: Set<SymptomId>,
): DiagnosisResult[] {
  const results: DiagnosisResult[] = [];

  for (const s of SYMPTOMS) {
    const detected = s.detect(driver);
    const selected = selectedSymptoms.has(s.id);
    if (!detected && !selected) continue;

    const conf = confidence(detected, selected);
    results.push({
      id: s.id,
      weight: s.weight,
      telemetryDetected: detected,
      userSelected: selected,
      confidence: conf,
      severity: severity(conf),
      title: s.title,
      cause: s.cause,
      adjustments: s.adjustments,
    });
  }

  results.sort((a, b) => b.weight - a.weight);
  return results;
}

export const SYMPTOM_LIST: { id: SymptomId; label: string; desc: string }[] = [
  { id: 'understeer', label: '언더스티어', desc: '코너에서 바깥으로 밀림' },
  { id: 'exitOversteer', label: '탈출 오버스티어', desc: '탈출 시 뒷바퀴 미끄러짐' },
  { id: 'entryOversteer', label: '진입 오버스티어', desc: '진입 시 후방 불안정' },
  { id: 'bottoming', label: '바텀아웃', desc: '바닥이 노면에 긁힘' },
  { id: 'brakeLockup', label: '브레이크 락업', desc: '제동 시 휠 잠김' },
  { id: 'tyreOverheat', label: '타이어 과열', desc: '온도 한계 초과' },
];
