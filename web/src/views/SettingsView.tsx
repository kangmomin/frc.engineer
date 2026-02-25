import { useState, useEffect } from 'react';
import { useSettings } from '../hooks/useSettings';
import { useLocalStorage } from '../hooks/useLocalStorage';
import type { AppConfig, ForwardTarget, TireWearDisplayMode } from '../types/telemetry';
import styles from './SettingsView.module.css';

export function SettingsView() {
  const { config, tracks, loading, saving, restartRequired, updateConfig } = useSettings();
  const [draft, setDraft] = useState<AppConfig | null>(null);
  const [wearDisplayMode, setWearDisplayMode] = useLocalStorage<TireWearDisplayMode>(
    'tireWearDisplayMode',
    'absolute',
    (v) => (v === 'absolute' || v === 'relative' ? v : null),
  );

  useEffect(() => {
    if (config && !draft) {
      setDraft(config);
    }
  }, [config, draft]);

  if (loading || !draft) {
    return <div className={styles.loading}>Loading settings...</div>;
  }

  function save() {
    if (draft) updateConfig(draft);
  }

  function setField<K extends keyof AppConfig>(key: K, value: AppConfig[K]) {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  function updateTarget(index: number, field: keyof ForwardTarget, value: string | number | boolean) {
    setDraft((prev) => {
      if (!prev) return prev;
      const targets = [...prev.forwardTargets];
      targets[index] = { ...targets[index], [field]: value };
      return { ...prev, forwardTargets: targets };
    });
  }

  function addTarget() {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        forwardTargets: [...prev.forwardTargets, { host: '127.0.0.1', port: 20777, enabled: true }],
      };
    });
  }

  function removeTarget(index: number) {
    setDraft((prev) => {
      if (!prev) return prev;
      return { ...prev, forwardTargets: prev.forwardTargets.filter((_, i) => i !== index) };
    });
  }

  function handleNumberInput<K extends keyof AppConfig>(key: K, value: string) {
    if (value === '') {
      setField(key, 0 as AppConfig[K]); // Fallback, could be typed better if we allowed undefined
      return;
    }
    const num = parseInt(value, 10);
    if (!isNaN(num)) {
      setField(key, num as AppConfig[K]);
    }
  }

  function handleTargetPortInput(index: number, value: string) {
    if (value === '') {
      updateTarget(index, 'port', 0);
      return;
    }
    const num = parseInt(value, 10);
    if (!isNaN(num)) {
      updateTarget(index, 'port', num);
    }
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(config);

  return (
    <div className={styles.settings}>
      {/* Port Settings */}
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Port Settings</h3>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Backend Port</span>
          <input
            className={styles.input}
            type="number"
            value={draft.backendPort || ''}
            onChange={(e) => handleNumberInput('backendPort', e.target.value)}
          />
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>UDP Port</span>
          <input
            className={styles.input}
            type="number"
            value={draft.udpPort || ''}
            onChange={(e) => handleNumberInput('udpPort', e.target.value)}
          />
        </div>
      </div>

      {/* UDP Forwarding */}
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>UDP Forwarding</h3>
        {draft.forwardTargets.map((t, i) => (
          <div key={i} className={styles.targetRow}>
            <input
              className={styles.targetInput}
              type="text"
              placeholder="Host"
              value={t.host}
              onChange={(e) => updateTarget(i, 'host', e.target.value)}
            />
            <input
              className={styles.portInput}
              type="number"
              placeholder="Port"
              value={t.port || ''}
              onChange={(e) => handleTargetPortInput(i, e.target.value)}
            />
            <input
              className={styles.toggle}
              type="checkbox"
              checked={t.enabled}
              onChange={(e) => updateTarget(i, 'enabled', e.target.checked)}
              title={t.enabled ? 'Enabled' : 'Disabled'}
            />
            <button className={styles.btnDanger} onClick={() => removeTarget(i)}>
              Remove
            </button>
          </div>
        ))}
        <button className={styles.btn} onClick={addTarget}>
          + Add Target
        </button>
      </div>

      {/* Track Recording */}
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Track Recording</h3>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Record Track</span>
          <input
            className={styles.toggle}
            type="checkbox"
            checked={draft.trackRecording}
            onChange={(e) => setField('trackRecording', e.target.checked)}
          />
          <span className={styles.hint}>
            Records one lap of position data from the player car and saves as CSV
          </span>
        </div>

        <h4 className={styles.sectionTitle}>저장된 트랙 파일</h4>
        <div className={styles.trackList}>
          {(tracks ?? []).length === 0 ? (
            <span className={styles.hint}>저장된 트랙 파일이 없습니다</span>
          ) : (
            (tracks ?? []).map((t) => (
              <span key={t.filename} className={styles.trackBadgeLoaded}>
                {t.name}
              </span>
            ))
          )}
        </div>
      </div>

      {/* Race Summary Recording */}
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Race Summary Recording</h3>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Save Race Summaries</span>
          <input
            className={styles.toggle}
            type="checkbox"
            checked={draft.raceSummaryRecording}
            onChange={(e) => setField('raceSummaryRecording', e.target.checked)}
          />
          <span className={styles.hint}>
            Save processed race summaries at race end (non-RAW JSON)
          </span>
        </div>
      </div>

      {/* Display Settings */}
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Display</h3>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>타이어 마모 예측</span>
          <div className={styles.segmentedControl}>
            <button
              className={`${styles.segmentBtn} ${wearDisplayMode === 'absolute' ? styles.segmentBtnActive : ''}`}
              onClick={() => setWearDisplayMode('absolute')}
            >
              절대치
            </button>
            <button
              className={`${styles.segmentBtn} ${wearDisplayMode === 'relative' ? styles.segmentBtnActive : ''}`}
              onClick={() => setWearDisplayMode('relative')}
            >
              상대치
            </button>
          </div>
        </div>
        <span className={styles.hint}>
          {wearDisplayMode === 'absolute'
            ? '절대치: N랩 후 예상 총 마모도 표시 (예: 75%)'
            : '상대치: N랩 동안 추가 마모량 표시 (예: +15%)'}
        </span>
      </div>

      {/* Restart warning */}
      {restartRequired && (
        <div className={styles.restartWarning}>
          프로그램을 재시작해야 적용됩니다.
        </div>
      )}

      {/* Save button */}
      {dirty && (
        <button className={styles.btnPrimary} onClick={save} disabled={saving}>
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      )}
    </div>
  );
}
