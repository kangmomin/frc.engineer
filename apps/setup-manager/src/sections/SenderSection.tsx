import type { Ref } from "react";

import type { LiveRecording, Severity } from "../hooks/useLiveRecording";
import type { SenderSettings } from "../hooks/useSenderSettings";
import { formatLapTime, formatSenderStorageModeLabel, formatTrackTemp } from "../lib/format";
import type { SenderPlayer, SenderSession, SenderStatus, SenderStorageMode } from "../lib/senderTypes";
import {
  Badge,
  Button,
  Card,
  Check,
  Field,
  Grid,
  Hint,
  MetricBar,
  MetricTile,
  Notice,
  OptionButton,
  Panel,
  Row,
  Spread,
  TextInput,
  type NoticeTone,
} from "../ui";

const STORAGE_MODE_OPTIONS: Array<{ value: SenderStorageMode; label: string; description: string }> = [
  { value: "resultOnly", label: "Result Only", description: "Race result summary only." },
  { value: "summary", label: "Summary Replay", description: "Result plus replay timeline snapshots." },
  { value: "advanced", label: "Advanced", description: "Result, replay timeline, and raw packet logs." },
];

const SEVERITY_TONE: Record<Severity, NoticeTone> = { high: "error", med: "info", low: "success" };

const TYRES: Array<[string, number]> = [
  ["FL", 0],
  ["FR", 1],
  ["RL", 2],
  ["RR", 3],
];

export function SenderSection({
  senderConnected,
  senderStatus,
  liveSession,
  livePlayer,
  detectedTrack,
  settings,
  recording,
  udpPortInputRef,
}: {
  senderConnected: boolean;
  senderStatus: SenderStatus | null;
  liveSession: SenderSession | null;
  livePlayer: SenderPlayer | null;
  detectedTrack: string | null;
  settings: SenderSettings;
  recording: LiveRecording;
  udpPortInputRef: Ref<HTMLInputElement>;
}) {
  const { config, storageInfo } = settings;
  const peers = senderStatus?.peers ?? [];
  const inviteLink = senderStatus?.invite?.link ?? "";

  return (
    <>
      <Panel title="Sender Status" tone={senderConnected ? "tertiary" : "secondary"} detail={senderConnected ? "Embedded sender online" : "Embedded sender offline"}>
        <Grid cols={4}>
          <MetricTile compact label="Sender" value={senderConnected ? "Online" : "Offline"} tone={senderConnected ? "tertiary" : "secondary"} />
          <MetricTile compact label="UDP Port" value={senderStatus?.udpPort ? String(senderStatus.udpPort) : "--"} tone={senderStatus?.udpBindError ? "secondary" : "neutral"} />
          <MetricTile compact label="Save Mode" value={formatSenderStorageModeLabel(senderStatus?.raceStorageMode)} tone="neutral" />
          <MetricTile compact label="Track" value={detectedTrack ?? liveSession?.trackName ?? "--"} tone="neutral" />
          <MetricTile compact label="Session" value={liveSession?.sessionType ?? "--"} tone="neutral" />
          <MetricTile compact label="Weather" value={liveSession?.weather ?? "--"} tone="neutral" />
          <MetricTile compact label="Track Temp" value={formatTrackTemp(liveSession?.trackTemp)} tone="neutral" />
          <MetricTile compact label="Best Lap" value={formatLapTime(livePlayer?.bestLapTime)} tone="tertiary" />
        </Grid>
      </Panel>

      <Panel title="Sender Settings">
        {settings.error ? <Notice tone="error">{settings.error}</Notice> : null}
        {settings.notice ? <Notice tone="success">{settings.notice}</Notice> : null}
        {settings.overwriteFilename ? (
          <Notice tone="warn" title="Recorded track data exists">
            Existing recorded track data was detected for {senderStatus?.currentTrack?.name || "the current track"}. Save once more to confirm overwrite.
          </Notice>
        ) : null}

        <Grid cols={3}>
          <Field label="UDP Port">
            <TextInput ref={udpPortInputRef} value={config.udpPort} inputMode="numeric" onChange={(event) => settings.update({ udpPort: event.target.value })} />
          </Field>
          <Field label="Room Name">
            <TextInput value={config.roomName} onChange={(event) => settings.update({ roomName: event.target.value })} />
          </Field>
          <Field label="Room Password">
            <TextInput type="password" value={config.roomPassword} onChange={(event) => settings.update({ roomPassword: event.target.value })} />
          </Field>
        </Grid>

        <Row>
          <Check boxed checked={config.saveFiles} onChange={(value) => settings.update({ saveFiles: value })}>
            Save Files
          </Check>
          <Check boxed checked={config.trackRecording} onChange={settings.setTrackRecording}>
            Track Recording
          </Check>
        </Row>

        <Card title="Save File Mode">
          <Hint>Choose what gets persisted when file saving is enabled.</Hint>
          <Grid cols={3}>
            {STORAGE_MODE_OPTIONS.map((option) => (
              <OptionButton
                key={option.value}
                selected={config.dataStorageMode === option.value}
                disabled={!config.saveFiles}
                title={option.label}
                onClick={() => settings.update({ dataStorageMode: option.value })}
              >
                <span style={{ fontSize: 11, lineHeight: 1.5, color: "var(--text-muted)" }}>{option.description}</span>
              </OptionButton>
            ))}
          </Grid>
          {!config.saveFiles ? <Hint>File saving is currently off. Re-enable Save Files to persist the selected mode.</Hint> : null}
        </Card>

        <Card title="Storage Location" aside={<Badge color={storageInfo.usingCustom ? "var(--accent)" : undefined}>{storageInfo.usingCustom ? "Custom folder" : "Default folder"}</Badge>}>
          <Hint>Logs, packet captures, race archives, and recorded track data are written under this folder.</Hint>
          <TextInput value={storageInfo.effective || "Default app folder"} readOnly aria-label="Storage location" />
          <Row>
            <Button onClick={() => void settings.chooseStorageRoot()} disabled={settings.changingStorage} busy={settings.changingStorage}>
              {settings.changingStorage ? "Applying" : "Browse"}
            </Button>
            <Button variant="ghost" onClick={() => void settings.resetStorageRoot()} disabled={settings.changingStorage || !storageInfo.usingCustom}>
              Use Default
            </Button>
            <Button variant="ghost" onClick={() => void settings.restartSender()} disabled={settings.changingStorage || !settings.canRestart}>
              Restart Sender
            </Button>
          </Row>
        </Card>

        <Card title="Forward Targets" aside={<Button size="sm" variant="ghost" onClick={settings.addForwardTarget}>Add Target</Button>}>
          <Hint>Optional UDP forward destinations for local tools or telemetry mirrors.</Hint>
          {config.forwardTargets.length ? (
            config.forwardTargets.map((target, index) => (
              <Grid key={`forward-target-${index}`} cols="minmax(0, 1fr) 96px auto auto">
                <TextInput value={target.host} placeholder="Host" aria-label={`Forward target ${index + 1} host`} onChange={(event) => settings.updateForwardTarget(index, { host: event.target.value })} />
                <TextInput value={target.port} placeholder="Port" inputMode="numeric" aria-label={`Forward target ${index + 1} port`} onChange={(event) => settings.updateForwardTarget(index, { port: event.target.value })} />
                <Check boxed checked={target.enabled} onChange={(value) => settings.updateForwardTarget(index, { enabled: value })}>
                  Enabled
                </Check>
                <Button size="sm" variant="ghost" onClick={() => settings.removeForwardTarget(index)}>
                  Remove
                </Button>
              </Grid>
            ))
          ) : (
            <Hint>No forward targets configured.</Hint>
          )}
        </Card>

        <Spread>
          <Hint>{settings.loading ? "Loading current sender settings…" : "Changes apply to the embedded sender when saved."}</Hint>
          <Button variant="go" onClick={() => void settings.save()} disabled={settings.saving || settings.loading} busy={settings.saving}>
            {settings.saving ? "Saving" : settings.overwriteFilename ? "Save & Overwrite" : "Save Settings"}
          </Button>
        </Spread>
      </Panel>

      <Panel title="Room & Sharing" detail={`${typeof senderStatus?.connectedEngineers === "number" ? senderStatus.connectedEngineers : 0} engineers connected`}>
        <Grid cols={3}>
          <MetricTile compact label="Room Name" value={senderStatus?.roomName || "--"} tone="neutral" />
          <MetricTile compact label="Room Code" value={senderStatus?.roomCode || "--"} tone="primary" />
          <MetricTile compact label="Access" value={senderStatus?.roomProtected ? "Password" : "Open"} tone="neutral" />
        </Grid>
        <Field label="Invite Link">
          <TextInput value={inviteLink || "--"} readOnly onFocus={(event) => event.currentTarget.select()} />
        </Field>
        {peers.length ? (
          peers.map((peer) => (
            <Card key={peer.peerId || `${peer.view}-${peer.state}`}>
              <Spread>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{peer.peerId || "Unknown Peer"}</div>
                  <Hint>View {peer.view || "cockpit"}</Hint>
                </div>
                <Badge color="var(--accent)">{peer.state || "unknown"}</Badge>
              </Spread>
            </Card>
          ))
        ) : (
          <Hint>No engineers connected yet.</Hint>
        )}
      </Panel>

      <Panel
        title="Recording"
        detail={`${recording.sampleCount} samples`}
        actions={
          recording.recording ? (
            <Button size="sm" variant="ghost" onClick={recording.stop}>
              Stop
            </Button>
          ) : (
            <Button size="sm" variant="danger" onClick={recording.start} disabled={!senderConnected || !livePlayer}>
              Start Record
            </Button>
          )
        }
      >
        <Hint>
          {!senderConnected
            ? "Connect the sender to unlock live telemetry."
            : livePlayer
              ? "Recording captures the current player feed every poll cycle and turns it into setup feedback."
              : "Sender connected, waiting for a live player."}
        </Hint>
      </Panel>

      {livePlayer ? (
        <Panel title="Live">
          <Grid cols={3}>
            <MetricTile compact label="Top Speed" value={typeof livePlayer.topSpeed === "number" ? `${livePlayer.topSpeed} km/h` : "--"} tone="neutral" />
            <MetricTile compact label="Compound" value={livePlayer.tireCompound?.toUpperCase() ?? "--"} tone="neutral" />
            <MetricTile compact label="Fuel" value={typeof livePlayer.fuelRemainingLaps === "number" ? `${livePlayer.fuelRemainingLaps.toFixed(1)} laps` : "--"} tone="neutral" />
            <MetricTile compact label="Tyre Age" value={typeof livePlayer.tireAge === "number" ? `${livePlayer.tireAge} laps` : "--"} tone="neutral" />
            <MetricTile compact label="Best Lap" value={formatLapTime(livePlayer.bestLapTime)} tone="tertiary" />
            <MetricTile compact label="Last Lap" value={formatLapTime(livePlayer.lastLapTime)} tone="neutral" />
          </Grid>
          <Grid cols={2} style={{ gap: "8px 14px" }}>
            {TYRES.map(([label, index]) => {
              const value = Number(livePlayer.tireWear?.[index] ?? 0);
              return (
                <div key={label}>
                  <Spread style={{ marginBottom: 3 }}>
                    <span style={{ fontSize: 10, letterSpacing: "0.1em", color: "var(--text-muted)" }}>{label}</span>
                    <span style={{ fontFamily: "var(--font-racing)", fontSize: 12, fontWeight: 700 }}>{value.toFixed(1)}%</span>
                  </Spread>
                  <MetricBar value={value} min={0} max={100} />
                </div>
              );
            })}
          </Grid>
        </Panel>
      ) : null}

      {recording.sampleCount >= 2 ? (
        <Panel title="Setup Feedback" tone="tertiary">
          {recording.setupTips.map((tip) => (
            <Notice key={`${tip.issue}-${tip.reason}`} tone={SEVERITY_TONE[tip.severity]} title={tip.issue}>
              <div>{tip.reason}</div>
              {tip.changes.length ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                  {tip.changes.map((change) => (
                    <Badge key={`${tip.issue}-${change}`}>{change}</Badge>
                  ))}
                </div>
              ) : null}
            </Notice>
          ))}
        </Panel>
      ) : null}
    </>
  );
}
