import { useState, useMemo, memo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { DynamicsLap, TireWearDisplayMode } from '../../../types/telemetry';
import { getTyreColor, getWearStatusColor, getTempStatusColor } from '../../../constants/tyreCompounds';
import { SectionHeader } from '../shared/SectionHeader';
import { TyreIcon } from '../shared/TyreIcon';
import { useTyreInventory } from '../../../hooks/useTyreInventory';
import { useLocalStorage } from '../../../hooks/useLocalStorage';
import { INVENTORY_COMPOUNDS, type InventoryCompound } from '../../../types/tyreInventory';
import { useTelemetryStore } from '../../../store/telemetryStore';
import styles from './TyreEngineeringSection.module.css';

type SectionTab = 'tyres' | 'spin';

const WHEEL_POSITIONS = ['FL', 'FR', 'RL', 'RR'] as const;
const NUM_WHEELS = 4;

// --- Stable Selectors ---

const selectPlayerIndex = (s: any) => s.pitwallState?.playerIndex ?? 0;
const selectDrivers = (s: any) => s.pitwallState?.drivers ?? [];

// --- Components ---

const DynamicsTab = memo(({ laps }: { laps: DynamicsLap[] }) => {
  if (laps.length === 0) {
    return <div className={styles.noData}>No completed lap data yet</div>;
  }

  return (
    <div className={styles.dynamicsTable}>
      <div className={`${styles.dynamicsRow} ${styles.dynamicsHeader}`}>
        <span className={styles.dynamicsCell}>Lap</span>
        <span className={styles.dynamicsCell}>Understeer</span>
        <span className={styles.dynamicsCell}>Oversteer</span>
        <span className={styles.dynamicsCell}>Lock</span>
        <span className={styles.dynamicsCell}>Spin</span>
      </div>
      {[...laps].reverse().slice(0, 10).map((lap) => (
        <div key={lap.lapNum} className={styles.dynamicsRow}>
          <span className={styles.dynamicsCell}>{lap.lapNum}</span>
          <span className={styles.dynamicsCell}>
            <div className={styles.dynamicsMiniBar}>
              <div
                className={styles.dynamicsMiniBarFill}
                style={{
                  width: `${Math.min(lap.understeerPct, 100)}%`,
                  backgroundColor: 'var(--accent-yellow)',
                }}
              />
            </div>
            <span className={styles.dynamicsValue}>{lap.understeerPct.toFixed(1)}%</span>
          </span>
          <span className={styles.dynamicsCell}>
            <div className={styles.dynamicsMiniBar}>
              <div
                className={styles.dynamicsMiniBarFill}
                style={{
                  width: `${Math.min(lap.oversteerPct, 100)}%`,
                  backgroundColor: 'var(--accent-red)',
                }}
              />
            </div>
            <span className={styles.dynamicsValue}>{lap.oversteerPct.toFixed(1)}%</span>
          </span>
          <span className={`${styles.dynamicsCell} ${styles.dynamicsCount}`}>
            {lap.lockupCount > 0 ? lap.lockupCount : '-'}
          </span>
          <span className={`${styles.dynamicsCell} ${styles.dynamicsCount}`}>
            {lap.spinCount > 0 ? lap.spinCount : '-'}
          </span>
        </div>
      ))}
    </div>
  );
});

export function TyreEngineeringSection() {
  const playerIdx = useTelemetryStore(selectPlayerIndex);
  const drivers = useTelemetryStore(useShallow(selectDrivers));
  const driver = useMemo(() => drivers.find((d: any) => d.index === playerIdx) ?? null, [drivers, playerIdx]);
  
  const [activeTab, setActiveTab] = useState<SectionTab>('tyres');
  const [predictionLaps, setPredictionLaps] = useState<string>('');
  const [wearDisplayMode] = useLocalStorage<TireWearDisplayMode>('tireWearDisplayMode', 'absolute');
  const { allocated, remaining, setCompoundAllocation, resetToDefault } = useTyreInventory(driver?.stintHistory);

  const tyreWear = useMemo(() => normalizeWheelData(driver?.tireWear), [driver?.tireWear]);
  const tyreSurfaceTemp = useMemo(() => normalizeWheelData(driver?.tireSurfaceTemp), [driver?.tireSurfaceTemp]);
  const tyreInnerTemp = useMemo(() => normalizeWheelData(driver?.tireInnerTemp), [driver?.tireInnerTemp]);
  const brakeTemp = useMemo(() => normalizeWheelData(driver?.brakeTemp), [driver?.brakeTemp]);

  const averageWearPerLap = useMemo(() => {
    if (!driver || driver.tireAge === 0) return 0;
    const avgWear = tyreWear.reduce((sum, w) => sum + w, 0) / NUM_WHEELS;
    return avgWear / driver.tireAge;
  }, [driver, tyreWear]);

  const predictedWear = useMemo(() => {
    const laps = parseInt(predictionLaps, 10);
    if (!driver || isNaN(laps) || laps <= 0) return null;
    return tyreWear.map((currentWear) => {
      const wearPerLap = driver.tireAge > 0 ? currentWear / driver.tireAge : 0;
      const absoluteWear = clamp(currentWear + wearPerLap * laps, 0, 100);
      return wearDisplayMode === 'relative' ? absoluteWear - currentWear : absoluteWear;
    });
  }, [driver, tyreWear, predictionLaps, wearDisplayMode]);

  if (!driver) {
    return (
      <div className={styles.container}>
        <SectionHeader title="Tyre Engineering" />
        <div className={styles.noData}>Waiting for telemetry...</div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <SectionHeader
        title="Tyre Engineering"
        subtitle={`${driver.tireCompound} - ${driver.tireAge} Laps`}
        rightContent={(
          <div className={styles.tabBar}>
            {(['tyres', 'spin'] as SectionTab[]).map(t => (
              <button
                key={t}
                className={`${styles.tabButton} ${activeTab === t ? styles.tabActive : ''}`}
                onClick={() => setActiveTab(t)}
              >
                {t}
              </button>
            ))}
          </div>
        )}
      />

      <div className={styles.content}>
        {activeTab === 'spin' ? (
          <DynamicsTab laps={driver.dynamics ?? []} />
        ) : (
          <>
            <div className={styles.section}>
              <div className={styles.inventoryHeader}>
                <h4 className={styles.sectionLabel}>Inventory</h4>
                <button className={styles.resetButton} onClick={resetToDefault}>Reset</button>
              </div>
              <div className={styles.inventoryGrid}>
                {INVENTORY_COMPOUNDS.map((compound) => {
                  const alloc = allocated[compound];
                  const rem = remaining[compound];
                  const color = getTyreColor(compound);
                  return (
                    <div key={compound} className={styles.inventoryItem}>
                      <TyreIcon compound={compound} size="small" showAge={false} />
                      <input
                        type="number"
                        value={alloc}
                        onChange={(e) => setCompoundAllocation(compound as InventoryCompound, parseInt(e.target.value, 10) || 0)}
                        className={styles.inventoryInput}
                      />
                      <div className={styles.inventoryProgress}>
                        <div className={styles.inventoryProgressFill} style={{ width: `${alloc > 0 ? (rem/alloc)*100 : 0}%`, backgroundColor: color }} />
                      </div>
                      <span className={styles.inventoryRemaining} style={{ color: rem <= 1 ? 'var(--accent-red)' : color }}>{rem} LEFT</span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className={styles.section}>
              <h4 className={styles.sectionLabel}>Tyre Status</h4>
              <div className={styles.chassisView}>
                {WHEEL_POSITIONS.map((pos, idx) => {
                  const wear = clamp(tyreWear[idx], 0, 100);
                  const sTemp = tyreSurfaceTemp[idx];
                  const iTemp = tyreInnerTemp[idx];
                  const bTemp = brakeTemp[idx];
                  return (
                    <div key={pos} className={styles.wheelCell}>
                      <span className={styles.wheelLabel}>{pos}</span>
                      <div className={styles.wheelVisual} style={{ borderColor: getTyreColor(driver.tireCompound) }}>
                        <div className={styles.wearFill} style={{ height: `${wear}%`, backgroundColor: getWearStatusColor(wear) }} />
                        <span className={styles.wearPercent}>{wear.toFixed(0)}%</span>
                      </div>
                      <div className={styles.tempGrid}>
                        <div className={styles.tempItem} style={{ color: getTempStatusColor(sTemp) }}>
                          <span className={styles.tempLabel}>SURF</span>
                          <span className={styles.tempValue}>{sTemp}°</span>
                        </div>
                        <div className={styles.tempItem} style={{ color: getTempStatusColor(iTemp) }}>
                          <span className={styles.tempLabel}>INNER</span>
                          <span className={styles.tempValue}>{iTemp}°</span>
                        </div>
                        <div className={styles.tempItem} style={{ color: bTemp > 400 ? 'var(--accent-red)' : bTemp > 300 ? 'var(--accent-yellow)' : 'var(--text-muted)' }}>
                          <span className={styles.tempLabel}>BRAKE</span>
                          <span className={styles.tempValue}>{bTemp}°</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className={styles.section}>
              <h4 className={styles.sectionLabel}>Prediction</h4>
              <div className={styles.predictionInput}>
                <label className={styles.inputLabel}>LAPS TO GO:
                  <input type="number" value={predictionLaps} onChange={(e) => setPredictionLaps(e.target.value)} className={styles.lapsInput} placeholder="0" />
                </label>
                <span className={styles.wearRate}>~{averageWearPerLap.toFixed(2)}% / LAP</span>
              </div>
              {predictedWear && (
                <div className={styles.predictionGrid}>
                  {WHEEL_POSITIONS.map((pos, idx) => {
                    const pred = predictedWear[idx] ?? 0;
                    const isRel = wearDisplayMode === 'relative';
                    const absVal = isRel ? tyreWear[idx] + pred : pred;
                    const color = getWearStatusColor(absVal);
                    return (
                      <div key={pos} className={styles.predictionItem}>
                        <span className={styles.predictionLabel}>{pos}</span>
                        <div className={styles.predictionBar}>
                          <div className={styles.predictionFill} style={{ width: `${isRel ? clamp(pred, 0, 100) : pred}%`, backgroundColor: color }} />
                        </div>
                        <span className={styles.predictionValue} style={{ color }}>{isRel ? '+' : ''}{pred.toFixed(0)}%</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// --- Utils ---

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeWheelData(data: number[] | undefined): number[] {
  const normalized: number[] = [];
  for (let i = 0; i < NUM_WHEELS; i++) {
    normalized.push(data?.[i] ?? 0);
  }
  return normalized;
}
