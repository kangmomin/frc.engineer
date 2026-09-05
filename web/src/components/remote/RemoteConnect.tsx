import { useState, useRef, useCallback, useEffect } from 'react';
import type { ConnectionState } from '../../types/telemetry';
import { isConnectionFailure, isConnectionPending } from '../../utils/connectionStatus';
import styles from './RemoteConnect.module.css';

interface RemoteConnectOptions {
  signalingUrl: string;
  roomId: string;
  password: string;
}

interface RemoteConnectProps {
  onConnect: (options: RemoteConnectOptions) => void;
  connectionState: ConnectionState;
  onCancel?: () => void;
  cancelLabel?: string;
  title?: string;
  subtitle?: string;
  initialSignalingUrl?: string;
  initialRoomId?: string;
  initialRoomCode?: string;
  initialPassword?: string;
}

interface RoomListItem {
  roomId: string;
  roomCode: string;
  roomName: string;
  requiresPassword: boolean;
  engineerCount: number;
}

function getDefaultSignalingUrl(): string {
  return import.meta.env.VITE_SIGNALING_URL || '';
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
  cancelLabel = 'Back',
  title = 'Remote Connect',
  subtitle = 'Choose a sender room and enter its password to join the live telemetry stream.',
  initialSignalingUrl = '',
  initialRoomId = '',
  initialRoomCode = '',
  initialPassword = '',
}: RemoteConnectProps) {
  const [signalingUrl, setSignalingUrl] = useState(initialSignalingUrl || getDefaultSignalingUrl);
  const [rooms, setRooms] = useState<RoomListItem[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState(initialRoomId);
  const [password, setPassword] = useState(initialPassword);
  const [loadingRooms, setLoadingRooms] = useState(false);
  const [roomsError, setRoomsError] = useState('');
  const roomsRequestRef = useRef<AbortController | null>(null);
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

  const fetchRooms = useCallback(async () => {
    roomsRequestRef.current?.abort();
    const controller = new AbortController();
    roomsRequestRef.current = controller;
    setRooms([]);
    setLoadingRooms(false);
    if (!signalingUrl) {
      setRoomsError('');
      return;
    }

    let endpoint = '';
    try {
      endpoint = getRoomsEndpoint(signalingUrl);
    } catch {
      setRoomsError('Invalid signaling URL.');
      return;
    }

    setLoadingRooms(true);
    setRoomsError('');
    try {
      const res = await fetch(endpoint, { signal: controller.signal });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const raw = await res.json();
      if (controller.signal.aborted) return;
      const data = Array.isArray(raw) ? (raw as RoomListItem[]) : [];
      setRooms(data);
      setSelectedRoomId((current) => {
        if (current && data.some((room) => room.roomId === current)) {
          return current;
        }
        if (initialRoomId && data.some((room) => room.roomId === initialRoomId)) {
          return initialRoomId;
        }
        if (initialRoomCode) {
          const matchingRoom = data.find((room) => room.roomCode === initialRoomCode);
          if (matchingRoom) {
            return matchingRoom.roomId;
          }
        }
        return data[0]?.roomId ?? '';
      });
    } catch {
      if (controller.signal.aborted) return;
      setRooms([]);
      setRoomsError('Failed to load room list from signaling server.');
    } finally {
      if (!controller.signal.aborted) setLoadingRooms(false);
    }
  }, [initialRoomCode, initialRoomId, signalingUrl]);

  useEffect(() => {
    void fetchRooms();
    return () => roomsRequestRef.current?.abort();
  }, [fetchRooms]);

  useEffect(() => {
    if (!selectedRoomId) return;
    const selectedRoom = rooms.find((room) => room.roomId === selectedRoomId);
    if (!selectedRoom) return;
    if (selectedRoom.requiresPassword) {
      passwordRef.current?.focus();
    } else {
      setPassword('');
    }
  }, [rooms, selectedRoomId]);

  const selectedRoom = rooms.find((room) => room.roomId === selectedRoomId) ?? null;
  const isConnecting = isConnectionPending(connectionState);
  const isReady = !loadingRooms && !!selectedRoom && (!selectedRoom.requiresPassword || password.length > 0) && signalingUrl.length > 0;

  const handleSubmit = useCallback(() => {
    if (!isReady || !selectedRoom) return;
    onConnect({
      signalingUrl,
      roomId: selectedRoom.roomId,
      password: selectedRoom.requiresPassword ? password : '',
    });
  }, [isReady, onConnect, password, selectedRoom, signalingUrl]);

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
          <form className={styles.fieldStack} onSubmit={(e) => { e.preventDefault(); handleSubmit(); }} autoComplete="off">
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
              />
            ) : (
              <div className={styles.roomOpenHint}>This room is open. No password required.</div>
            )}
          </form>
        )}

        <div className={styles.actions}>
          {onCancel && (
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={onCancel}
              disabled={isConnecting}
            >
              {cancelLabel}
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

        {(roomsError || isConnectionFailure(connectionState)) && (
          <p className={styles.error}>{roomsError || 'Connection failed. Check the room password and signaling server.'}</p>
        )}
      </div>
    </div>
  );
}
