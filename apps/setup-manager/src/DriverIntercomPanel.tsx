import { useState } from 'react';
import type { IntercomRuntime, IntercomRuntimeState } from '../../../shared/intercom';

interface Props {
  runtime: IntercomRuntime;
  state: IntercomRuntimeState;
  devices: MediaDeviceInfo[];
  theme: {
    bg: string;
    surface2: string;
    border: string;
    accent: string;
    accent2: string;
    danger: string;
    text: string;
    muted: string;
    mono: string;
  };
}

export function DriverIntercomPanel({ runtime, state, devices, theme: P }: Props) {
  const [displayName, setDisplayName] = useState(() => localStorage.getItem('frc_intercom_driver_name') || 'Driver');
  const [password, setPassword] = useState('');
  const [groupCode, setGroupCode] = useState('');
  const [deviceId, setDeviceId] = useState(() => localStorage.getItem('frc_intercom_device_id') || '');
  const joined = state.status === 'joined';
  const inputStyle = { width: '100%', padding: '10px 12px', borderRadius: 4, border: `1px solid ${P.border}`, background: P.surface2, color: P.text, fontFamily: P.mono, outline: 'none' };
  const savePrefs = () => {
    localStorage.setItem('frc_intercom_driver_name', displayName.trim());
    if (deviceId) localStorage.setItem('frc_intercom_device_id', deviceId);
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
        <StatusTile label="Bridge" value={state.status === 'unavailable' ? 'Unavailable' : 'Ready'} color={state.status === 'unavailable' ? P.danger : P.accent} theme={P} />
        <StatusTile label="Membership" value={joined ? 'Joined' : state.status} color={joined ? P.accent2 : P.muted} theme={P} />
        <StatusTile label="Microphone" value={state.locallyMuted ? 'Muted' : state.microphoneStatus} color={state.locallyMuted || state.microphoneStatus === 'denied' ? P.danger : P.accent} theme={P} />
      </div>

      {!joined ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
            <label style={{ display: 'grid', gap: 6, color: P.muted, fontSize: 10 }}>Driver name
              <input value={displayName} maxLength={40} onChange={(event) => setDisplayName(event.target.value)} style={inputStyle} />
            </label>
            <label style={{ display: 'grid', gap: 6, color: P.muted, fontSize: 10 }}>Team password
              <input type="password" value={password} maxLength={128} onChange={(event) => setPassword(event.target.value)} style={inputStyle} />
            </label>
            <label style={{ display: 'grid', gap: 6, color: P.muted, fontSize: 10 }}>Existing group code
              <input value={groupCode} maxLength={16} onChange={(event) => setGroupCode(event.target.value)} style={inputStyle} placeholder="Leave blank to create" />
            </label>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button
              disabled={state.status === 'unavailable' || state.status === 'joining' || !displayName.trim() || !password}
              onClick={() => {
                savePrefs();
                void runtime.createGroup(displayName.trim(), password);
              }}
              style={{ padding: '10px 12px', borderRadius: 4, border: 0, background: P.accent, color: P.bg, fontFamily: P.mono, cursor: 'pointer' }}
            >CREATE TEAM INTERCOM</button>
            <button
              disabled={state.status === 'unavailable' || state.status === 'joining' || !displayName.trim() || !password || !groupCode.trim()}
              onClick={() => {
                savePrefs();
                void runtime.join({ groupCode: groupCode.trim(), password, role: 'driver', displayName: displayName.trim() });
              }}
              style={{ padding: '10px 12px', borderRadius: 4, border: `1px solid ${P.border}`, background: P.surface2, color: P.text, fontFamily: P.mono, cursor: 'pointer' }}
            >JOIN EXISTING</button>
          </div>
          <div style={{ fontSize: 10, color: P.muted, lineHeight: 1.6 }}>Passwords and chief codes remain in process memory only and are never saved.</div>
        </>
      ) : (
        <>
          <div style={{ padding: 12, borderRadius: 4, background: P.surface2, border: `1px solid ${P.border}`, display: 'grid', gap: 6 }}>
            <div style={{ fontFamily: P.mono, color: P.accent, fontSize: 13 }}>GROUP {state.groupCode}</div>
            {state.chiefCode ? <div style={{ fontFamily: P.mono, color: P.accent2, fontSize: 12 }}>CHIEF CODE {state.chiefCode}</div> : null}
            <div style={{ color: P.muted, fontSize: 10 }}>Share these codes through your trusted team channel. The chief code is shown only to the group creator.</div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button
              onClick={() => runtime.setLocalMuted(!state.locallyMuted)}
              style={{ padding: '10px 12px', borderRadius: 4, border: 0, background: state.locallyMuted ? P.danger : P.accent2, color: P.bg, fontFamily: P.mono, cursor: 'pointer' }}
            >MIC {state.locallyMuted ? 'MUTED' : 'HANDS-FREE'}</button>
            <button onClick={() => void runtime.leave()} style={{ padding: '10px 12px', borderRadius: 4, border: `1px solid ${P.border}`, background: 'transparent', color: P.text, fontFamily: P.mono, cursor: 'pointer' }}>LEAVE</button>
            {state.autoplayBlocked ? <button onClick={() => void runtime.enableAudio()} style={{ padding: '10px 12px', borderRadius: 4, border: 0, background: P.accent, color: P.bg, fontFamily: P.mono }}>ENABLE AUDIO</button> : null}
          </div>
          <label style={{ display: 'grid', gap: 6, color: P.muted, fontSize: 10 }}>Microphone
            <select
              value={deviceId}
              onChange={(event) => {
                const next = event.target.value;
                setDeviceId(next);
                localStorage.setItem('frc_intercom_device_id', next);
                void runtime.retryMicrophone(next);
              }}
              style={inputStyle}
            >
              <option value="">System default</option>
              {devices.map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label || 'Microphone'}</option>)}
            </select>
          </label>
          {(state.mediaStatus === 'failed' || state.microphoneStatus === 'denied') ? (
            <button onClick={() => void runtime.retryMicrophone(deviceId)} style={{ padding: '10px 12px', borderRadius: 4, border: `1px solid ${P.border}`, background: P.surface2, color: P.text, fontFamily: P.mono }}>RETRY MICROPHONE</button>
          ) : null}
          <div style={{ display: 'grid', gap: 6 }}>
            {(state.snapshot?.participants ?? []).map((participant) => (
              <div key={participant.id} style={{ padding: 10, borderRadius: 4, background: P.surface2, border: `1px solid ${P.border}`, display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                <span>{participant.displayName} · {participant.role}</span>
                <span style={{ color: participant.speaking ? P.accent2 : participant.forcedMuted ? P.danger : P.muted, fontSize: 10 }}>
                  {participant.forcedMuted ? 'FORCED MUTE' : participant.speaking ? 'SPEAKING' : participant.online ? 'ONLINE' : 'OFFLINE'}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
      {state.error ? <div style={{ padding: 10, borderRadius: 4, background: 'rgba(255,82,92,0.08)', color: P.danger, fontSize: 11 }}>{state.error}</div> : null}
    </div>
  );
}

function StatusTile({ label, value, color, theme }: { label: string; value: string; color: string; theme: Props['theme'] }) {
  return <div style={{ padding: 10, borderRadius: 4, background: theme.surface2, border: `1px solid ${theme.border}` }}><div style={{ color: theme.muted, fontSize: 9 }}>{label}</div><div style={{ color, fontFamily: theme.mono, marginTop: 5 }}>{value}</div></div>;
}
