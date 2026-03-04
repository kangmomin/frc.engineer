import type { DriverInfo } from '../../../types/telemetry';
import { SeverityDot } from '../shared/SeverityDot';
import { diagnose, SYMPTOM_LIST, type SymptomId } from './scoring';
import styles from './DiagnosisPanel.module.css';

interface Props {
  driver: DriverInfo;
  selectedSymptoms: Set<SymptomId>;
  onToggleSymptom: (id: SymptomId) => void;
}

const confidenceLabel: Record<string, string> = {
  high: '높음',
  medium: '중간',
  low: '낮음',
};

const badgeClass: Record<string, string> = {
  high: styles.badgeHigh,
  medium: styles.badgeMedium,
  low: styles.badgeLow,
};

export function DiagnosisPanel({ driver, selectedSymptoms, onToggleSymptom }: Props) {
  const results = diagnose(driver, selectedSymptoms);

  return (
    <>
      {/* Symptom Selector */}
      <div className={styles.section}>
        <span className={styles.sectionTitle}>체감 증상 선택</span>
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
        <span className={styles.sectionTitle}>우선순위 추천</span>
        {results.length === 0 ? (
          <div className={styles.empty}>
            감지된 문제가 없습니다. 위에서 증상을 선택하거나, 1랩을 완료하면 텔레메트리 분석이 시작됩니다.
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
                    <span className={`${styles.sourceTag} ${styles.sourceTelemetry}`}>텔레메트리</span>
                  )}
                  {r.userSelected && (
                    <span className={`${styles.sourceTag} ${styles.sourceUser}`}>사용자</span>
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
    </>
  );
}
