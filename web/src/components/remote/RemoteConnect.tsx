import { useState, useRef, useCallback, useEffect } from 'react';
import styles from './RemoteConnect.module.css';

interface RemoteConnectProps {
  onConnect: (signalingUrl: string, roomId: string, password: string) => void;
  connectionState: string;
  onCancel?: () => void;
  title?: string;
  subtitle?: string;
}

interface RoomListItem {
  roomId: string;
  roomCode: string;
  roomName: string;
  requiresPassword: boolean;
  engineerCount: number;
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

export function RemoteConnect({
  onConnect,
  connectionState,
  onCancel,
  title = 'Remote Connect',
  subtitle = 'Choose a sender room and enter its password to join the live telemetry stream.',
}: RemoteConnectProps) {
  const [signalingUrl, setSignalingUrl] = useState(getDefaultSignalingUrl);
  const [rooms, setRooms] = useState<RoomListItem[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState('');
  const [password, setPassword] = useState('');
  const [loadingRooms, setLoadingRooms] = useState(false);
  const [roomsError, setRoomsError] = useState('');
  const passwordRef = useRef<HTMLInputElement | null>(null);

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
        return data[0]?.roomId ?? '';
      });
    } catch {
      setRooms([]);
      setRoomsError('Failed to load room list from signaling server.');
    } finally {
      setLoadingRooms(false);
    }
  }, [signalingUrl]);

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
    onConnect(signalingUrl, selectedRoom.roomId, selectedRoom.requiresPassword ? password : '');
  }, [onConnect, password, selectedRoom, signalingUrl]);

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
              <div className={styles.roomEmpty}>Loading active rooms…</div>
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
          <div className={styles.passwordField}>
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
              Back to Local
            </button>
          )}
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
    </div>
  );
}
