import type { Ref } from "react";

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
} from "../ui";

const STORAGE_MODE_OPTIONS: Array<{ value: SenderStorageMode; label: string; description: string }> = [
  { value: "resultOnly", label: "Result Only", description: "Race result summary only." },
  { value: "summary", label: "Summary Replay", description: "Result plus replay timeline snapshots." },
  { value: "advanced", label: "Advanced", description: "Result, replay timeline, and raw packet logs." },
];

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
  trackName,
  settings,
  udpPortInputRef,
}: {
  senderConnected: boolean;
  senderStatus: SenderStatus | null;
  liveSession: SenderSession | null;
  livePlayer: SenderPlayer | null;
  trackName: string | null;
  settings: SenderSettings;
  udpPortInputRef: Ref<HTMLInputElement>;
}) {
  const { config, storageInfo } = settings;
  const peers = senderStatus?.peers ?? [];
  const inviteLink = senderStatus?.invite?.link ?? "";

  return (
    <>
      <Panel
        title="Sender Status"
        detail={senderConnected ? "내장 Sender가 실행 중입니다." : "내장 Sender에 연결할 수 없습니다. 잠시 후 자동으로 다시 시도합니다."}
      >
        <Grid cols={4}>
          <MetricTile label="Sender" value={senderConnected ? "Online" : "Offline"} tone={senderConnected ? "tertiary" : "secondary"} />
          <MetricTile label="UDP Port" value={senderStatus?.udpPort ? String(senderStatus.udpPort) : "--"} tone={senderStatus?.udpBindError ? "secondary" : "neutral"} />
          <MetricTile label="Save Mode" value={formatSenderStorageModeLabel(senderStatus?.raceStorageMode)} tone="neutral" />
          <MetricTile label="Track" value={trackName ?? "--"} tone="neutral" />
          <MetricTile label="Session" value={liveSession?.sessionType ?? "--"} tone="neutral" />
          <MetricTile label="Weather" value={liveSession?.weather ?? "--"} tone="neutral" />
          <MetricTile label="Track Temp" value={formatTrackTemp(liveSession?.trackTemp)} tone="neutral" />
          <MetricTile label="Best Lap" value={formatLapTime(livePlayer?.bestLapTime)} tone={livePlayer?.bestLapTime ? "tertiary" : "neutral"} />
        </Grid>
      </Panel>

      {livePlayer ? (
        <Panel title="Live" detail={livePlayer.name ? `${livePlayer.name} · 실시간 플레이어 텔레메트리` : "실시간 플레이어 텔레메트리"}>
          <Grid cols={3}>
            <MetricTile label="Top Speed" value={typeof livePlayer.topSpeed === "number" ? `${livePlayer.topSpeed} km/h` : "--"} tone="neutral" />
            <MetricTile label="Compound" value={livePlayer.tireCompound?.toUpperCase() ?? "--"} tone="neutral" />
            <MetricTile label="Fuel" value={typeof livePlayer.fuelRemainingLaps === "number" ? `${livePlayer.fuelRemainingLaps.toFixed(1)} laps` : "--"} tone="neutral" />
            <MetricTile label="Tyre Age" value={typeof livePlayer.tireAge === "number" ? `${livePlayer.tireAge} laps` : "--"} tone="neutral" />
            <MetricTile label="Best Lap" value={formatLapTime(livePlayer.bestLapTime)} tone="tertiary" />
            <MetricTile label="Last Lap" value={formatLapTime(livePlayer.lastLapTime)} tone="neutral" />
          </Grid>
          <Grid cols={2} style={{ gap: "8px 14px" }}>
            {TYRES.map(([label, index]) => {
              const value = Number(livePlayer.tireWear?.[index] ?? 0);
              return (
                <div key={label}>
                  <Spread style={{ marginBottom: 3 }}>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, fontWeight: 600, letterSpacing: "0.1em", color: "var(--t3)" }}>{label}</span>
                    <span style={{ fontSize: 12.5, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{value.toFixed(1)}%</span>
                  </Spread>
                  <MetricBar value={value} min={0} max={100} />
                </div>
              );
            })}
          </Grid>
        </Panel>
      ) : null}

      <Panel title="Sender Settings" detail="UDP 수신 포트, 엔지니어 룸, 파일 저장과 UDP 포워딩">
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
                <span style={{ fontSize: 11.5, lineHeight: 1.5, color: "var(--t2)" }}>{option.description}</span>
              </OptionButton>
            ))}
          </Grid>
          {!config.saveFiles ? <Hint>File saving is currently off. Re-enable Save Files to persist the selected mode.</Hint> : null}
        </Card>

        <Card title="Storage Location" aside={<Badge color={storageInfo.usingCustom ? "var(--accInk)" : undefined}>{storageInfo.usingCustom ? "Custom folder" : "Default folder"}</Badge>}>
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
          <MetricTile label="Room Name" value={senderStatus?.roomName || "--"} tone="neutral" />
          <MetricTile label="Room Code" value={senderStatus?.roomCode || "--"} tone="primary" />
          <MetricTile label="Access" value={senderStatus?.roomProtected ? "Password" : "Open"} tone="neutral" />
        </Grid>
        <Field label="Invite Link">
          <TextInput value={inviteLink || "--"} readOnly onFocus={(event) => event.currentTarget.select()} />
        </Field>
        {peers.length ? (
          peers.map((peer) => (
            <Card key={peer.peerId || `${peer.view}-${peer.state}`}>
              <Spread>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>{peer.peerId || "Unknown Peer"}</div>
                  <Hint>View {peer.view || "cockpit"}</Hint>
                </div>
                <Badge color="var(--accInk)">{peer.state || "unknown"}</Badge>
              </Spread>
            </Card>
          ))
        ) : (
          <Hint>No engineers connected yet.</Hint>
        )}
      </Panel>

    </>
  );
}
