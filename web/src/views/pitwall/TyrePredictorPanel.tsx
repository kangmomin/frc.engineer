import { useState } from 'react';
import { projectTyreWear } from '../../components/cockpit/tyrePrediction';
import { getWearStatusColor, TYRE_WEAR_THRESHOLDS } from '../../constants/tyreCompounds';
import { PanelTitle } from '../../ui';
import type { DriverInfo } from '../../types/telemetry';
import { clamp } from '../../utils/formatters';
import { averageWear } from './derive/myCar';

const AHEAD_MIN = 0;
const AHEAD_MAX = 60;
const TARGET_MIN = 1;
const TARGET_MAX = 200;
const DEFAULT_AHEAD_LAPS = 5;
const DEFAULT_TARGET_OFFSET = 10;

/** legacy 임계(TYRE_WEAR_THRESHOLDS) 재사용 — OK/Fair/High Deg/Cliff 라벨은 신규, 색은 getWearStatusColor 그대로. */
function wearStatus(wearPercent: number): { label: string; color: string } {
  const color = getWearStatusColor(wearPercent);
  if (wearPercent < TYRE_WEAR_THRESHOLDS.good) return { label: 'OK', color };
  if (wearPercent < TYRE_WEAR_THRESHOLDS.warning) return { label: 'Fair', color };
  if (wearPercent < TYRE_WEAR_THRESHOLDS.critical) return { label: 'High Deg', color };
  return { label: 'Cliff', color };
}

/**
 * tyrePrediction.ts(projectTyreWear) 재사용. "+Laps"/"At Lap" 두 입력은 이 패널이 소유한
 * 로컬(비영속) UI 상태다 — persist 대상(cols/colW/panels/weatherStep)이 아니고 이 패널
 * 내부 연산에만 쓰여 컨테이너로 끌어올릴 이유가 없다(Spec의 view-model-props 원칙에 대한
 * 좁은 예외, 최종 보고에 기록).
 */
export function TyrePredictorPanel({ player }: { player: DriverInfo | null }) {
  const [aheadN, setAheadN] = useState(DEFAULT_AHEAD_LAPS);
  const [targetLap, setTargetLap] = useState<number | null>(null);

  if (!player || player.tireAge <= 0) {
    return (
      <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--bg-panel-border)', borderRadius: 'var(--radius-lg)', padding: 11, display: 'flex', flexDirection: 'column', gap: 9 }}>
        <PanelTitle title="Tyre Predictor" tone="tertiary" detail="—" />
        <div role="status" style={{ padding: '16px 0', textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>Awaiting tyre data</div>
      </div>
    );
  }

  const wear = averageWear(player) ?? 0;
  const age = player.tireAge;
  const effectiveTarget = targetLap ?? clamp(player.currentLapNum + DEFAULT_TARGET_OFFSET, TARGET_MIN, TARGET_MAX);

  const aheadLap = player.currentLapNum + aheadN;
  const aheadProjection = projectTyreWear(wear, age, aheadN);
  const aheadAge = age + aheadN;
  const aheadSt = wearStatus(aheadProjection.absolute);

  const targetOffset = effectiveTarget - player.currentLapNum;
  const targetPast = targetOffset < 0;
  const targetProjection = projectTyreWear(wear, age, targetOffset);
  const targetAge = age + targetOffset;
  const targetSt = wearStatus(targetProjection.absolute);

  return (
    <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--bg-panel-border)', borderRadius: 'var(--radius-lg)', padding: 11, display: 'flex', flexDirection: 'column', gap: 9 }}>
      <PanelTitle title="Tyre Predictor" tone="tertiary" detail={`${player.tireCompound} · Age ${age} · ${Math.round(wear)}% now`} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(14,14,15,.5)', border: '1px solid var(--bg-panel-border)', borderLeft: `2px solid ${aheadSt.color}`, borderRadius: 3, padding: '7px 9px' }}>
        <label htmlFor="tyre-predictor-ahead-laps" style={{ fontSize: 10, letterSpacing: '.05em', textTransform: 'uppercase', fontWeight: 700, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>+ Laps</label>
        <input
          id="tyre-predictor-ahead-laps"
          type="number"
          value={aheadN}
          min={AHEAD_MIN}
          max={AHEAD_MAX}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            setAheadN(Number.isNaN(v) ? 0 : clamp(v, AHEAD_MIN, AHEAD_MAX));
          }}
          style={{ width: 46, background: 'rgba(0,0,0,.4)', border: '1px solid var(--bg-panel-border)', borderRadius: 4, color: 'var(--text-primary)', fontFamily: 'var(--font-racing)', fontWeight: 700, fontSize: 13, padding: '3px 4px', textAlign: 'center' }}
        />
        <div style={{ flex: 1, minWidth: 0, lineHeight: 1.15 }}>
          <div style={{ fontSize: 9.5, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>L{aheadLap} · Age {aheadAge}</div>
        </div>
        <span style={{ fontFamily: 'var(--font-racing)', fontWeight: 800, fontSize: 19, color: aheadSt.color }}>{aheadProjection.absolute}%</span>
        <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.03em', padding: '2px 6px', borderRadius: 4, color: aheadSt.color, border: `1px solid ${aheadSt.color}`, whiteSpace: 'nowrap' }}>{aheadSt.label}</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(14,14,15,.5)', border: '1px solid var(--bg-panel-border)', borderLeft: `2px solid ${targetPast ? 'var(--text-muted)' : targetSt.color}`, borderRadius: 3, padding: '7px 9px' }}>
        <label htmlFor="tyre-predictor-at-lap" style={{ fontSize: 10, letterSpacing: '.05em', textTransform: 'uppercase', fontWeight: 700, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>At Lap</label>
        <input
          id="tyre-predictor-at-lap"
          type="number"
          value={effectiveTarget}
          min={TARGET_MIN}
          max={TARGET_MAX}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            setTargetLap(Number.isNaN(v) ? player.currentLapNum : clamp(v, TARGET_MIN, TARGET_MAX));
          }}
          style={{ width: 46, background: 'rgba(0,0,0,.4)', border: '1px solid var(--bg-panel-border)', borderRadius: 4, color: 'var(--text-primary)', fontFamily: 'var(--font-racing)', fontWeight: 700, fontSize: 13, padding: '3px 4px', textAlign: 'center' }}
        />
        <div style={{ flex: 1, minWidth: 0, lineHeight: 1.15 }}>
          <div style={{ fontSize: 9.5, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Age {targetPast ? '—' : targetAge}</div>
        </div>
        <span style={{ fontFamily: 'var(--font-racing)', fontWeight: 800, fontSize: 19, color: targetPast ? 'var(--text-muted)' : targetSt.color }}>{targetPast ? '—' : `${targetProjection.absolute}%`}</span>
        <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.03em', padding: '2px 6px', borderRadius: 4, color: targetPast ? 'var(--text-muted)' : targetSt.color, border: `1px solid ${targetPast ? 'var(--text-muted)' : targetSt.color}`, whiteSpace: 'nowrap' }}>
          {targetPast ? 'Past' : targetSt.label}
        </span>
      </div>
    </div>
  );
}
