import { useState, useMemo } from 'react';
import type { DriverInfo } from '../../../types/telemetry';
import { getTyreColor, getWearStatusColor, getTempStatusColor } from '../../../constants/tyreCompounds';
import { SectionHeader } from '../shared/SectionHeader';
import { TyreIcon } from '../shared/TyreIcon';
import { useTyreInventory } from '../../../hooks/useTyreInventory';
import { INVENTORY_COMPOUNDS, type InventoryCompound } from '../../../types/tyreInventory';
import styles from './TyreEngineeringSection.module.css';

interface TyreEngineeringSectionProps {
  driver: DriverInfo | null;
}

const WHEEL_POSITIONS = ['FL', 'FR', 'RL', 'RR'] as const;
const NUM_WHEELS = 4;

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

export function TyreEngineeringSection({ driver }: TyreEngineeringSectionProps) {
  const [predictionLaps, setPredictionLaps] = useState<string>('');
  const { allocated, remaining, setCompoundAllocation, resetToDefault } = useTyreInventory(
    driver?.stintHistory
  );

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
      return clamp(currentWear + wearPerLap * laps, 0, 100);
    });
  }, [driver, tyreWear, predictionLaps]);

  if (!driver) {
    return (
      <div className={styles.container}>
        <SectionHeader title="Tyre Engineering" />
        <div className={styles.noData}>No driver data available</div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <SectionHeader
        title="Tyre Engineering"
        subtitle={`${driver.tireCompound} - ${driver.tireAge}L`}
      />

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
                const predictedColor = getWearStatusColor(predicted);
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
                          width: `${predicted}%`,
                          backgroundColor: predictedColor,
                        }}
                      />
                    </div>
                    <span
                      className={styles.predictionValue}
                      style={{ color: predictedColor }}
                    >
                      {predicted.toFixed(0)}%
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
