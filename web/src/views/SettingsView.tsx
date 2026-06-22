import { useEffect, useState } from 'react';
import { useSettings } from '../hooks/useSettings';
import { useLocalStorage } from '../hooks/useLocalStorage';
import type {
  AppConfig,
  DataStorageMode,
  ForwardTarget,
  TireWearDisplayMode,
} from '../types/telemetry';
import styles from './SettingsView.module.css';

const STORAGE_MODE_OPTIONS: Array<{
  value: DataStorageMode;
  label: string;
  description: string;
}> = [
  {
    value: 'advanced',
    label: 'Advanced (High Storage)',
    description: 'Save full incoming UDP data + replay timeline snapshots.',
  },
  {
    value: 'resultOnly',
    label: 'Result Only (Lowest Storage)',
    description: 'Save race result summary only (current behavior).',
  },
  {
    value: 'summary',
    label: 'Summary (Low Storage)',
    description: 'Save dashboard-visible data as timeline snapshots only.',
  },
];

export function SettingsView() {
  const { config, tracks, loading, saving, updateConfig } = useSettings();
  const [draft, setDraft] = useState<AppConfig | null>(null);
  const [wearDisplayMode, setWearDisplayMode] = useLocalStorage<TireWearDisplayMode>(
    'tireWearDisplayMode',
    'absolute',
    (v) => (v === 'absolute' || v === 'relative' ? v : null),
  );
  const [guideOpen, setGuideOpen] = useState(false);

  useEffect(() => {
    if (config && !draft) {
      setDraft({
        ...config,
        raceSummaryRecording: true,
        dataStorageMode: config.dataStorageMode ?? 'resultOnly',
      });
    }
  }, [config, draft]);

  if (loading || !draft) {
    return <div className={styles.loading}>Loading settings...</div>;
  }

  function save() {
    if (!draft) return;
    updateConfig({
      ...draft,
      raceSummaryRecording: true,
      dataStorageMode: draft.dataStorageMode ?? 'resultOnly',
    });
  }

  function setField<K extends keyof AppConfig>(key: K, value: AppConfig[K]) {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  function setStorageMode(mode: DataStorageMode) {
    setDraft((prev) => (prev ? { ...prev, dataStorageMode: mode, raceSummaryRecording: true } : prev));
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
      setField(key, 0 as AppConfig[K]);
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

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Data Storage</h3>
        <div className={styles.modeOptions}>
          {STORAGE_MODE_OPTIONS.map((option) => {
            const selected = draft.dataStorageMode === option.value;
            return (
              <button
                key={option.value}
                type="button"
                className={`${styles.modeOption} ${selected ? styles.modeOptionActive : ''}`}
                onClick={() => setStorageMode(option.value)}
              >
                <span className={styles.modeLabel}>{option.label}</span>
                <span className={styles.modeHint}>{option.description}</span>
              </button>
            );
          })}
        </div>
      </div>

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
            Records one lap of player position data and saves as CSV.
          </span>
        </div>

        <h4 className={styles.sectionTitle}>Loaded Track Files</h4>
        <div className={styles.trackList}>
          {(tracks ?? []).length === 0 ? (
            <span className={styles.hint}>No recorded track files found.</span>
          ) : (
            (tracks ?? []).map((t) => (
              <span key={t.filename} className={styles.trackBadgeLoaded}>
                {t.name}
              </span>
            ))
          )}
        </div>
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Display</h3>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Tire Wear Mode</span>
          <div className={styles.segmentedControl}>
            <button
              className={`${styles.segmentBtn} ${wearDisplayMode === 'absolute' ? styles.segmentBtnActive : ''}`}
              onClick={() => setWearDisplayMode('absolute')}
            >
              Absolute
            </button>
            <button
              className={`${styles.segmentBtn} ${wearDisplayMode === 'relative' ? styles.segmentBtnActive : ''}`}
              onClick={() => setWearDisplayMode('relative')}
            >
              Relative
            </button>
          </div>
        </div>
        <span className={styles.hint}>
          {wearDisplayMode === 'absolute'
            ? 'Absolute: total predicted wear after N more laps (ex: 75%).'
            : 'Relative: additional wear over the next N laps (ex: +15%).'}
        </span>
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Leaderboard Guide</h3>
        <span className={styles.hint}>
          Learn what each column on the race leaderboard means.
        </span>
        <button type="button" className={styles.btn} onClick={() => setGuideOpen(true)} style={{ marginTop: 10 }}>
          Open Guide
        </button>
      </div>

      {guideOpen && (
        <div className={styles.guideOverlay} onClick={() => setGuideOpen(false)}>
          <div className={styles.guideModal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.guideHeader}>
              <h3 className={styles.sectionTitle} style={{ marginBottom: 0, paddingBottom: 0, borderBottom: 'none' }}>
                Leaderboard Column Guide
              </h3>
              <button type="button" className={styles.btn} onClick={() => setGuideOpen(false)}>
                Close
              </button>
            </div>
            <div className={styles.guideBody}>
              <div className={styles.guideEntry}>
                <strong>Pos</strong>
                <span>Current race position (01, 02, ...).</span>
              </div>
              <div className={styles.guideEntry}>
                <strong>Driver</strong>
                <span>Driver name abbreviation, team color stripe, and team name. "YOU" marks your car, "TEAM" marks your teammate.</span>
              </div>
              <div className={styles.guideEntry}>
                <strong>DRS</strong>
                <span>DRS (Drag Reduction System) activation status. Lights up when DRS is currently open.</span>
              </div>
              <div className={styles.guideEntry}>
                <strong>Pit</strong>
                <span>Pit lane status. Shows "IN" when the car is in the pit lane, "PIT" when actively pitting, and the pit stop duration in seconds. Requires Pit Status permission.</span>
              </div>
              <div className={styles.guideEntry}>
                <strong>ERS</strong>
                <span>Actual ERS (Energy Recovery System) battery level as a percentage. Requires ERS permission.</span>
              </div>
              <div className={styles.guideEntry}>
                <strong>ERS Compare</strong>
                <span>When comparison is enabled, shows the actual ERS percentage with the estimate delta. "A38% Δ+7" means actual 38% and estimate 7 points higher. Requires ERS and ERS Estimate permissions.</span>
              </div>
              <div className={styles.guideEntry}>
                <strong>Vmax</strong>
                <span>Top speed recorded at the speed trap during the session (km/h). Requires Top Speed permission.</span>
              </div>
              <div className={styles.guideEntry}>
                <strong>To You / Gap</strong>
                <span>With Player Delta permission: time gap to your car (negative = ahead of you). Without permission: gap to race leader.</span>
              </div>
              <div className={styles.guideEntry}>
                <strong>Interval</strong>
                <span>Time gap to the car directly ahead in the race. The leader shows no interval.</span>
              </div>
              <div className={styles.guideEntry}>
                <strong>Sector {"\u0394"}</strong>
                <span>Current lap sector time compared to the session best. Green = best, yellow = close, red = slow. Shows S1, S2, S3 as each sector is completed.</span>
              </div>
              <div className={styles.guideEntry}>
                <strong>Last Lap</strong>
                <span>Last completed lap time in minutes:seconds.milliseconds format.</span>
              </div>
              <div className={styles.guideEntry}>
                <strong>Pen</strong>
                <span>Active penalties and warnings. Shows penalty count, warning count, corner cutting warnings, and unserved drive-throughs or stop-go penalties.</span>
              </div>
              <div className={styles.guideEntry}>
                <strong>Tyre Age</strong>
                <span>Current tire compound (S=Soft, M=Medium, H=Hard, I=Inter, W=Wet) with a color dot, and the number of laps on the current set.</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {dirty && (
        <button className={styles.btnPrimary} onClick={save} disabled={saving}>
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      )}
    </div>
  );
}
