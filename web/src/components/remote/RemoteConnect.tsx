import { useState, useRef, useCallback, useEffect } from 'react';
import type { ConnectionState } from '../../types/telemetry';
import { isConnectionFailure, isConnectionPending } from '../../utils/connectionStatus';
import styles from './RemoteConnect.module.css';

interface RemoteConnectOptions {
  signalingUrl: string;
  roomId?: string;
  roomCode?: string;
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

function getDefaultSignalingUrl(): string {
  return import.meta.env.VITE_SIGNALING_URL || '';
}

function parseRoomReference(value: string): { roomId?: string; roomCode?: string } {
  const trimmed = value.trim();
  if (!trimmed) return {};

  if (/^\d{4}$/.test(trimmed)) {
    return { roomCode: trimmed };
  }

  return { roomId: trimmed };
}

export function RemoteConnect({
  onConnect,
  connectionState,
  onCancel,
  cancelLabel = 'Back',
  title = 'Remote Connect',
  subtitle = 'Enter the signaling server and a room code or room ID to join the live telemetry stream.',
  initialSignalingUrl = '',
  initialRoomId = '',
  initialRoomCode = '',
  initialPassword = '',
}: RemoteConnectProps) {
  const [signalingUrl, setSignalingUrl] = useState(initialSignalingUrl || getDefaultSignalingUrl);
  const [roomReference, setRoomReference] = useState(initialRoomCode || initialRoomId);
  const [password, setPassword] = useState(initialPassword);
  const [validationError, setValidationError] = useState('');
  const passwordRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (initialSignalingUrl) {
      setSignalingUrl(initialSignalingUrl);
    }
  }, [initialSignalingUrl]);

  useEffect(() => {
    if (initialRoomCode || initialRoomId) {
      setRoomReference(initialRoomCode || initialRoomId);
    }
  }, [initialRoomCode, initialRoomId]);

  useEffect(() => {
    setPassword(initialPassword);
  }, [initialPassword]);

  useEffect(() => {
    if (roomReference.trim()) {
      passwordRef.current?.focus();
    }
  }, [roomReference]);

  const isConnecting = isConnectionPending(connectionState);
  const isReady = signalingUrl.trim().length > 0 && roomReference.trim().length > 0;

  const handleSubmit = useCallback(() => {
    if (!signalingUrl.trim() || !roomReference.trim()) {
      setValidationError('Enter the signaling URL and room code or room ID.');
      return;
    }

    try {
      new URL(signalingUrl);
    } catch {
      setValidationError('Invalid signaling URL.');
      return;
    }

    setValidationError('');
    onConnect({
      signalingUrl: signalingUrl.trim(),
      ...parseRoomReference(roomReference),
      password,
    });
  }, [onConnect, password, roomReference, signalingUrl]);

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.subtitle}>{subtitle}</p>

        <div className={styles.urlField}>
          <label className={styles.urlLabel}>Signaling Server</label>
          <input
            type="text"
            value={signalingUrl}
            onChange={(e) => setSignalingUrl(e.target.value)}
            placeholder="wss://your-signaling-server.example/ws"
            className={styles.urlInput}
            disabled={isConnecting}
          />
        </div>

        <form className={styles.fieldStack} onSubmit={(e) => { e.preventDefault(); handleSubmit(); }} autoComplete="off">
          <label className={styles.urlLabel}>Room Code Or ID</label>
          <input
            type="text"
            value={roomReference}
            onChange={(e) => setRoomReference(e.target.value)}
            placeholder="1234 or full room ID"
            className={styles.urlInput}
            disabled={isConnecting}
          />
          <span className={styles.permissionHint}>
            This screen joins directly through WebRTC signaling. No room list API is required.
          </span>

          <label className={styles.urlLabel}>Room Password</label>
          <input
            ref={passwordRef}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Optional room password"
            className={styles.urlInput}
            disabled={isConnecting}
          />
        </form>

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

        {(validationError || isConnectionFailure(connectionState)) && (
          <p className={styles.error}>{validationError || 'Connection failed. Check the room password and signaling server.'}</p>
        )}
      </div>
    </div>
  );
}
