import { useState, useEffect, memo, useRef, useCallback, useSyncExternalStore } from 'react';
import type { DriverInfo } from '../../../types/telemetry';
import { useSetupFeedbackStore } from '../../../store/setupFeedbackStore';
import { diagnose, type SymptomId } from '../diagnosis/scoring';
import type { LapFeedback } from '../../../store/setupFeedbackStore';
import { useTelemetryStore } from '../../../store/telemetryStore';
import styles from './SetupFeedbackPanel.module.css';

interface Props {
  selectedSymptoms: Set<SymptomId>;
}

const RATING_OPTIONS: { value: LapFeedback['rating']; label: string; color: string }[] = [
  { value: 'good', label: 'Good', color: '#00ff00' },
  { value: 'neutral', label: 'Neutral', color: '#ffcc00' },
  { value: 'bad', label: 'Bad', color: '#e10600' },
];

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
}

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

function driverFeedbackEqual(a: DriverInfo | null, b: DriverInfo | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.currentLapNum === b.currentLapNum && JSON.stringify(a.setup) === JSON.stringify(b.setup);
}

const SetupDiffRow = memo(({ label, prev, next, unit }: { label: string; prev: number; next: number; unit?: string }) => {
  if (prev === next) return null;
  const delta = next - prev;
  const sign = delta > 0 ? '+' : '';
  const u = unit ?? '';
  return (
    <div className={styles.diffRow}>
      <span className={styles.diffLabel}>{label}</span>
      <span className={styles.diffValue}>
        {prev}{u} → {next}{u}
        <span className={delta > 0 ? styles.diffPlus : styles.diffMinus}> ({sign}{delta.toFixed(Number.isInteger(delta) ? 0 : 2)}{u})</span>
      </span>
    </div>
  );
});

export function SetupFeedbackPanel({ selectedSymptoms }: Props) {
  const driver = useStoreWithEq(selectPlayerData, driverFeedbackEqual);
  const [note, setNote] = useState('');
  const [rating, setRating] = useState<LapFeedback['rating']>('neutral');
  
  const {
    feedbacks, setupChanges, addFeedback, deleteFeedback, resetFeedbacks,
    checkSetupChange, deleteSetupChange, resetSetupChanges, resetAll,
  } = useSetupFeedbackStore();

  useEffect(() => {
    if (!driver) return;
    const results = diagnose(driver, selectedSymptoms);
    checkSetupChange(driver.setup, driver.currentLapNum, results);
  }, [driver, selectedSymptoms, checkSetupChange]);

  const handleAddFeedback = () => {
    if (!note.trim() || !driver) return;
    addFeedback(driver.currentLapNum, note.trim(), rating);
    setNote('');
    setRating('neutral');
  };

  if (!driver) return <div className={styles.empty}>WAITING FOR TELEMETRY...</div>;

  return (
    <div className={styles.container}>
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionTitle}>ADD LAP FEEDBACK</span>
          <span className={styles.lapBadge}>LAP {driver.currentLapNum}</span>
        </div>
        <div className={styles.inputRow}>
          <div className={styles.ratingGroup}>
            {RATING_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                className={`${styles.ratingBtn} ${rating === opt.value ? styles.ratingBtnActive : ''}`}
                style={rating === opt.value ? { borderColor: opt.color, color: opt.color } : undefined}
                onClick={() => setRating(opt.value)}
              >{opt.label}</button>
            ))}
          </div>
          <div className={styles.noteRow}>
            <input className={styles.noteInput} type="text" placeholder="ENTER FEEDBACK..." value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleAddFeedback(); }} />
            <button className={styles.addBtn} onClick={handleAddFeedback} disabled={!note.trim()}>ADD</button>
          </div>
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionTitle}>FEEDBACK HISTORY ({feedbacks.length})</span>
          {feedbacks.length > 0 && <button className={styles.resetBtn} onClick={() => { if (window.confirm('Delete all?')) resetFeedbacks(); }}>RESET</button>}
        </div>
        {feedbacks.length === 0 ? <div className={styles.empty}>NO FEEDBACK RECORDED.</div> : (
          <div className={styles.list}>
            {[...feedbacks].reverse().map((fb) => (
              <div key={fb.id} className={styles.feedbackItem}>
                <div className={styles.feedbackHeader}>
                  <span className={styles.feedbackLap}>LAP {fb.lapNum}</span>
                  <span className={styles.feedbackRating} style={{ color: RATING_OPTIONS.find((r) => r.value === fb.rating)?.color }}>{fb.rating.toUpperCase()}</span>
                  <span className={styles.feedbackTime}>{formatTime(fb.timestamp)}</span>
                  <button className={styles.deleteBtn} onClick={() => deleteFeedback(fb.id)}>X</button>
                </div>
                <div className={styles.feedbackNote}>{fb.note}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionTitle}>SETUP CHANGE LOG ({setupChanges.length})</span>
          {setupChanges.length > 0 && <button className={styles.resetBtn} onClick={() => { if (window.confirm('Delete all?')) resetSetupChanges(); }}>RESET</button>}
        </div>
        {setupChanges.length === 0 ? <div className={styles.empty}>NO CHANGES RECORDED.</div> : (
          <div className={styles.list}>
            {[...setupChanges].reverse().map((change) => (
              <div key={change.id} className={styles.changeItem}>
                <div className={styles.changeHeader}>
                  <span className={styles.changeLap}>LAP {change.lapNum}</span>
                  <span className={styles.changeTime}>{formatTime(change.timestamp)}</span>
                  <button className={styles.deleteBtn} onClick={() => deleteSetupChange(change.id)}>X</button>
                </div>
                <div className={styles.changeDiffs}>
                  <SetupDiffRow label="Front Wing" prev={change.previousSetup.frontWing} next={change.newSetup.frontWing} />
                  <SetupDiffRow label="Rear Wing" prev={change.previousSetup.rearWing} next={change.newSetup.rearWing} />
                  <SetupDiffRow label="Front Camber" prev={change.previousSetup.frontCamber} next={change.newSetup.frontCamber} unit="°" />
                  <SetupDiffRow label="Rear Camber" prev={change.previousSetup.rearCamber} next={change.newSetup.rearCamber} unit="°" />
                  <SetupDiffRow label="Front Toe" prev={change.previousSetup.frontToe} next={change.newSetup.frontToe} unit="°" />
                  <SetupDiffRow label="Rear Toe" prev={change.previousSetup.rearToe} next={change.newSetup.rearToe} unit="°" />
                  <SetupDiffRow label="Front Suspension" prev={change.previousSetup.frontSuspension} next={change.newSetup.frontSuspension} />
                  <SetupDiffRow label="Rear Suspension" prev={change.previousSetup.rearSuspension} next={change.newSetup.rearSuspension} />
                  <SetupDiffRow label="Front ARB" prev={change.previousSetup.frontAntiRollBar} next={change.newSetup.frontAntiRollBar} />
                  <SetupDiffRow label="Rear ARB" prev={change.previousSetup.rearAntiRollBar} next={change.newSetup.rearAntiRollBar} />
                  <SetupDiffRow label="Front Ride Height" prev={change.previousSetup.frontRideHeight} next={change.newSetup.frontRideHeight} />
                  <SetupDiffRow label="Rear Ride Height" prev={change.previousSetup.rearRideHeight} next={change.newSetup.rearRideHeight} />
                  <SetupDiffRow label="Brake Pressure" prev={change.previousSetup.brakePressure} next={change.newSetup.brakePressure} unit="%" />
                  <SetupDiffRow label="Engine Braking" prev={change.previousSetup.engineBraking} next={change.newSetup.engineBraking} unit="%" />
                  {change.previousSetup.tyrePressures && change.newSetup.tyrePressures &&
                    ['FL', 'FR', 'RL', 'RR'].map((w, i) => (
                      <SetupDiffRow key={w} label={`${w} Tyre PSI`} prev={change.previousSetup.tyrePressures[i]} next={change.newSetup.tyrePressures[i]} unit=" PSI" />
                    ))
                  }
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {(feedbacks.length > 0 || setupChanges.length > 0) && (
        <div className={styles.globalReset}>
          <button className={styles.globalResetBtn} onClick={() => { if (window.confirm('Delete all?')) resetAll(); }}>CLEAR ALL DATA</button>
        </div>
      )}
    </div>
  );
}
