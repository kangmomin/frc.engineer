import { useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { IntercomRole, IntercomSignalingAdapter } from '../../intercom/core';
import { useEngineerIntercom } from '../../hooks/useEngineerIntercom';
import styles from './IntercomDock.module.css';

interface Props {
  transport: IntercomSignalingAdapter;
}

export function IntercomDock({ transport }: Props) {
  const { runtime, state, devices } = useEngineerIntercom(transport);
  const [collapsed, setCollapsed] = useState(false);
  const [displayName, setDisplayName] = useState(() => localStorage.getItem('frc_intercom_display_name') || 'Engineer');
  const [groupCode, setGroupCode] = useState('');
  const [password, setPassword] = useState('');
  const [chiefCode, setChiefCode] = useState('');
  const [role, setRole] = useState<Extract<IntercomRole, 'engineer' | 'chief'>>('engineer');
  const [deviceId, setDeviceId] = useState(() => localStorage.getItem('frc_intercom_device_id') || '');
  const drivers = useMemo(
    () => state.snapshot?.participants.filter((participant) => participant.role === 'driver' && participant.online) ?? [],
    [state.snapshot],
  );
  const [privateDriverKey, setPrivateDriverKey] = useState('');
  const privateSession = state.snapshot?.privateSession;
  const statusText = state.status === 'joined'
    ? `${state.role?.toUpperCase()} / ${state.mediaStatus}`
    : state.status === 'unavailable' ? 'Unavailable' : state.status;

  const join = () => {
    localStorage.setItem('frc_intercom_display_name', displayName.trim());
    if (deviceId) localStorage.setItem('frc_intercom_device_id', deviceId);
    void runtime.join({
      groupCode: groupCode.trim(),
      password,
      ...(role === 'chief' ? { chiefCode: chiefCode.trim() } : {}),
      role,
      displayName: displayName.trim(),
    });
  };

  const onPTTDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    runtime.setPTT(true);
  };
  const onPTTRelease = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    runtime.setPTT(false);
  };

  return (
    <aside className={styles.dock} aria-label="Pitwall intercom">
      <button className={styles.header} onClick={() => setCollapsed((value) => !value)} aria-expanded={!collapsed}>
        <span className={styles.title}>
          <span className={`${styles.indicator} ${state.status === 'joined' ? styles.indicatorLive : ''}`} />
          PITWALL INTERCOM
        </span>
        <span className={`${styles.status} ${state.status === 'joined' ? styles.live : ''}`}>{statusText}</span>
      </button>
      {!collapsed ? (
        <div className={styles.body}>
          {state.status !== 'joined' ? (
            <>
              <div className={styles.grid}>
                <label className={styles.field}>Name
                  <input maxLength={40} value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
                </label>
                <label className={styles.field}>Role
                  <select value={role} onChange={(event) => setRole(event.target.value as typeof role)}>
                    <option value="engineer">Engineer</option>
                    <option value="chief">Chief engineer</option>
                  </select>
                </label>
                <label className={styles.field}>Group code
                  <input maxLength={16} inputMode="numeric" value={groupCode} onChange={(event) => setGroupCode(event.target.value)} />
                </label>
                <label className={styles.field}>Password
                  <input type="password" maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} />
                </label>
                {role === 'chief' ? (
                  <label className={styles.field}>Chief code
                    <input type="password" maxLength={32} value={chiefCode} onChange={(event) => setChiefCode(event.target.value)} />
                  </label>
                ) : null}
              </div>
              <button
                className={`${styles.button} ${styles.primary}`}
                disabled={state.status === 'unavailable' || state.status === 'joining' || !displayName.trim() || !groupCode.trim() || !password}
                onClick={join}
              >
                {state.status === 'joining' ? 'JOINING…' : 'JOIN INTERCOM'}
              </button>
              {state.status === 'unavailable' ? <div className={styles.notice}>This signaling server does not advertise Intercom v1.</div> : null}
            </>
          ) : (
            <>
              <div className={styles.controls}>
                <button className={`${styles.button} ${state.busEnabled ? styles.active : ''}`} onClick={() => runtime.setBusEnabled(!state.busEnabled)}>
                  Engineer bus {state.busEnabled ? 'ON' : 'MUTED'}
                </button>
                <button className={`${styles.button} ${state.locallyMuted ? styles.danger : ''}`} onClick={() => runtime.setLocalMuted(!state.locallyMuted)}>
                  Mic {state.locallyMuted ? 'MUTED' : 'LIVE'}
                </button>
                <button className={styles.button} onClick={() => void runtime.leave()}>Leave</button>
              </div>

              {state.role === 'engineer' ? (
                <button
                  className={`${styles.button} ${styles.ptt} ${state.ptt ? styles.pttDown : ''}`}
                  disabled={state.locallyMuted || state.snapshot?.participants.find((p) => p.id === state.participantId)?.forcedMuted}
                  onPointerDown={onPTTDown}
                  onPointerUp={onPTTRelease}
                  onPointerCancel={onPTTRelease}
                  onLostPointerCapture={() => runtime.setPTT(false)}
                >
                  {state.ptt ? 'TRANSMITTING TO DRIVER' : 'HOLD TO TALK / SPACE'}
                </button>
              ) : null}

              {state.role === 'chief' ? (
                <div className={styles.row}>
                  <select value={privateDriverKey} onChange={(event) => setPrivateDriverKey(event.target.value)}>
                    <option value="">Select driver</option>
                    {drivers.map((driver) => <option key={driver.id} value={driver.driverKey}>{driver.displayName}</option>)}
                  </select>
                  <button
                    className={`${styles.button} ${privateSession ? styles.active : ''}`}
                    disabled={!privateDriverKey && !privateSession}
                    onClick={() => void runtime.setPrivate(privateSession?.driverKey || privateDriverKey, !privateSession)}
                  >
                    {privateSession ? `PRIVATE ${privateSession.phase.toUpperCase()}` : 'START PRIVATE'}
                  </button>
                </div>
              ) : null}

              <label className={styles.field}>Microphone
                <select
                  value={deviceId}
                  onChange={(event) => {
                    const next = event.target.value;
                    setDeviceId(next);
                    localStorage.setItem('frc_intercom_device_id', next);
                    void runtime.retryMicrophone(next);
                  }}
                >
                  <option value="">System default</option>
                  {devices.map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label || 'Microphone'}</option>)}
                </select>
              </label>
              <div className={styles.controls}>
                {(state.microphoneStatus === 'denied' || state.mediaStatus === 'failed') ? (
                  <button className={styles.button} onClick={() => void runtime.retryMicrophone(deviceId)}>Retry microphone</button>
                ) : null}
                {state.autoplayBlocked ? (
                  <button className={`${styles.button} ${styles.primary}`} onClick={() => void runtime.enableAudio()}>Enable audio</button>
                ) : null}
              </div>

              <div className={styles.participants}>
                {(state.snapshot?.participants ?? []).map((participant) => (
                  <div className={styles.participant} key={participant.id}>
                    <div className={styles.participantHead}>
                      <span>{participant.displayName} · {participant.role}</span>
                      <span className={participant.speaking ? styles.speaking : styles.status}>
                        {participant.forcedMuted ? 'FORCED MUTE' : participant.ptt ? 'PTT' : participant.speaking ? 'SPEAKING' : participant.online ? 'ONLINE' : 'OFFLINE'}
                      </span>
                    </div>
                    {participant.talkingTo.length ? (
                      <div className={styles.routes}>
                        {participant.talkingTo.map((targetId) => {
                          const target = state.snapshot?.participants.find((item) => item.id === targetId);
                          return <span className={styles.chip} key={targetId}>→ {target?.displayName || targetId}</span>;
                        })}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </>
          )}
          {state.error ? <div className={`${styles.notice} ${styles.error}`}>{state.error}</div> : null}
        </div>
      ) : null}
    </aside>
  );
}
