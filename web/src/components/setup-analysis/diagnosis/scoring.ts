import type { Severity } from '../SetupCard';
import type { DriverInfo } from '../../../types/telemetry';

// ── Types ──

export type SymptomId =
  | 'understeer'
  | 'exitOversteer'
  | 'entryOversteer'
  | 'bottoming'
  | 'brakeLockup'
  | 'tyreOverheat'
  | 'topSpeed'
  | 'tyreWear';

export interface Adjustment {
  label: string;
  current?: string;
  target?: string;
  delta: string;
  clamped?: boolean;
}

export interface DiagnosisResult {
  id: SymptomId;
  weight: number;
  telemetryDetected: boolean;
  userSelected: boolean;
  confidence: 'high' | 'medium' | 'low';
  severity: Severity;
  title: string;
  cause: string;
  adjustments: Adjustment[];
  rootCauses?: string[];
  warnings?: string[];
}

// ── Bounds ──

interface Bound {
  min: number;
  max: number;
  unit: string;
  decimals: number;
}

const BOUNDS: Record<string, Bound> = {
  frontWing:        { min: 1,     max: 50,   unit: '',     decimals: 0 },
  rearWing:         { min: 1,     max: 50,   unit: '',     decimals: 0 },
  diffOnThrottle:   { min: 50,    max: 100,  unit: '%',    decimals: 0 },
  diffOffThrottle:  { min: 50,    max: 100,  unit: '%',    decimals: 0 },
  frontSuspension:  { min: 1,     max: 11,   unit: '',     decimals: 0 },
  rearSuspension:   { min: 1,     max: 11,   unit: '',     decimals: 0 },
  frontAntiRollBar: { min: 1,     max: 11,   unit: '',     decimals: 0 },
  rearAntiRollBar:  { min: 1,     max: 11,   unit: '',     decimals: 0 },
  frontRideHeight:  { min: 1,     max: 35,   unit: '',     decimals: 0 },
  rearRideHeight:   { min: 1,     max: 70,   unit: '',     decimals: 0 },
  brakePressure:    { min: 50,    max: 100,  unit: '%',    decimals: 0 },
  engineBraking:    { min: 50,    max: 100,  unit: '%',    decimals: 0 },
  brakeBias:        { min: 50,    max: 70,   unit: '%',    decimals: 0 },
  frontCamber:      { min: -3.50, max: -2.50, unit: '°',   decimals: 2 },
  rearCamber:       { min: -2.00, max: -1.00, unit: '°',   decimals: 2 },
  frontToe:         { min: 0.00,  max: 0.15, unit: '°',    decimals: 2 },
  rearToe:          { min: 0.00,  max: 0.50, unit: '°',    decimals: 2 },
  tyrePressure:     { min: 20.0,  max: 27.0, unit: ' PSI', decimals: 1 },
};

// ── Helpers ──

function clampToBounds(key: string, value: number): { value: number; clamped: boolean } {
  const b = BOUNDS[key];
  if (!b) return { value, clamped: false };
  if (value < b.min) return { value: b.min, clamped: true };
  if (value > b.max) return { value: b.max, clamped: true };
  return { value, clamped: false };
}

function isExtreme(key: string, value: number): 'low' | 'high' | false {
  const b = BOUNDS[key];
  if (!b) return false;
  const range = b.max - b.min;
  if (value <= b.min + range * 0.1) return 'low';
  if (value >= b.max - range * 0.1) return 'high';
  return false;
}

function fmtVal(key: string, v: number): string {
  const b = BOUNDS[key];
  if (!b) return String(v);
  return v.toFixed(b.decimals) + b.unit;
}

function fmtDelta(key: string, delta: number): string {
  const b = BOUNDS[key];
  if (!b) return (delta > 0 ? '+' : '') + String(delta);
  return (delta > 0 ? '+' : '') + delta.toFixed(b.decimals) + b.unit;
}

function makeAdj(label: string, key: string, current: number | undefined, delta: number): Adjustment {
  if (current == null) {
    return { label, delta: fmtDelta(key, delta) };
  }
  const raw = current + delta;
  const { value: target, clamped } = clampToBounds(key, raw);
  return {
    label,
    current: fmtVal(key, current),
    target: fmtVal(key, target),
    delta: fmtDelta(key, delta),
    clamped: clamped || undefined,
  };
}

function getVal(d: DriverInfo, key: string): number | undefined {
  if (key === 'diffOnThrottle') return d.diffOnThrottle > 0 ? d.diffOnThrottle : undefined;
  if (key === 'diffOffThrottle') return d.diffOffThrottle > 0 ? d.diffOffThrottle : undefined;
  if (key === 'brakeBias') return d.brakeBias > 0 ? d.brakeBias : undefined;
  if (!d.setup) return undefined;
  const v = (d.setup as unknown as Record<string, unknown>)[key];
  return typeof v === 'number' ? v : undefined;
}

// ── Telemetry helpers ──

function latestLap(d: DriverInfo) {
  const laps = d.setupAnalysis ?? [];
  return laps[laps.length - 1] ?? null;
}

function latestDynamics(d: DriverInfo) {
  const dyn = d.dynamics ?? [];
  return dyn[dyn.length - 1] ?? null;
}

// ── Symptom Definitions ──

interface AdjResult {
  adjustments: Adjustment[];
  rootCauses: string[];
  warnings: string[];
}

interface SymptomDef {
  id: SymptomId;
  weight: number;
  title: string;
  detect: (d: DriverInfo) => boolean;
  cause: string;
  adjustments: (d: DriverInfo) => AdjResult;
}

const WHEEL_LABELS = ['FL', 'FR', 'RL', 'RR'];

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
    adjustments: (d) => {
      const adjs: Adjustment[] = [];
      const rootCauses: string[] = [];
      const warnings: string[] = [];
      const lap = latestLap(d);
      const pressures = d.setup?.tyrePressures;

      if (lap) {
        lap.avgTyreInnerTemp.forEach((t, i) => {
          if (t > 100) {
            const cur = pressures?.[i];
            adjs.push(makeAdj(`${WHEEL_LABELS[i]} Tyre Pressure`, 'tyrePressure', cur, -0.5));
            if (cur != null && isExtreme('tyrePressure', cur) === 'low') {
              rootCauses.push(`${WHEEL_LABELS[i]} 타이어 압력이 이미 최소치 근처입니다`);
            }
          }
        });
      } else {
        adjs.push(makeAdj('Tyre Pressure (과열 휠)', 'tyrePressure', undefined, -0.5));
      }

      adjs.push(makeAdj('On-Throttle Diff', 'diffOnThrottle', getVal(d, 'diffOnThrottle'), -5));
      adjs.push(makeAdj('Front Suspension', 'frontSuspension', getVal(d, 'frontSuspension'), -2));
      adjs.push(makeAdj('Rear Suspension', 'rearSuspension', getVal(d, 'rearSuspension'), -2));
      adjs.push(makeAdj('Front Anti-Roll Bar', 'frontAntiRollBar', getVal(d, 'frontAntiRollBar'), -2));
      adjs.push(makeAdj('Rear Anti-Roll Bar', 'rearAntiRollBar', getVal(d, 'rearAntiRollBar'), -2));

      if (adjs.some((a) => a.clamped)) {
        warnings.push('일부 파라미터가 한계에 도달하여 캠버/토 조정을 검토하세요');
      }
      warnings.push('서스펜션 소프트닝 시 바텀아웃 위험이 증가할 수 있습니다');

      return { adjustments: adjs, rootCauses, warnings };
    },
  },
  {
    id: 'tyreWear',
    weight: 2,
    title: '타이어 마모',
    detect: (d) => d.tireWear.length > 0 && Math.max(...d.tireWear) > 25,
    cause: '타이어 마모 속도 과다 → 스틴트 길이 제한',
    adjustments: (d) => {
      const adjs: Adjustment[] = [];
      const rootCauses: string[] = [];
      const warnings: string[] = [];
      const pressures = d.setup?.tyrePressures;

      const wear = d.tireWear;
      let added = false;
      wear.forEach((w, i) => {
        if (w > 20) {
          adjs.push(makeAdj(`${WHEEL_LABELS[i]} Tyre Pressure`, 'tyrePressure', pressures?.[i], -0.5));
          added = true;
        }
      });
      if (!added) {
        adjs.push(makeAdj('Tyre Pressure', 'tyrePressure', undefined, -0.5));
      }

      adjs.push(makeAdj('On-Throttle Diff', 'diffOnThrottle', getVal(d, 'diffOnThrottle'), -5));
      adjs.push(makeAdj('Front Suspension', 'frontSuspension', getVal(d, 'frontSuspension'), -2));
      adjs.push(makeAdj('Rear Suspension', 'rearSuspension', getVal(d, 'rearSuspension'), -2));
      adjs.push(makeAdj('Front Anti-Roll Bar', 'frontAntiRollBar', getVal(d, 'frontAntiRollBar'), -3));
      adjs.push(makeAdj('Rear Anti-Roll Bar', 'rearAntiRollBar', getVal(d, 'rearAntiRollBar'), -3));

      const onThr = getVal(d, 'diffOnThrottle');
      if (onThr != null && isExtreme('diffOnThrottle', onThr) === 'high') {
        rootCauses.push('On-Throttle Diff가 매우 높아 후방 마모를 가속합니다');
      }

      if (adjs.some((a) => a.clamped)) {
        warnings.push('한계 도달 파라미터가 있습니다. 드라이빙 스타일 조정을 검토하세요');
      }
      warnings.push('서스펜션/ARB 소프트닝 시 차체 안정성이 감소할 수 있습니다');

      return { adjustments: adjs, rootCauses, warnings };
    },
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
    adjustments: (d) => {
      const adjs: Adjustment[] = [];
      const rootCauses: string[] = [];
      const warnings: string[] = [];

      const fRh = getVal(d, 'frontRideHeight');
      const rRh = getVal(d, 'rearRideHeight');

      adjs.push(makeAdj('Front Ride Height', 'frontRideHeight', fRh, 3));
      adjs.push(makeAdj('Rear Ride Height', 'rearRideHeight', rRh, 3));
      adjs.push(makeAdj('Front Suspension', 'frontSuspension', getVal(d, 'frontSuspension'), -2));
      adjs.push(makeAdj('Rear Suspension', 'rearSuspension', getVal(d, 'rearSuspension'), -2));

      if (fRh != null && isExtreme('frontRideHeight', fRh) === 'low') {
        rootCauses.push('Front Ride Height가 매우 낮습니다');
      }
      if (rRh != null && isExtreme('rearRideHeight', rRh) === 'low') {
        rootCauses.push('Rear Ride Height가 매우 낮습니다');
      }

      if (adjs.some((a) => a.clamped)) {
        warnings.push('라이드 하이트가 한계입니다. 서스펜션 스티프닝으로 보상하세요');
      }
      warnings.push('라이드 하이트 증가 시 다운포스가 감소할 수 있습니다');

      return { adjustments: adjs, rootCauses, warnings };
    },
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
    adjustments: (d) => {
      const adjs: Adjustment[] = [];
      const rootCauses: string[] = [];
      const warnings: string[] = [];
      const lap = latestLap(d);
      const bias = getVal(d, 'brakeBias');
      const pressure = getVal(d, 'brakePressure');

      const frontLock = lap?.frontLockupPct ?? 0;
      const rearLock = lap?.rearLockupPct ?? 0;

      if (frontLock >= rearLock) {
        adjs.push(makeAdj('Brake Bias', 'brakeBias', bias, -2));
      } else {
        adjs.push(makeAdj('Brake Bias', 'brakeBias', bias, 2));
      }

      adjs.push(makeAdj('Brake Pressure', 'brakePressure', pressure, -3));

      if (bias != null && isExtreme('brakeBias', bias)) {
        rootCauses.push(`Brake Bias가 극단적 (${fmtVal('brakeBias', bias)}) 입니다`);
      }
      if (pressure != null && isExtreme('brakePressure', pressure) === 'high') {
        rootCauses.push('Brake Pressure가 매우 높습니다');
      }

      if (adjs.some((a) => a.clamped)) {
        warnings.push('브레이크 설정이 한계입니다. 제동 포인트 조정을 검토하세요');
      }

      return { adjustments: adjs, rootCauses, warnings };
    },
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
    adjustments: (d) => {
      const adjs: Adjustment[] = [];
      const rootCauses: string[] = [];
      const warnings: string[] = [];

      adjs.push(makeAdj('Front Wing', 'frontWing', getVal(d, 'frontWing'), -2));
      adjs.push(makeAdj('Rear Wing', 'rearWing', getVal(d, 'rearWing'), 2));
      adjs.push(makeAdj('Front Suspension', 'frontSuspension', getVal(d, 'frontSuspension'), 2));
      adjs.push(makeAdj('Front Anti-Roll Bar', 'frontAntiRollBar', getVal(d, 'frontAntiRollBar'), 2));
      adjs.push(makeAdj('Rear Suspension', 'rearSuspension', getVal(d, 'rearSuspension'), -2));
      adjs.push(makeAdj('Rear Anti-Roll Bar', 'rearAntiRollBar', getVal(d, 'rearAntiRollBar'), -2));
      adjs.push(makeAdj('On-Throttle Diff', 'diffOnThrottle', getVal(d, 'diffOnThrottle'), -5));

      const rw = getVal(d, 'rearWing');
      if (rw != null && isExtreme('rearWing', rw) === 'high') {
        rootCauses.push('Rear Wing이 이미 최대치 근처입니다');
      }
      const onThr = getVal(d, 'diffOnThrottle');
      if (onThr != null && isExtreme('diffOnThrottle', onThr) === 'high') {
        rootCauses.push('On-Throttle Diff가 매우 높아 휠스핀을 유발합니다');
      }

      if (adjs.some((a) => a.clamped)) {
        warnings.push('일부 파라미터가 한계에 도달했습니다');
      }
      warnings.push('리어 다운포스 증가 시 직선 속도가 감소할 수 있습니다');

      return { adjustments: adjs, rootCauses, warnings };
    },
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
    adjustments: (d) => {
      const adjs: Adjustment[] = [];
      const rootCauses: string[] = [];
      const warnings: string[] = [];

      adjs.push(makeAdj('Front Wing', 'frontWing', getVal(d, 'frontWing'), -2));
      adjs.push(makeAdj('Rear Wing', 'rearWing', getVal(d, 'rearWing'), 2));
      adjs.push(makeAdj('Front Suspension', 'frontSuspension', getVal(d, 'frontSuspension'), 2));
      adjs.push(makeAdj('Front Anti-Roll Bar', 'frontAntiRollBar', getVal(d, 'frontAntiRollBar'), 2));
      adjs.push(makeAdj('Rear Suspension', 'rearSuspension', getVal(d, 'rearSuspension'), -2));
      adjs.push(makeAdj('Rear Anti-Roll Bar', 'rearAntiRollBar', getVal(d, 'rearAntiRollBar'), -2));
      adjs.push(makeAdj('Off-Throttle Diff', 'diffOffThrottle', getVal(d, 'diffOffThrottle'), 5));
      adjs.push(makeAdj('Brake Bias', 'brakeBias', getVal(d, 'brakeBias'), 2));

      const offThr = getVal(d, 'diffOffThrottle');
      if (offThr != null && isExtreme('diffOffThrottle', offThr) === 'high') {
        rootCauses.push('Off-Throttle Diff가 매우 높습니다');
      }

      if (adjs.some((a) => a.clamped)) {
        warnings.push('일부 파라미터가 한계에 도달했습니다');
      }
      warnings.push('리어 안정성 증가 시 코너 진입 반응성이 감소할 수 있습니다');

      return { adjustments: adjs, rootCauses, warnings };
    },
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
    adjustments: (d) => {
      const adjs: Adjustment[] = [];
      const rootCauses: string[] = [];
      const warnings: string[] = [];

      adjs.push(makeAdj('Front Wing', 'frontWing', getVal(d, 'frontWing'), 2));
      adjs.push(makeAdj('Rear Wing', 'rearWing', getVal(d, 'rearWing'), -2));
      adjs.push(makeAdj('Front Suspension', 'frontSuspension', getVal(d, 'frontSuspension'), -2));
      adjs.push(makeAdj('Front Anti-Roll Bar', 'frontAntiRollBar', getVal(d, 'frontAntiRollBar'), -2));
      adjs.push(makeAdj('Rear Suspension', 'rearSuspension', getVal(d, 'rearSuspension'), 2));
      adjs.push(makeAdj('Rear Anti-Roll Bar', 'rearAntiRollBar', getVal(d, 'rearAntiRollBar'), 2));
      adjs.push(makeAdj('Off-Throttle Diff', 'diffOffThrottle', getVal(d, 'diffOffThrottle'), -5));

      const fw = getVal(d, 'frontWing');
      if (fw != null && isExtreme('frontWing', fw) === 'high') {
        rootCauses.push('Front Wing이 이미 최대치 근처입니다');
      }
      const rw = getVal(d, 'rearWing');
      if (rw != null && isExtreme('rearWing', rw) === 'low') {
        rootCauses.push('Rear Wing이 이미 최소치 근처입니다');
      }

      if (adjs.some((a) => a.clamped)) {
        warnings.push('일부 파라미터가 한계에 도달했습니다. 다른 파라미터로 보상하세요');
      }
      warnings.push('프론트 다운포스 증가 시 직선 속도가 감소할 수 있습니다');

      return { adjustments: adjs, rootCauses, warnings };
    },
  },
  {
    id: 'topSpeed',
    weight: 2,
    title: '최고 속도',
    detect: () => false, // user-only symptom
    cause: '직선 구간 속도 부족 → 에어로 드래그 과다',
    adjustments: (d) => {
      const adjs: Adjustment[] = [];
      const rootCauses: string[] = [];
      const warnings: string[] = [];

      adjs.push(makeAdj('Rear Wing', 'rearWing', getVal(d, 'rearWing'), -3));
      adjs.push(makeAdj('Front Wing', 'frontWing', getVal(d, 'frontWing'), -2));
      adjs.push(makeAdj('Front Ride Height', 'frontRideHeight', getVal(d, 'frontRideHeight'), -2));
      adjs.push(makeAdj('Rear Ride Height', 'rearRideHeight', getVal(d, 'rearRideHeight'), -2));
      adjs.push(makeAdj('Front Toe', 'frontToe', getVal(d, 'frontToe'), -0.05));
      adjs.push(makeAdj('Rear Toe', 'rearToe', getVal(d, 'rearToe'), -0.15));

      const rw = getVal(d, 'rearWing');
      if (rw != null && isExtreme('rearWing', rw) === 'low') {
        rootCauses.push('Rear Wing이 이미 최소치 근처 — 에어로 외 요인을 확인하세요');
      }

      if (adjs.some((a) => a.clamped)) {
        warnings.push('일부 파라미터가 한계에 도달했습니다');
      }
      warnings.push('다운포스 감소 시 코너링 속도가 저하됩니다');
      warnings.push('라이드 하이트 감소 시 바텀아웃 위험이 증가합니다');

      return { adjustments: adjs, rootCauses, warnings };
    },
  },
];

// ── Scoring ──

function confidence(telemetry: boolean, user: boolean): 'high' | 'medium' | 'low' {
  if (telemetry && user) return 'high';
  if (telemetry) return 'medium';
  return 'low';
}

function severityFromConf(conf: 'high' | 'medium' | 'low'): Severity {
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
    const { adjustments, rootCauses, warnings } = s.adjustments(driver);
    results.push({
      id: s.id,
      weight: s.weight,
      telemetryDetected: detected,
      userSelected: selected,
      confidence: conf,
      severity: severityFromConf(conf),
      title: s.title,
      cause: s.cause,
      adjustments,
      rootCauses: rootCauses.length > 0 ? rootCauses : undefined,
      warnings: warnings.length > 0 ? warnings : undefined,
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
  { id: 'topSpeed', label: '최고 속도', desc: '직선 구간 속도 부족' },
  { id: 'tyreWear', label: '타이어 마모', desc: '마모 속도 빠름' },
];
