import { useState, useEffect } from 'react';
import { useSettings } from '../hooks/useSettings';
import type { AppConfig, ForwardTarget } from '../types/telemetry';
import styles from './SettingsView.module.css';

export function SettingsView() {
  const { config, tracks, loading, saving, updateConfig } = useSettings();
  const [draft, setDraft] = useState<AppConfig | null>(null);

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

  const dirty = JSON.stringify(draft) !== JSON.stringify(config);

  return (
    <div className={styles.settings}>
      {/* UDP Settings */}
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>UDP Settings</h3>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Listen Port</span>
          <input
            className={styles.input}
            type="number"
            value={draft.udpPort}
            onChange={(e) => setField('udpPort', parseInt(e.target.value) || 0)}
          />
          <span className={styles.hint}>Requires server restart to take effect</span>
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
              value={t.port}
              onChange={(e) => updateTarget(i, 'port', parseInt(e.target.value) || 0)}
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

        <h4 className={styles.sectionTitle}>Known Tracks</h4>
        <div className={styles.trackList}>
          {(tracks ?? []).map((t) => (
            <span key={t.id} className={t.hasData ? styles.trackBadgeLoaded : styles.trackBadge}>
              {t.name}
            </span>
          ))}
        </div>
      </div>

      {/* Save button */}
      {dirty && (
        <button className={styles.btnPrimary} onClick={save} disabled={saving}>
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      )}
    </div>
  );
}
