import { useId, useState } from 'react';
import { canReceiveParticipantAudio, type IntercomRuntime, type IntercomRuntimeState } from '../../../web/src/intercom/core';
import { INTERCOM_HELP } from '../../../web/src/intercom/help';
import { Button, Card, Field, Grid, Hint, MetricTile, Notice, Row, Select, Spread, TextInput } from './ui';
import './DriverIntercomPanel.css';

interface Props {
  runtime: IntercomRuntime;
  state: IntercomRuntimeState;
  devices: MediaDeviceInfo[];
}

export function DriverIntercomPanel({ runtime, state, devices }: Props) {
  const [displayName, setDisplayName] = useState(() => localStorage.getItem('frc_intercom_driver_name') || 'Driver');
  const [password, setPassword] = useState('');
  const [groupCode, setGroupCode] = useState('');
  const [deviceId, setDeviceId] = useState(() => localStorage.getItem('frc_intercom_device_id') || '');
  const [, renderVolume] = useState(0);
  const joined = state.status === 'joined';
  const micBad = state.locallyMuted || state.microphoneStatus === 'denied';
  const savePrefs = () => {
    localStorage.setItem('frc_intercom_driver_name', displayName.trim());
    if (deviceId) localStorage.setItem('frc_intercom_device_id', deviceId);
  };

  return (
    <>
      <Grid cols={3}>
        <MetricTile label="Bridge" value={state.status === 'unavailable' ? 'Unavailable' : 'Ready'} tone={state.status === 'unavailable' ? 'secondary' : 'primary'} />
        <MetricTile label="Membership" value={joined ? 'Joined' : state.status} tone={joined ? 'tertiary' : 'neutral'} />
        <MetricTile label="Microphone" value={state.locallyMuted ? 'Muted' : state.microphoneStatus} tone={micBad ? 'secondary' : 'primary'} />
      </Grid>

      {!joined ? (
        <>
          <Grid cols={3} style={{ alignItems: 'end' }}>
            <Field label="Driver name">
              <TextInput value={displayName} maxLength={40} onChange={(event) => setDisplayName(event.target.value)} />
            </Field>
            <Field label="Team password">
              <TextInput type="password" value={password} maxLength={128} onChange={(event) => setPassword(event.target.value)} />
            </Field>
            <Field label={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>Existing group code <HelpTag label="Group code" text={INTERCOM_HELP.groupCode} /></span>}>
              <TextInput value={groupCode} maxLength={16} onChange={(event) => setGroupCode(event.target.value)} placeholder="Leave blank to create" />
            </Field>
          </Grid>
          <Row>
            <Button
              disabled={state.status === 'unavailable' || state.status === 'joining' || !displayName.trim() || !password}
              onClick={() => {
                savePrefs();
                void runtime.createGroup(displayName.trim(), password);
              }}
            >Create Team Intercom</Button>
            <Button
              variant="ghost"
              disabled={state.status === 'unavailable' || state.status === 'joining' || !displayName.trim() || !password || !groupCode.trim()}
              onClick={() => {
                savePrefs();
                void runtime.join({ groupCode: groupCode.trim(), password, role: 'driver', displayName: displayName.trim() });
              }}
            >Join Existing</Button>
          </Row>
          <Hint>Passwords and chief codes remain in process memory only and are never saved.</Hint>
        </>
      ) : (
        <>
          <Card>
            <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--accInk)', fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>GROUP {state.groupCode} <HelpTag label="Group code" text={INTERCOM_HELP.groupCode} /></div>
            {state.chiefCode ? <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--ok)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>CHIEF CODE {state.chiefCode} <HelpTag label="Chief code" text={INTERCOM_HELP.chiefCode} /></div> : null}
            <Hint>Share these codes through your trusted team channel. The chief code is shown only to the group creator.</Hint>
          </Card>
          <Row>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <Button variant={state.locallyMuted ? 'danger' : 'go'} onClick={() => runtime.setLocalMuted(!state.locallyMuted)}>
                Mic {state.locallyMuted ? 'Muted' : 'Hands-free'}
              </Button>
              <HelpTag label="Hands-free mic" text={INTERCOM_HELP.driverHandsFree} />
            </span>
            <Button variant="ghost" onClick={() => void runtime.leave()}>Leave</Button>
            {state.autoplayBlocked ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <Button onClick={() => void runtime.enableAudio()}>Enable Audio</Button>
                <HelpTag label="Enable audio" text={INTERCOM_HELP.enableAudio} />
              </span>
            ) : null}
          </Row>
          <Field label={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>Microphone <HelpTag label="Microphone" text={INTERCOM_HELP.microphone} /></span>}>
            <Select
              aria-label="Microphone"
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
            </Select>
          </Field>
          {(state.mediaStatus === 'failed' || state.microphoneStatus === 'denied') ? (
            <div>
              <Button variant="ghost" onClick={() => void runtime.retryMicrophone(deviceId)}>Retry Microphone</Button>
            </div>
          ) : null}
          {(state.snapshot?.participants ?? []).map((participant) => (
            <Card key={participant.id}>
              <Spread>
                <span style={{ fontSize: 12.5 }}>{participant.displayName} · {participant.role}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '0.08em', fontSize: 10.5, color: participant.speaking ? 'var(--ok)' : participant.forcedMuted ? 'var(--negRed)' : 'var(--t3)' }}>
                  {participant.forcedMuted ? 'FORCED MUTE' : participant.speaking ? 'SPEAKING' : participant.online ? 'ONLINE' : 'OFFLINE'}
                </span>
              </Spread>
              {state.role && canReceiveParticipantAudio(state.role, state.participantId, state.snapshot, participant.id) ? (
                <div className="driverIntercomVolume">
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
                  <output>{Math.round(runtime.getParticipantVolume(participant.id) * 100)}%</output>
                </div>
              ) : null}
            </Card>
          ))}
        </>
      )}
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
    </>
  );
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
