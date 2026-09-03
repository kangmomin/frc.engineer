import { useId, useState } from 'react';
import { canReceiveParticipantAudio, type IntercomRuntime, type IntercomRuntimeState } from '../../../web/src/intercom/core';
import { INTERCOM_HELP } from '../../../web/src/intercom/help';
import './DriverIntercomPanel.css';

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
  const [, renderVolume] = useState(0);
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
            <div style={{ display: 'grid', gap: 6, color: P.muted, fontSize: 10 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>Existing group code <HelpTag label="Group code" text={INTERCOM_HELP.groupCode} /></span>
              <input value={groupCode} maxLength={16} onChange={(event) => setGroupCode(event.target.value)} style={inputStyle} placeholder="Leave blank to create" />
            </div>
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
            <div style={{ fontFamily: P.mono, color: P.accent, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>GROUP {state.groupCode} <HelpTag label="Group code" text={INTERCOM_HELP.groupCode} /></div>
            {state.chiefCode ? <div style={{ fontFamily: P.mono, color: P.accent2, fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>CHIEF CODE {state.chiefCode} <HelpTag label="Chief code" text={INTERCOM_HELP.chiefCode} /></div> : null}
            <div style={{ color: P.muted, fontSize: 10 }}>Share these codes through your trusted team channel. The chief code is shown only to the group creator.</div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <button
                onClick={() => runtime.setLocalMuted(!state.locallyMuted)}
                style={{ padding: '10px 12px', borderRadius: 4, border: 0, background: state.locallyMuted ? P.danger : P.accent2, color: P.bg, fontFamily: P.mono, cursor: 'pointer' }}
              >MIC {state.locallyMuted ? 'MUTED' : 'HANDS-FREE'}</button>
              <HelpTag label="Hands-free mic" text={INTERCOM_HELP.driverHandsFree} />
            </span>
            <button onClick={() => void runtime.leave()} style={{ padding: '10px 12px', borderRadius: 4, border: `1px solid ${P.border}`, background: 'transparent', color: P.text, fontFamily: P.mono, cursor: 'pointer' }}>LEAVE</button>
            {state.autoplayBlocked ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <button onClick={() => void runtime.enableAudio()} style={{ padding: '10px 12px', borderRadius: 4, border: 0, background: P.accent, color: P.bg, fontFamily: P.mono }}>ENABLE AUDIO</button>
                <HelpTag label="Enable audio" text={INTERCOM_HELP.enableAudio} />
              </span>
            ) : null}
          </div>
          <div style={{ display: 'grid', gap: 6, color: P.muted, fontSize: 10 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>Microphone <HelpTag label="Microphone" text={INTERCOM_HELP.microphone} /></span>
            <select
              aria-label="Microphone"
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
          </div>
          {(state.mediaStatus === 'failed' || state.microphoneStatus === 'denied') ? (
            <button onClick={() => void runtime.retryMicrophone(deviceId)} style={{ padding: '10px 12px', borderRadius: 4, border: `1px solid ${P.border}`, background: P.surface2, color: P.text, fontFamily: P.mono }}>RETRY MICROPHONE</button>
          ) : null}
          <div style={{ display: 'grid', gap: 6 }}>
            {(state.snapshot?.participants ?? []).map((participant) => (
              <div key={participant.id} style={{ padding: 10, borderRadius: 4, background: P.surface2, border: `1px solid ${P.border}`, display: 'grid', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                  <span>{participant.displayName} · {participant.role}</span>
                  <span style={{ color: participant.speaking ? P.accent2 : participant.forcedMuted ? P.danger : P.muted, fontSize: 10 }}>
                    {participant.forcedMuted ? 'FORCED MUTE' : participant.speaking ? 'SPEAKING' : participant.online ? 'ONLINE' : 'OFFLINE'}
                  </span>
                </div>
                {state.role && canReceiveParticipantAudio(state.role, state.participantId, state.snapshot, participant.id) ? (
                  <div className="driverIntercomVolume" style={{ color: P.muted }}>
                    <span className="driverIntercomVolumeLabel">Volume <HelpTag label={`${participant.displayName} volume`} text={INTERCOM_HELP.receiveVolume} /></span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={Math.round(runtime.getParticipantVolume(participant.id) * 100)}
                      aria-label={`${participant.displayName} receive volume`}
                      onChange={(event) => {
                        runtime.setParticipantVolume(participant.id, Number(event.target.value) / 100);
                        renderVolume((revision) => revision + 1);
                      }}
                    />
                    <output style={{ color: P.text }}>{Math.round(runtime.getParticipantVolume(participant.id) * 100)}%</output>
                  </div>
                ) : null}
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

function HelpTag({ label, text }: { label: string; text: string }) {
  const tooltipId = useId();
  return (
    <span className="driverIntercomHelp">
      <button type="button" className="driverIntercomHelpButton" aria-label={`${label} 도움말`} aria-describedby={tooltipId} title={text}>?</button>
      <span id={tooltipId} role="tooltip" className="driverIntercomHelpText">{text}</span>
    </span>
  );
}
