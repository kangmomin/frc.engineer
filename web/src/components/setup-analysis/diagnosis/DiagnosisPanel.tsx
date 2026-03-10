import { memo, useRef, useCallback, useSyncExternalStore } from 'react';
import type { DriverInfo } from '../../../types/telemetry';
import { SeverityDot } from '../shared/SeverityDot';
import { diagnose, SYMPTOM_LIST, type SymptomId } from './scoring';
import { useTelemetryStore } from '../../../store/telemetryStore';
import styles from './DiagnosisPanel.module.css';

interface Props {
  selectedSymptoms: Set<SymptomId>;
  onToggleSymptom: (id: SymptomId) => void;
}

const confidenceLabel: Record<string, string> = {
  high: 'HIGH',
  medium: 'MED',
  low: 'LOW',
};

const badgeClass: Record<string, string> = {
  high: styles.badgeHigh,
  medium: styles.badgeMedium,
  low: styles.badgeLow,
};

// --- Performance Utilities ---

function useStoreWithEq<T>(
  selector: (state: ReturnType<typeof useTelemetryStore.getState>) => T,
  isEqual: (a: T, b: T) => boolean,
): T {
  const prev = useRef<T>(selector(useTelemetryStore.getState()));
  const getSnapshot = useCallback(() => {
    const next = selector(useTelemetryStore.getState());
    if (isEqual(prev.current, next)) return prev.current;
    prev.current = next;
    return next;
  }, [selector, isEqual]);
  return useSyncExternalStore(useTelemetryStore.subscribe, getSnapshot);
}

// --- Stable Selectors ---

const selectPlayerData = (s: ReturnType<typeof useTelemetryStore.getState>) => {
  const idx = s.pitwallState?.playerIndex ?? 0;
  return s.pitwallState?.drivers.find(d => d.index === idx) ?? null;
};

function driverDiagnosisEqual(a: DriverInfo | null, b: DriverInfo | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  // Only re-run diagnosis if relevant setup or analysis data changes
  return (
    a.currentLapNum === b.currentLapNum &&
    JSON.stringify(a.setup) === JSON.stringify(b.setup) &&
    a.setupAnalysis?.length === b.setupAnalysis?.length
  );
}

export const DiagnosisPanel = memo(({ selectedSymptoms, onToggleSymptom }: Props) => {
  const driver = useStoreWithEq(selectPlayerData, driverDiagnosisEqual);
  const results = driver ? diagnose(driver, selectedSymptoms) : [];

  return (
    <div className={styles.container}>
      {/* Symptom Selector */}
      <div className={styles.section}>
        <span className={styles.sectionTitle}>SYMPTOM SELECTOR</span>
        <div className={styles.symptoms}>
          {SYMPTOM_LIST.map((s) => (
            <button
              key={s.id}
              className={`${styles.symptomBtn} ${selectedSymptoms.has(s.id) ? styles.symptomBtnActive : ''}`}
              onClick={() => onToggleSymptom(s.id)}
            >
              <span className={styles.symptomLabel}>{s.label}</span>
              <span className={styles.symptomDesc}>{s.desc}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Priority Recommendation List */}
      <div className={styles.section}>
        <span className={styles.sectionTitle}>PRIORITY ANALYSIS</span>
        {results.length === 0 ? (
          <div className={styles.empty}>
            NO ISSUES DETECTED. SELECT SYMPTOMS ABOVE OR COMPLETE A LAP TO START ANALYSIS.
          </div>
        ) : (
          <div className={styles.results}>
            {results.map((r, i) => (
              <div key={r.id} className={styles.card}>
                <div className={styles.cardHeader}>
                  <span className={styles.rank}>{i + 1}</span>
                  <SeverityDot severity={r.severity} />
                  <span className={styles.cardTitle}>{r.title}</span>
                  <span className={`${styles.badge} ${badgeClass[r.confidence]}`}>
                    {confidenceLabel[r.confidence]}
                  </span>
                </div>
                <div className={styles.sources}>
                  {r.telemetryDetected && (
                    <span className={`${styles.sourceTag} ${styles.sourceTelemetry}`}>TELEMETRY</span>
                  )}
                  {r.userSelected && (
                    <span className={`${styles.sourceTag} ${styles.sourceUser}`}>USER</span>
                  )}
                </div>
                <div className={styles.cause}>{r.cause}</div>
                {r.rootCauses && r.rootCauses.length > 0 && (
                  <div className={styles.rootCauses}>
                    {r.rootCauses.map((c) => (
                      <div key={c} className={styles.rootCauseRow}>⚠ {c}</div>
                    ))}
                  </div>
                )}
                <div className={styles.adjustments}>
                  {r.adjustments.map((a) => (
                    <div key={a.label} className={`${styles.adjRow} ${a.clamped ? styles.adjClamped : ''}`}>
                      <span className={styles.adjLabel}>{a.label}</span>
                      <span className={styles.adjValue}>
                        {a.current && a.target ? `${a.current} → ${a.target}` : a.delta}
                      </span>
                    </div>
                  ))}
                </div>
                {r.warnings && r.warnings.length > 0 && (
                  <div className={styles.warnings}>
                    {r.warnings.map((w) => (
                      <div key={w} className={styles.warningRow}>{w}</div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});
