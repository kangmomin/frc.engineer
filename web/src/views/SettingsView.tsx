import { useCallback, useEffect, useState } from 'react';
import { useSettings } from '../hooks/useSettings';
import { useLocalStorage } from '../hooks/useLocalStorage';
import type {
  AppConfig,
  DataStorageMode,
  FeaturePermissions,
  ForwardTarget,
  TireWearDisplayMode,
} from '../types/telemetry';
import styles from './SettingsView.module.css';

interface PermissionCodeEntry {
  code: string;
  label: string;
  permissions: FeaturePermissions;
}

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

function getDefaultSignalingUrl(): string {
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    const queryValue = params.get('signalingUrl');
    if (queryValue) {
      return queryValue;
    }
  }
  return import.meta.env.VITE_SIGNALING_URL || '';
}

function getPermissionCodesEndpoint(signalingUrl: string, code?: string): string {
  const url = new URL(signalingUrl);
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  url.pathname = code ? `/api/permission-codes/${encodeURIComponent(code)}` : '/api/permission-codes';
  url.search = '';
  url.hash = '';
  return url.toString();
}

function createEmptyPermissionCode(): PermissionCodeEntry {
  return {
    code: '',
    label: '',
    permissions: {
      viewERSActual: false,
      viewAdvancedStrategy: false,
      viewPitStatus: false,
      viewTopSpeed: false,
      viewPlayerDelta: false,
      viewCommentary: false,
    },
  };
}

export function SettingsView() {
  const { config, tracks, loading, saving, updateConfig } = useSettings();
  const [draft, setDraft] = useState<AppConfig | null>(null);
  const [wearDisplayMode, setWearDisplayMode] = useLocalStorage<TireWearDisplayMode>(
    'tireWearDisplayMode',
    'absolute',
    (v) => (v === 'absolute' || v === 'relative' ? v : null),
  );
  const [signalingUrl, setSignalingUrl] = useState(getDefaultSignalingUrl);
  const [permissionCodes, setPermissionCodes] = useState<PermissionCodeEntry[]>([]);
  const [permissionDraft, setPermissionDraft] = useState<PermissionCodeEntry>(createEmptyPermissionCode);
  const [selectedPermissionCode, setSelectedPermissionCode] = useState('');
  const [permissionLoading, setPermissionLoading] = useState(false);
  const [permissionSaving, setPermissionSaving] = useState(false);
  const [permissionError, setPermissionError] = useState('');
  const [permissionStatus, setPermissionStatus] = useState('');

  useEffect(() => {
    if (config && !draft) {
      setDraft({
        ...config,
        raceSummaryRecording: true,
        dataStorageMode: config.dataStorageMode ?? 'resultOnly',
      });
    }
  }, [config, draft]);

  const loadPermissionCodes = useCallback(async () => {
    if (!signalingUrl.trim()) {
      setPermissionCodes([]);
      setPermissionError('');
      return;
    }

    let endpoint = '';
    try {
      endpoint = getPermissionCodesEndpoint(signalingUrl);
    } catch {
      setPermissionCodes([]);
      setPermissionError('Invalid signaling URL.');
      return;
    }

    setPermissionLoading(true);
    setPermissionError('');
    try {
      const response = await fetch(endpoint);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = await response.json();
      setPermissionCodes(Array.isArray(payload) ? payload as PermissionCodeEntry[] : []);
    } catch {
      setPermissionCodes([]);
      setPermissionError('Failed to load permission codes from signaling server.');
    } finally {
      setPermissionLoading(false);
    }
  }, [signalingUrl]);

  useEffect(() => {
    void loadPermissionCodes();
  }, [loadPermissionCodes]);

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

  function selectPermissionCode(entry: PermissionCodeEntry) {
    setSelectedPermissionCode(entry.code);
    setPermissionDraft({
      code: entry.code,
      label: entry.label,
      permissions: { ...entry.permissions },
    });
    setPermissionError('');
    setPermissionStatus('');
  }

  function resetPermissionEditor() {
    setSelectedPermissionCode('');
    setPermissionDraft(createEmptyPermissionCode());
    setPermissionError('');
    setPermissionStatus('');
  }

  function updatePermissionField<K extends keyof PermissionCodeEntry>(key: K, value: PermissionCodeEntry[K]) {
    setPermissionDraft((prev) => ({ ...prev, [key]: value }));
    setPermissionError('');
    setPermissionStatus('');
  }

  function updatePermissionFlag(key: keyof FeaturePermissions, enabled: boolean) {
    setPermissionDraft((prev) => ({
      ...prev,
      permissions: {
        ...prev.permissions,
        [key]: enabled,
      },
    }));
    setPermissionError('');
    setPermissionStatus('');
  }

  async function savePermissionCode() {
    const code = permissionDraft.code.trim();
    if (!code || !signalingUrl.trim()) {
      setPermissionError('Signaling URL and permission code are required.');
      return;
    }

    let endpoint = '';
    try {
      endpoint = getPermissionCodesEndpoint(signalingUrl, code);
    } catch {
      setPermissionError('Invalid signaling URL.');
      return;
    }

    setPermissionSaving(true);
    setPermissionError('');
    setPermissionStatus('');
    try {
      const response = await fetch(endpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: permissionDraft.label.trim(),
          permissions: permissionDraft.permissions,
        }),
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }

      const saved = await response.json() as PermissionCodeEntry;
      setPermissionCodes((prev) => {
        const next = prev.filter((entry) => entry.code !== saved.code);
        next.push(saved);
        next.sort((a, b) => a.code.localeCompare(b.code));
        return next;
      });
      setSelectedPermissionCode(saved.code);
      setPermissionDraft(saved);
      setPermissionStatus('Permission code saved.');
    } catch (error) {
      setPermissionError(error instanceof Error && error.message ? error.message : 'Failed to save permission code.');
    } finally {
      setPermissionSaving(false);
    }
  }

  async function deletePermissionCode() {
    const code = selectedPermissionCode || permissionDraft.code.trim();
    if (!code || !signalingUrl.trim()) {
      setPermissionError('Select a permission code to delete.');
      return;
    }

    let endpoint = '';
    try {
      endpoint = getPermissionCodesEndpoint(signalingUrl, code);
    } catch {
      setPermissionError('Invalid signaling URL.');
      return;
    }

    setPermissionSaving(true);
    setPermissionError('');
    setPermissionStatus('');
    try {
      const response = await fetch(endpoint, { method: 'DELETE' });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      setPermissionCodes((prev) => prev.filter((entry) => entry.code !== code));
      resetPermissionEditor();
      setPermissionStatus('Permission code deleted.');
    } catch (error) {
      setPermissionError(error instanceof Error && error.message ? error.message : 'Failed to delete permission code.');
    } finally {
      setPermissionSaving(false);
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
            ? 'Absolute: shows total predicted wear at N laps (ex: 75%).'
            : 'Relative: shows additional wear over N laps (ex: +15%).'}
        </span>
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Remote Permission Codes</h3>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Signaling Server</span>
          <input
            className={styles.wideInput}
            type="text"
            value={signalingUrl}
            placeholder="wss://your-signaling-server.example/ws"
            onChange={(event) => {
              setSignalingUrl(event.target.value);
              setPermissionError('');
              setPermissionStatus('');
            }}
          />
          <button type="button" className={styles.btn} onClick={() => void loadPermissionCodes()}>
            Refresh
          </button>
        </div>
        <span className={styles.hint}>
          Manage permission bundles on the signaling server. Engineers can enter one code at join time to unlock these features.
        </span>

        <div className={styles.permissionLayout}>
          <div className={styles.permissionList}>
            {(permissionCodes.length === 0 && !permissionLoading) ? (
              <div className={styles.permissionEmpty}>No permission codes found.</div>
            ) : (
              permissionCodes.map((entry) => (
                <button
                  key={entry.code}
                  type="button"
                  className={`${styles.permissionCard} ${selectedPermissionCode === entry.code ? styles.permissionCardActive : ''}`}
                  onClick={() => selectPermissionCode(entry)}
                >
                  <div className={styles.permissionCardHeader}>
                    <strong>{entry.label || entry.code}</strong>
                    <span>{entry.code}</span>
                  </div>
                  <div className={styles.permissionBadges}>
                    <span className={styles.trackBadgeLoaded}>
                      {entry.permissions.viewERSActual ? 'ERS Actual' : 'ERS Hidden'}
                    </span>
                    <span className={styles.trackBadgeLoaded}>
                      {entry.permissions.viewPitStatus ? 'Pit Status' : 'Pit Hidden'}
                    </span>
                    <span className={styles.trackBadgeLoaded}>
                      {entry.permissions.viewTopSpeed ? 'Top Speed' : 'Top Speed Hidden'}
                    </span>
                    <span className={styles.trackBadgeLoaded}>
                      {entry.permissions.viewPlayerDelta ? 'Player Delta' : 'Leader Gap'}
                    </span>
                    <span className={styles.trackBadgeLoaded}>
                      {entry.permissions.viewAdvancedStrategy ? 'Advanced Strategy' : 'Basic Strategy'}
                    </span>
                    <span className={styles.trackBadgeLoaded}>
                      {entry.permissions.viewCommentary ? 'Commentary' : 'Commentary Hidden'}
                    </span>
                  </div>
                </button>
              ))
            )}
            {permissionLoading && <span className={styles.status}>Loading permission codes...</span>}
          </div>

          <div className={styles.permissionEditor}>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>Code</span>
              <input
                className={styles.input}
                type="text"
                value={permissionDraft.code}
                placeholder="ENG-PRO"
                onChange={(event) => updatePermissionField('code', event.target.value.toUpperCase())}
              />
            </div>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>Label</span>
              <input
                className={styles.wideInput}
                type="text"
                value={permissionDraft.label}
                placeholder="Engineer Pro"
                onChange={(event) => updatePermissionField('label', event.target.value)}
              />
            </div>
            <div className={styles.permissionToggles}>
              <label className={styles.permissionToggle}>
                <span className={styles.fieldLabel}>ERS Actual</span>
                <input
                  className={styles.toggle}
                  type="checkbox"
                  checked={permissionDraft.permissions.viewERSActual}
                  onChange={(event) => updatePermissionFlag('viewERSActual', event.target.checked)}
                />
              </label>
              <label className={styles.permissionToggle}>
                <span className={styles.fieldLabel}>Pit Status</span>
                <input
                  className={styles.toggle}
                  type="checkbox"
                  checked={permissionDraft.permissions.viewPitStatus}
                  onChange={(event) => updatePermissionFlag('viewPitStatus', event.target.checked)}
                />
              </label>
              <label className={styles.permissionToggle}>
                <span className={styles.fieldLabel}>Top Speed</span>
                <input
                  className={styles.toggle}
                  type="checkbox"
                  checked={permissionDraft.permissions.viewTopSpeed}
                  onChange={(event) => updatePermissionFlag('viewTopSpeed', event.target.checked)}
                />
              </label>
              <label className={styles.permissionToggle}>
                <span className={styles.fieldLabel}>Player Delta</span>
                <input
                  className={styles.toggle}
                  type="checkbox"
                  checked={permissionDraft.permissions.viewPlayerDelta}
                  onChange={(event) => updatePermissionFlag('viewPlayerDelta', event.target.checked)}
                />
              </label>
              <label className={styles.permissionToggle}>
                <span className={styles.fieldLabel}>Advanced Strategy</span>
                <input
                  className={styles.toggle}
                  type="checkbox"
                  checked={permissionDraft.permissions.viewAdvancedStrategy}
                  onChange={(event) => updatePermissionFlag('viewAdvancedStrategy', event.target.checked)}
                />
              </label>
              <label className={styles.permissionToggle}>
                <span className={styles.fieldLabel}>Commentary</span>
                <input
                  className={styles.toggle}
                  type="checkbox"
                  checked={permissionDraft.permissions.viewCommentary}
                  onChange={(event) => updatePermissionFlag('viewCommentary', event.target.checked)}
                />
              </label>
            </div>
            <div className={styles.permissionActions}>
              <button type="button" className={styles.btnPrimary} onClick={savePermissionCode} disabled={permissionSaving}>
                {permissionSaving ? 'Saving...' : 'Save Code'}
              </button>
              <button type="button" className={styles.btn} onClick={resetPermissionEditor} disabled={permissionSaving}>
                New
              </button>
              <button
                type="button"
                className={styles.btnDanger}
                onClick={deletePermissionCode}
                disabled={permissionSaving || (!selectedPermissionCode && !permissionDraft.code.trim())}
              >
                Delete
              </button>
            </div>
            {permissionStatus && <span className={`${styles.status} ${styles.statusActive}`}>{permissionStatus}</span>}
            {permissionError && <span className={styles.restartWarning}>{permissionError}</span>}
          </div>
        </div>
      </div>

      {dirty && (
        <button className={styles.btnPrimary} onClick={save} disabled={saving}>
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      )}
    </div>
  );
}
