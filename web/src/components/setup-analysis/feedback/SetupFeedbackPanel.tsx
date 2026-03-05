import { useState, useEffect } from 'react';
import type { DriverInfo } from '../../../types/telemetry';
import { useSetupFeedbackStore } from '../../../store/setupFeedbackStore';
import { diagnose, type SymptomId } from '../diagnosis/scoring';
import type { LapFeedback } from '../../../store/setupFeedbackStore';
import styles from './SetupFeedbackPanel.module.css';

interface Props {
  driver: DriverInfo;
  selectedSymptoms: Set<SymptomId>;
}

const RATING_OPTIONS: { value: LapFeedback['rating']; label: string; color: string }[] = [
  { value: 'good', label: 'Good', color: '#00ff00' },
  { value: 'neutral', label: 'Neutral', color: '#ffcc00' },
  { value: 'bad', label: 'Bad', color: '#e10600' },
];

function formatTime(ts: number): string {
  const d = new Date(ts);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  const s = d.getSeconds().toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function SetupDiffRow({ label, prev, next, unit }: { label: string; prev: number; next: number; unit?: string }) {
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
}

export function SetupFeedbackPanel({ driver, selectedSymptoms }: Props) {
  const [note, setNote] = useState('');
  const [rating, setRating] = useState<LapFeedback['rating']>('neutral');
  const {
    feedbacks,
    setupChanges,
    addFeedback,
    deleteFeedback,
    resetFeedbacks,
    checkSetupChange,
    deleteSetupChange,
    resetSetupChanges,
    resetAll,
  } = useSetupFeedbackStore();

  // Check for setup changes whenever driver setup updates
  useEffect(() => {
    const results = diagnose(driver, selectedSymptoms);
    checkSetupChange(driver.setup, driver.currentLapNum, results);
  }, [driver.setup, driver.currentLapNum, selectedSymptoms, checkSetupChange]);

  const handleAddFeedback = () => {
    if (!note.trim()) return;
    addFeedback(driver.currentLapNum, note.trim(), rating);
    setNote('');
    setRating('neutral');
  };

  const handleResetAll = () => {
    if (window.confirm('모든 피드백과 셋업 변경 기록을 초기화하시겠습니까?')) {
      resetAll();
    }
  };

  return (
    <div className={styles.container}>
      {/* Add Feedback */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionTitle}>랩 피드백 추가</span>
          <span className={styles.lapBadge}>Lap {driver.currentLapNum}</span>
        </div>
        <div className={styles.inputRow}>
          <div className={styles.ratingGroup}>
            {RATING_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                className={`${styles.ratingBtn} ${rating === opt.value ? styles.ratingBtnActive : ''}`}
                style={rating === opt.value ? { borderColor: opt.color, color: opt.color } : undefined}
                onClick={() => setRating(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className={styles.noteRow}>
            <input
              className={styles.noteInput}
              type="text"
              placeholder="피드백을 입력하세요..."
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddFeedback(); }}
            />
            <button className={styles.addBtn} onClick={handleAddFeedback} disabled={!note.trim()}>
              추가
            </button>
          </div>
        </div>
      </div>

      {/* Feedback History */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionTitle}>피드백 기록 ({feedbacks.length})</span>
          {feedbacks.length > 0 && (
            <button className={styles.resetBtn} onClick={() => { if (window.confirm('피드백 기록을 모두 삭제하시겠습니까?')) resetFeedbacks(); }}>
              Reset
            </button>
          )}
        </div>
        {feedbacks.length === 0 ? (
          <div className={styles.empty}>피드백 기록이 없습니다. 위에서 피드백을 추가하세요.</div>
        ) : (
          <div className={styles.list}>
            {[...feedbacks].reverse().map((fb) => (
              <div key={fb.id} className={styles.feedbackItem}>
                <div className={styles.feedbackHeader}>
                  <span className={styles.feedbackLap}>Lap {fb.lapNum}</span>
                  <span
                    className={styles.feedbackRating}
                    style={{ color: RATING_OPTIONS.find((r) => r.value === fb.rating)?.color }}
                  >
                    {RATING_OPTIONS.find((r) => r.value === fb.rating)?.label}
                  </span>
                  <span className={styles.feedbackTime}>{formatTime(fb.timestamp)}</span>
                  <button className={styles.deleteBtn} onClick={() => deleteFeedback(fb.id)} title="삭제">
                    X
                  </button>
                </div>
                <div className={styles.feedbackNote}>{fb.note}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Setup Change History */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionTitle}>셋업 변경 기록 ({setupChanges.length})</span>
          {setupChanges.length > 0 && (
            <button className={styles.resetBtn} onClick={() => { if (window.confirm('셋업 변경 기록을 모두 삭제하시겠습니까?')) resetSetupChanges(); }}>
              Reset
            </button>
          )}
        </div>
        {setupChanges.length === 0 ? (
          <div className={styles.empty}>셋업 변경 기록이 없습니다. 셋업을 변경하면 자동으로 기록됩니다.</div>
        ) : (
          <div className={styles.list}>
            {[...setupChanges].reverse().map((change) => (
              <div key={change.id} className={styles.changeItem}>
                <div className={styles.changeHeader}>
                  <span className={styles.changeLap}>Lap {change.lapNum}</span>
                  <span className={styles.changeTime}>{formatTime(change.timestamp)}</span>
                  <button className={styles.deleteBtn} onClick={() => deleteSetupChange(change.id)} title="삭제">
                    X
                  </button>
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
                      <SetupDiffRow
                        key={w}
                        label={`${w} Tyre PSI`}
                        prev={change.previousSetup.tyrePressures[i]}
                        next={change.newSetup.tyrePressures[i]}
                        unit=" PSI"
                      />
                    ))
                  }
                </div>
                {change.recommendations.length > 0 && (
                  <div className={styles.changeRecs}>
                    <span className={styles.changeRecsTitle}>변경 시점 추천사항</span>
                    {change.recommendations.map((rec, ri) => (
                      <div key={ri} className={styles.changeRecItem}>
                        <span className={styles.changeRecSeverity} style={{
                          color: rec.severity === 'red' ? '#e10600' : rec.severity === 'yellow' ? '#ffcc00' : '#00ff00'
                        }}>
                          {rec.title}
                        </span>
                        {rec.adjustments.map((adj, ai) => (
                          <span key={ai} className={styles.changeRecAdj}>
                            {adj.label}: {adj.current && adj.target ? `${adj.current} → ${adj.target}` : adj.delta}
                          </span>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Global Reset */}
      {(feedbacks.length > 0 || setupChanges.length > 0) && (
        <div className={styles.globalReset}>
          <button className={styles.globalResetBtn} onClick={handleResetAll}>
            전체 초기화
          </button>
        </div>
      )}
    </div>
  );
}
