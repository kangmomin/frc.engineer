import { useState, useRef, useCallback, useEffect } from 'react';
import styles from './RemoteConnect.module.css';

interface RemoteConnectProps {
  onConnect: (signalingUrl: string, roomCode: string) => void;
  connectionState: string;
  onCancel?: () => void;
  title?: string;
  subtitle?: string;
}

const STORAGE_KEY = 'frc_signaling_url';

function getDefaultSignalingUrl(): string {
  return localStorage.getItem(STORAGE_KEY) || import.meta.env.VITE_SIGNALING_URL || '';
}

export function RemoteConnect({
  onConnect,
  connectionState,
  onCancel,
  title = 'Remote Connect',
  subtitle = "Enter the 4-digit room code from the driver's sender",
}: RemoteConnectProps) {
  const [digits, setDigits] = useState(['', '', '', '']);
  const [signalingUrl, setSignalingUrl] = useState(getDefaultSignalingUrl);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

  const handleDigitChange = useCallback((index: number, value: string) => {
    // Only allow single digit
    const digit = value.replace(/\D/g, '').slice(-1);
    setDigits((prev) => {
      const next = [...prev];
      next[index] = digit;
      return next;
    });
    // Auto-advance to next input
    if (digit && index < 3) {
      inputRefs.current[index + 1]?.focus();
    }
  }, []);

  const handleSubmit = useCallback(() => {
    const code = digits.join('');
    if (code.length !== 4 || !signalingUrl) return;

    localStorage.setItem(STORAGE_KEY, signalingUrl);
    onConnect(signalingUrl, code);
  }, [digits, signalingUrl, onConnect]);

  const handleKeyDown = useCallback((index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
    if (e.key === 'Enter') {
      handleSubmit();
    }
  }, [digits, handleSubmit]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 4);
    if (pasted.length > 0) {
      setDigits((prev) => {
        const newDigits = [...prev];
        for (let i = 0; i < pasted.length; i++) {
          newDigits[i] = pasted[i];
        }
        return newDigits;
      });
      const focusIdx = Math.min(pasted.length, 3);
      inputRefs.current[focusIdx]?.focus();
    }
  }, []);

  const isReady = digits.every((d) => d !== '') && signalingUrl.length > 0;
  const isConnecting = connectionState === 'connecting';

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.subtitle}>{subtitle}</p>

        <div className={styles.codeInputs} onPaste={handlePaste}>
          {digits.map((digit, i) => (
            <input
              key={i}
              ref={(el) => { inputRefs.current[i] = el; }}
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={digit}
              onChange={(e) => handleDigitChange(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              className={styles.digitInput}
              disabled={isConnecting}
            />
          ))}
        </div>

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
            {isConnecting ? 'Connecting...' : 'Connect'}
          </button>
        </div>

        {connectionState === 'error' && (
          <p className={styles.error}>Connection failed. Check the room code and signaling URL.</p>
        )}
      </div>
    </div>
  );
}
