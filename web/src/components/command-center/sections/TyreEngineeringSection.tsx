import { useState, useMemo, useEffect } from 'react';
import type { DynamicsLap, TireWearDisplayMode } from '../../../types/telemetry';
import { getTyreColor, getWearStatusColor, getTempStatusColor } from '../../../constants/tyreCompounds';
import { SectionHeader } from '../shared/SectionHeader';
import { TyreIcon } from '../shared/TyreIcon';
import { useTyreInventory } from '../../../hooks/useTyreInventory';
import { useLocalStorage } from '../../../hooks/useLocalStorage';
import { INVENTORY_COMPOUNDS, type InventoryCompound } from '../../../types/tyreInventory';
import { useTelemetryStore } from '../../../store/telemetryStore';
import { useAuth } from '../../../context/AuthContext';
import styles from './TyreEngineeringSection.module.css';

type SectionTab = 'tyres' | 'spin';

const WHEEL_POSITIONS = ['FL', 'FR', 'RL', 'RR'] as const;
const NUM_WHEELS = 4;
const PRODUCT_SPIN_TAB_PERMISSION = /^product\.[^.]+\.spin_tab$/;

function hasSpinTabPermission(permissions: string[]): boolean {
  return permissions.some((permission) => PRODUCT_SPIN_TAB_PERMISSION.test(permission));
}

/** Clamp value to [0, 100] range */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Normalize tyre array to exactly 4 elements, defaulting missing values to 0 */
function normalizeWheelData(data: number[] | undefined): number[] {
  const normalized: number[] = [];
  for (let i = 0; i < NUM_WHEELS; i++) {
    normalized.push(data?.[i] ?? 0);
  }
  return normalized;
}

function DynamicsTab({ laps }: { laps: DynamicsLap[] }) {
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
      {laps.map((lap) => (
        <div key={lap.lapNum} className={styles.dynamicsRow}>
          <span className={styles.dynamicsCell}>{lap.lapNum}</span>
          <span className={styles.dynamicsCell}>
            <span className={styles.dynamicsMiniBar}>
              <span
                className={styles.dynamicsMiniBarFill}
                style={{
                  width: `${Math.min(lap.understeerPct, 100)}%`,
                  backgroundColor: 'var(--accent-yellow)',
                }}
              />
            </span>
            <span className={styles.dynamicsValue}>{lap.understeerPct.toFixed(1)}%</span>
          </span>
          <span className={styles.dynamicsCell}>
            <span className={styles.dynamicsMiniBar}>
              <span
                className={styles.dynamicsMiniBarFill}
                style={{
                  width: `${Math.min(lap.oversteerPct, 100)}%`,
                  backgroundColor: 'var(--accent-red)',
                }}
              />
            </span>
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
}

export function TyreEngineeringSection() {
  const { user } = useAuth();
  const pitwallState = useTelemetryStore((state) => state.pitwallState);
  const driver = pitwallState?.drivers.find(d => d.index === pitwallState.playerIndex) ?? null;
  const [activeTab, setActiveTab] = useState<SectionTab>('tyres');
  const [predictionLaps, setPredictionLaps] = useState<string>('');
  const [wearDisplayMode] = useLocalStorage<TireWearDisplayMode>(
    'tireWearDisplayMode',
    'absolute',
    (v) => (v === 'absolute' || v === 'relative' ? v : null),
  );
  const { allocated, remaining, setCompoundAllocation, resetToDefault } = useTyreInventory(
    driver?.stintHistory
  );
  const canUseSpinTab = useMemo(() => hasSpinTabPermission(user?.permissions ?? []), [user?.permissions]);

  useEffect(() => {
    if (!canUseSpinTab && activeTab === 'spin') {
      setActiveTab('tyres');
    }
  }, [canUseSpinTab, activeTab]);

  // Normalize tyre data to ensure we always have 4 values
  const tyreWear = useMemo(() => normalizeWheelData(driver?.tireWear), [driver?.tireWear]);
  const tyreSurfaceTemp = useMemo(() => normalizeWheelData(driver?.tireSurfaceTemp), [driver?.tireSurfaceTemp]);
  const tyreInnerTemp = useMemo(() => normalizeWheelData(driver?.tireInnerTemp), [driver?.tireInnerTemp]);
  const brakeTemp = useMemo(() => normalizeWheelData(driver?.brakeTemp), [driver?.brakeTemp]);

  // Calculate average wear per lap for prediction
  const averageWearPerLap = useMemo(() => {
    if (!driver || driver.tireAge === 0) return 0;
    const avgWear = tyreWear.reduce((sum, w) => sum + w, 0) / NUM_WHEELS;
    return avgWear / driver.tireAge;
  }, [driver, tyreWear]);

  // Calculate predicted wear for each tyre
  const predictedWear = useMemo(() => {
    const laps = parseInt(predictionLaps, 10);
    if (!driver || isNaN(laps) || laps <= 0) return null;

    return tyreWear.map((currentWear) => {
      const wearPerLap = driver.tireAge > 0 ? currentWear / driver.tireAge : 0;
      const absoluteWear = clamp(currentWear + wearPerLap * laps, 0, 100);
      if (wearDisplayMode === 'relative') {
        return absoluteWear - currentWear;
      }
      return absoluteWear;
    });
  }, [driver, tyreWear, predictionLaps, wearDisplayMode]);

  if (!driver) {
    return (
      <div className={styles.container}>
        <SectionHeader title="Tyre Engineering" />
        <div className={styles.noData}>No driver data available</div>
      </div>
    );
  }

  const tabButtons = (
    <div className={styles.tabBar}>
      <button
        className={`${styles.tabButton} ${activeTab === 'tyres' ? styles.tabActive : ''}`}
        onClick={() => setActiveTab('tyres')}
      >
        Tyres
      </button>
      {canUseSpinTab && (
        <button
          className={`${styles.tabButton} ${activeTab === 'spin' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('spin')}
        >
          Spin
        </button>
      )}
    </div>
  );

  return (
    <div className={styles.container}>
      <SectionHeader
        title="Tyre Engineering"
        subtitle={`${driver.tireCompound} - ${driver.tireAge}L`}
        rightContent={tabButtons}
      />

      {activeTab === 'spin' && canUseSpinTab ? (
        <div className={styles.content}>
          <DynamicsTab laps={driver.dynamics ?? []} />
        </div>
      ) : (
        <div className={styles.content}>
          {/* Tyre Inventory */}
          <div className={styles.section}>
            <div className={styles.inventoryHeader}>
              <h4 className={styles.sectionLabel}>Tyre Inventory</h4>
              <button
                className={styles.resetButton}
                onClick={resetToDefault}
                title="Reset to default allocation"
              >
                Reset
              </button>
            </div>
            <div className={styles.inventoryGrid}>
              {INVENTORY_COMPOUNDS.map((compound) => {
                const alloc = allocated[compound];
                const remainingCount = remaining[compound];
                const progressPercent = alloc > 0 ? (remainingCount / alloc) * 100 : 0;
                const tyreColor = getTyreColor(compound);

                let remainingClass = styles.inventoryRemaining;
                if (remainingCount === 0) {
                  remainingClass += ` ${styles.danger}`;
                } else if (remainingCount === 1) {
                  remainingClass += ` ${styles.warning}`;
                }

                return (
                  <div key={compound} className={styles.inventoryItem}>
                    <TyreIcon compound={compound} size="small" showAge={false} />
                    <input
                      type="number"
                      min="0"
                      max="20"
                      value={alloc}
                      onChange={(e) =>
                        setCompoundAllocation(compound as InventoryCompound, parseInt(e.target.value, 10) || 0)
                      }
                      className={styles.inventoryInput}
                      title={`Total ${compound} sets`}
                    />
                    <div className={styles.inventoryProgress}>
                      <div
                        className={styles.inventoryProgressFill}
                        style={{
                          width: `${progressPercent}%`,
                          backgroundColor: tyreColor,
                        }}
                      />
                    </div>
                    <span className={remainingClass} style={{ color: remainingCount > 1 ? tyreColor : undefined }}>
                      {remainingCount} left
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Stint History */}
          <div className={styles.section}>
            <h4 className={styles.sectionLabel}>Stint History</h4>
            <div className={styles.stintHistory}>
              {driver.stintHistory && driver.stintHistory.length > 0 ? (
                driver.stintHistory.map((stint, idx) => (
                  <div key={idx} className={styles.stintItem}>
                    <TyreIcon compound={stint.compound} size="small" showAge={false} />
                    <span className={styles.stintLaps}>{stint.laps}L</span>
                  </div>
                ))
              ) : (
                <div className={styles.stintItem}>
                  <TyreIcon compound={driver.tireCompound} size="small" showAge={false} />
                  <span className={styles.stintLaps}>{driver.tireAge}L</span>
                </div>
              )}
            </div>
          </div>

          {/* Chassis View - 4 Wheel Display with 3 Temperature Types */}
          <div className={styles.section}>
            <h4 className={styles.sectionLabel}>Tyre Status</h4>
            <div className={styles.chassisView} role="group" aria-label="Tyre status for all four wheels">
              {WHEEL_POSITIONS.map((pos, idx) => {
                const wear = clamp(tyreWear[idx], 0, 100);
                const surfaceTemp = tyreSurfaceTemp[idx];
                const innerTemp = tyreInnerTemp[idx];
                const brake = brakeTemp[idx];
                const wearColor = getWearStatusColor(wear);
                const surfaceTempColor = getTempStatusColor(surfaceTemp);
                const innerTempColor = getTempStatusColor(innerTemp);
                const tyreColor = getTyreColor(driver.tireCompound);

                return (
                  <div key={pos} className={styles.wheelCell}>
                    <span className={styles.wheelLabel}>{pos}</span>
                    <div
                      className={styles.wheelVisual}
                      style={{ borderColor: tyreColor }}
                      role="meter"
                      aria-label={`${pos} tyre wear`}
                      aria-valuenow={wear}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      <div
                        className={styles.wearFill}
                        style={{
                          height: `${wear}%`,
                          backgroundColor: wearColor,
                        }}
                      />
                      <span className={styles.wearPercent}>{wear.toFixed(0)}%</span>
                    </div>
                    <div className={styles.tempGrid}>
                      <div
                        className={styles.tempItem}
                        style={{ color: surfaceTempColor }}
                        title="Surface Temperature"
                      >
                        <span className={styles.tempLabel}>SUR</span>
                        <span className={styles.tempValue}>{surfaceTemp}°</span>
                      </div>
                      <div
                        className={styles.tempItem}
                        style={{ color: innerTempColor }}
                        title="Inner Temperature"
                      >
                        <span className={styles.tempLabel}>INN</span>
                        <span className={styles.tempValue}>{innerTemp}°</span>
                      </div>
                      <div
                        className={styles.tempItem}
                        style={{ color: brake > 400 ? 'var(--accent-red)' : brake > 300 ? 'var(--accent-yellow)' : 'var(--text-secondary)' }}
                        title="Brake Temperature"
                      >
                        <span className={styles.tempLabel}>BRK</span>
                        <span className={styles.tempValue}>{brake}°</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Tyre Prediction */}
          <div className={styles.section}>
            <h4 className={styles.sectionLabel}>Wear Prediction</h4>
            <div className={styles.predictionInput}>
              <label className={styles.inputLabel}>
                Laps:
                <input
                  type="number"
                  min="1"
                  max="99"
                  value={predictionLaps}
                  onChange={(e) => setPredictionLaps(e.target.value)}
                  className={styles.lapsInput}
                  placeholder="0"
                />
              </label>
              <span className={styles.wearRate}>
                ~{averageWearPerLap.toFixed(1)}%/lap
              </span>
            </div>

            {predictedWear && (
              <div className={styles.predictionGrid} role="group" aria-label="Predicted tyre wear">
                {WHEEL_POSITIONS.map((pos, idx) => {
                  const predicted = predictedWear[idx] ?? 0;
                  const isRelative = wearDisplayMode === 'relative';
                  // For color coding, use the absolute value (current + delta) for proper threshold mapping
                  const absoluteValue = isRelative ? tyreWear[idx] + predicted : predicted;
                  const predictedColor = getWearStatusColor(absoluteValue);
                  const barWidth = isRelative ? clamp(predicted, 0, 100) : predicted;
                  return (
                    <div key={pos} className={styles.predictionItem}>
                      <span className={styles.predictionLabel}>{pos}</span>
                      <div
                        className={styles.predictionBar}
                        role="meter"
                        aria-label={`${pos} predicted wear`}
                        aria-valuenow={predicted}
                        aria-valuemin={0}
                        aria-valuemax={100}
                      >
                        <div
                          className={styles.predictionFill}
                          style={{
                            width: `${barWidth}%`,
                            backgroundColor: predictedColor,
                          }}
                        />
                      </div>
                      <span
                        className={styles.predictionValue}
                        style={{ color: predictedColor }}
                      >
                        {isRelative ? '+' : ''}{predicted.toFixed(0)}%
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
