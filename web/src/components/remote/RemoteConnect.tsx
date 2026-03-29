import { useState, useRef, useCallback, useEffect } from 'react';
import type { FeaturePermissions } from '../../types/telemetry';
import styles from './RemoteConnect.module.css';

interface RemoteConnectProps {
  onConnect: (signalingUrl: string, roomId: string, password: string, permissionsCode: string) => void;
  connectionState: string;
  onCancel?: () => void;
  title?: string;
  subtitle?: string;
  initialSignalingUrl?: string;
  initialRoomId?: string;
  initialPassword?: string;
  initialPermissionsCode?: string;
}

interface RoomListItem {
  roomId: string;
  roomCode: string;
  roomName: string;
  requiresPassword: boolean;
  engineerCount: number;
}

interface PermissionCodeEntry {
  code: string;
  label: string;
  permissions: FeaturePermissions;
}

const STORAGE_KEY = 'frc_signaling_url';

function getDefaultSignalingUrl(): string {
  return localStorage.getItem(STORAGE_KEY) || import.meta.env.VITE_SIGNALING_URL || '';
}

function getRoomsEndpoint(signalingUrl: string): string {
  const url = new URL(signalingUrl);
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  url.pathname = '/api/rooms';
  url.search = '';
  url.hash = '';
  return url.toString();
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
    },
  };
}

export function RemoteConnect({
  onConnect,
  connectionState,
  onCancel,
  title = 'Remote Connect',
  subtitle = 'Choose a sender room and enter its password to join the live telemetry stream.',
  initialSignalingUrl = '',
  initialRoomId = '',
  initialPassword = '',
  initialPermissionsCode = '',
}: RemoteConnectProps) {
  const [signalingUrl, setSignalingUrl] = useState(initialSignalingUrl || getDefaultSignalingUrl);
  const [rooms, setRooms] = useState<RoomListItem[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState(initialRoomId);
  const [password, setPassword] = useState(initialPassword);
  const [permissionsCode, setPermissionsCode] = useState(initialPermissionsCode);
  const [loadingRooms, setLoadingRooms] = useState(false);
  const [roomsError, setRoomsError] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsPassword, setSettingsPassword] = useState('');
  const [settingsUnlocked, setSettingsUnlocked] = useState(false);
  const [permissionCodes, setPermissionCodes] = useState<PermissionCodeEntry[]>([]);
  const [permissionDraft, setPermissionDraft] = useState<PermissionCodeEntry>(createEmptyPermissionCode);
  const [selectedPermissionCode, setSelectedPermissionCode] = useState('');
  const [permissionLoading, setPermissionLoading] = useState(false);
  const [permissionSaving, setPermissionSaving] = useState(false);
  const [permissionError, setPermissionError] = useState('');
  const [permissionStatus, setPermissionStatus] = useState('');
  const passwordRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (initialSignalingUrl) {
      setSignalingUrl(initialSignalingUrl);
    }
  }, [initialSignalingUrl]);

  useEffect(() => {
    if (initialRoomId) {
      setSelectedRoomId(initialRoomId);
    }
  }, [initialRoomId]);

  useEffect(() => {
    setPassword(initialPassword);
  }, [initialPassword]);

  useEffect(() => {
    setPermissionsCode(initialPermissionsCode);
  }, [initialPermissionsCode]);

  const fetchRooms = useCallback(async () => {
    if (!signalingUrl) {
      setRooms([]);
      setRoomsError('');
      return;
    }

    let endpoint = '';
    try {
      endpoint = getRoomsEndpoint(signalingUrl);
    } catch {
      setRooms([]);
      setRoomsError('Invalid signaling URL.');
      return;
    }

    setLoadingRooms(true);
    setRoomsError('');
    try {
      const res = await fetch(endpoint);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const raw = await res.json();
      const data = Array.isArray(raw) ? (raw as RoomListItem[]) : [];
      setRooms(data);
      setSelectedRoomId((current) => {
        if (current && data.some((room) => room.roomId === current)) {
          return current;
        }
        if (initialRoomId && data.some((room) => room.roomId === initialRoomId)) {
          return initialRoomId;
        }
        return data[0]?.roomId ?? '';
      });
    } catch {
      setRooms([]);
      setRoomsError('Failed to load room list from signaling server.');
    } finally {
      setLoadingRooms(false);
    }
  }, [initialRoomId, signalingUrl]);

  const getSettingsHeaders = useCallback((contentType = false): HeadersInit => ({
    ...(contentType ? { 'Content-Type': 'application/json' } : {}),
    'X-Settings-Password': settingsPassword.trim(),
  }), [settingsPassword]);

  const fetchPermissionCodes = useCallback(async () => {
    if (!signalingUrl) {
      setPermissionCodes([]);
      setPermissionError('');
      return;
    }
    if (!settingsPassword.trim()) {
      setPermissionError('Settings password required.');
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
      const response = await fetch(endpoint, { headers: getSettingsHeaders() });
      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Invalid settings password.');
        }
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = await response.json();
      setPermissionCodes(Array.isArray(payload) ? payload as PermissionCodeEntry[] : []);
      setSettingsUnlocked(true);
    } catch (error) {
      setPermissionCodes([]);
      setSettingsUnlocked(false);
      setPermissionError(error instanceof Error && error.message ? error.message : 'Failed to load permission codes from signaling server.');
    } finally {
      setPermissionLoading(false);
    }
  }, [getSettingsHeaders, settingsPassword, signalingUrl]);

  useEffect(() => {
    void fetchRooms();
  }, [fetchRooms]);

  useEffect(() => {
    if (!selectedRoomId) return;
    const selectedRoom = rooms.find((room) => room.roomId === selectedRoomId);
    if (selectedRoom?.requiresPassword) {
      passwordRef.current?.focus();
    } else {
      setPassword('');
    }
  }, [rooms, selectedRoomId]);

  useEffect(() => {
    if (!signalingUrl) return;
    const timer = window.setInterval(() => {
      void fetchRooms();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [fetchRooms, signalingUrl]);

  const selectedRoom = rooms.find((room) => room.roomId === selectedRoomId) ?? null;
  const isConnecting = connectionState === 'connecting';
  const isReady = !!selectedRoom && (!selectedRoom.requiresPassword || password.length > 0) && signalingUrl.length > 0;

  const handleSubmit = useCallback(() => {
    if (!selectedRoom || !signalingUrl) return;
    localStorage.setItem(STORAGE_KEY, signalingUrl);
    onConnect(
      signalingUrl,
      selectedRoom.roomId,
      selectedRoom.requiresPassword ? password : '',
      permissionsCode.trim(),
    );
  }, [onConnect, password, permissionsCode, selectedRoom, signalingUrl]);

  function openSettingsModal() {
    setSettingsOpen(true);
    setPermissionError('');
    setPermissionStatus('');
  }

  function closeSettingsModal() {
    setSettingsOpen(false);
    setSettingsUnlocked(false);
    setSettingsPassword('');
    setPermissionError('');
    setPermissionStatus('');
  }

  function unlockSettings() {
    void fetchPermissionCodes();
  }

  function resetPermissionEditor() {
    setSelectedPermissionCode('');
    setPermissionDraft(createEmptyPermissionCode());
    setPermissionError('');
    setPermissionStatus('');
  }

  function selectPermission(entry: PermissionCodeEntry) {
    setSelectedPermissionCode(entry.code);
    setPermissionDraft({
      code: entry.code,
      label: entry.label,
      permissions: { ...entry.permissions },
    });
    setPermissionError('');
    setPermissionStatus('');
  }

  function updatePermissionFlag(key: keyof FeaturePermissions, value: boolean) {
    setPermissionDraft((prev) => ({
      ...prev,
      permissions: {
        ...prev.permissions,
        [key]: value,
      },
    }));
    setPermissionError('');
    setPermissionStatus('');
  }

  async function savePermissionCode() {
    const code = permissionDraft.code.trim();
    if (!settingsUnlocked || !settingsPassword.trim()) {
      setPermissionError('Unlock settings before editing permission codes.');
      return;
    }
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
        headers: getSettingsHeaders(true),
        body: JSON.stringify({
          label: permissionDraft.label.trim(),
          permissions: permissionDraft.permissions,
        }),
      });
      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Invalid settings password.');
        }
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
    if (!settingsUnlocked || !settingsPassword.trim()) {
      setPermissionError('Unlock settings before editing permission codes.');
      return;
    }
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
      const response = await fetch(endpoint, {
        method: 'DELETE',
        headers: getSettingsHeaders(),
      });
      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Invalid settings password.');
        }
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

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.subtitle}>{subtitle}</p>

        <div className={styles.urlField}>
          <label className={styles.urlLabel}>Signaling Server</label>
          <div className={styles.urlRow}>
            <input
              type="text"
              value={signalingUrl}
              onChange={(e) => setSignalingUrl(e.target.value)}
              placeholder="wss://your-signaling-server.example/ws"
              className={styles.urlInput}
              disabled={isConnecting}
            />
            <button
              type="button"
              className={styles.refreshButton}
              onClick={() => void fetchRooms()}
              disabled={isConnecting || loadingRooms}
            >
              {loadingRooms ? '...' : 'Refresh'}
            </button>
          </div>
        </div>

        <div className={styles.roomSection}>
          <div className={styles.roomHeader}>
            <span className={styles.urlLabel}>Available Rooms</span>
            <span className={styles.roomCount}>{rooms.length}</span>
          </div>
          <div className={styles.roomList}>
            {loadingRooms && rooms.length === 0 ? (
              <div className={styles.roomEmpty}>Loading active rooms...</div>
            ) : rooms.length === 0 ? (
              <div className={styles.roomEmpty}>No active sender rooms found.</div>
            ) : (
              rooms.map((room) => {
                const selected = room.roomId === selectedRoomId;
                return (
                  <button
                    key={room.roomId}
                    type="button"
                    className={`${styles.roomItem} ${selected ? styles.roomItemActive : ''}`}
                    onClick={() => setSelectedRoomId(room.roomId)}
                    disabled={isConnecting}
                  >
                    <div>
                      <strong>{room.roomName}</strong>
                      <span>{room.roomCode}</span>
                    </div>
                    <div className={styles.roomMeta}>
                      <span>{room.engineerCount} ENG</span>
                      <span>{room.requiresPassword ? 'LOCKED' : 'OPEN'}</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {selectedRoom && (
          <div className={styles.fieldStack}>
            <label className={styles.urlLabel}>
              {selectedRoom.requiresPassword ? 'Room Password' : 'Access'}
            </label>
            {selectedRoom.requiresPassword ? (
              <input
                ref={passwordRef}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={`Password for ${selectedRoom.roomName}`}
                className={styles.urlInput}
                disabled={isConnecting}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSubmit();
                }}
              />
            ) : (
              <div className={styles.roomOpenHint}>This room is open. No password required.</div>
            )}

            <label className={styles.urlLabel}>Permission Code</label>
            <input
              type="password"
              value={permissionsCode}
              onChange={(e) => setPermissionsCode(e.target.value)}
              placeholder="Optional feature permission code"
              className={styles.urlInput}
              disabled={isConnecting}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSubmit();
              }}
            />
            <div className={styles.permissionHint}>
              Optional. Use a permissions code to unlock ERS actuals or advanced track strategy details.
            </div>
          </div>
        )}

        <div className={styles.actions}>
          {onCancel && (
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={onCancel}
              disabled={isConnecting}
            >
              Back
            </button>
          )}
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={openSettingsModal}
            disabled={isConnecting}
          >
            Permission Codes
          </button>
          <button
            className={styles.connectButton}
            onClick={handleSubmit}
            disabled={!isReady || isConnecting}
          >
            {isConnecting ? 'Connecting...' : 'Join Room'}
          </button>
        </div>

        {(roomsError || connectionState === 'error') && (
          <p className={styles.error}>{roomsError || 'Connection failed. Check the room password and signaling server.'}</p>
        )}
      </div>

      {settingsOpen && (
        <div className={styles.modalOverlay} role="presentation" onClick={closeSettingsModal}>
          <div className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div>
                <strong className={styles.modalTitle}>Remote Permission Codes</strong>
                <p className={styles.permissionHint}>
                  Enter the settings password to view and edit permission bundles.
                </p>
              </div>
              <button type="button" className={styles.secondaryButton} onClick={closeSettingsModal}>
                Close
              </button>
            </div>

            <div className={styles.modalBody}>
              <label className={styles.urlLabel}>Settings Password</label>
              <div className={styles.urlRow}>
                <input
                  type="password"
                  value={settingsPassword}
                  onChange={(e) => {
                    setSettingsPassword(e.target.value);
                    setPermissionError('');
                    setPermissionStatus('');
                    if (settingsUnlocked) {
                      setSettingsUnlocked(false);
                    }
                  }}
                  placeholder="Enter settings password"
                  className={styles.urlInput}
                  disabled={permissionLoading || permissionSaving}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      unlockSettings();
                    }
                  }}
                />
                <button
                  type="button"
                  className={styles.refreshButton}
                  onClick={unlockSettings}
                  disabled={permissionLoading || permissionSaving}
                >
                  {permissionLoading ? '...' : settingsUnlocked ? 'Reload' : 'Unlock'}
                </button>
              </div>

              {settingsUnlocked && (
                <>
                  <div className={styles.permissionList}>
                    {permissionCodes.length === 0 && !permissionLoading ? (
                      <div className={styles.roomEmpty}>No permission codes found.</div>
                    ) : (
                      permissionCodes.map((entry) => (
                        <button
                          key={entry.code}
                          type="button"
                          className={`${styles.permissionCard} ${selectedPermissionCode === entry.code ? styles.permissionCardActive : ''}`}
                          onClick={() => selectPermission(entry)}
                        >
                          <div className={styles.permissionCardHeader}>
                            <strong>{entry.label || entry.code}</strong>
                            <span>{entry.code}</span>
                          </div>
                          <div className={styles.permissionCardMeta}>
                            <span>{entry.permissions.viewERSActual ? 'ERS ACTUAL' : 'ERS MASKED'}</span>
                            <span>{entry.permissions.viewAdvancedStrategy ? 'ADV STRATEGY' : 'BASIC ONLY'}</span>
                          </div>
                        </button>
                      ))
                    )}
                  </div>

                  <div className={styles.permissionEditor}>
                    <label className={styles.urlLabel}>Code</label>
                    <input
                      type="text"
                      value={permissionDraft.code}
                      onChange={(e) => {
                        setPermissionDraft((prev) => ({ ...prev, code: e.target.value.toUpperCase() }));
                        setPermissionError('');
                        setPermissionStatus('');
                      }}
                      placeholder="ENG-PRO"
                      className={styles.urlInput}
                      disabled={permissionSaving}
                    />

                    <label className={styles.urlLabel}>Label</label>
                    <input
                      type="text"
                      value={permissionDraft.label}
                      onChange={(e) => {
                        setPermissionDraft((prev) => ({ ...prev, label: e.target.value }));
                        setPermissionError('');
                        setPermissionStatus('');
                      }}
                      placeholder="Engineer Pro"
                      className={styles.urlInput}
                      disabled={permissionSaving}
                    />

                    <label className={styles.permissionToggle}>
                      <span>ERS Actual</span>
                      <input
                        className={styles.toggle}
                        type="checkbox"
                        checked={permissionDraft.permissions.viewERSActual}
                        onChange={(e) => updatePermissionFlag('viewERSActual', e.target.checked)}
                        disabled={permissionSaving}
                      />
                    </label>
                    <label className={styles.permissionToggle}>
                      <span>Advanced Strategy</span>
                      <input
                        className={styles.toggle}
                        type="checkbox"
                        checked={permissionDraft.permissions.viewAdvancedStrategy}
                        onChange={(e) => updatePermissionFlag('viewAdvancedStrategy', e.target.checked)}
                        disabled={permissionSaving}
                      />
                    </label>

                    <div className={styles.permissionActions}>
                      <button type="button" className={styles.connectButton} onClick={savePermissionCode} disabled={permissionSaving}>
                        {permissionSaving ? 'Saving...' : 'Save Code'}
                      </button>
                      <button type="button" className={styles.secondaryButton} onClick={resetPermissionEditor} disabled={permissionSaving}>
                        New
                      </button>
                      <button
                        type="button"
                        className={styles.dangerButton}
                        onClick={deletePermissionCode}
                        disabled={permissionSaving || (!selectedPermissionCode && !permissionDraft.code.trim())}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </>
              )}

              {permissionStatus && <p className={styles.success}>{permissionStatus}</p>}
              {permissionError && <p className={styles.error}>{permissionError}</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
