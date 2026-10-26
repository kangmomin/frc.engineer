import { useEffect, useRef, useState } from "react";

import { hasPermission } from "./permissions";
import { SessionAnalysisSection } from "./SessionAnalysisSection";
import { normalizeAnalysisServerUrl } from "./sessionAnalysis";
import { DriverIntercomPanel } from "./DriverIntercomPanel";
import { EngineerRadioPanel } from "./EngineerRadioPanel";
import { useDriverIntercom } from "./useDriverIntercom";
import { useEngineerRadio } from "./useEngineerRadio";
import { useLiveRecording } from "./hooks/useLiveRecording";
import { useOverlayControls } from "./hooks/useOverlayControls";
import { usePairingGate, useSenderConnection } from "./hooks/useSenderConnection";
import { useSenderSettings } from "./hooks/useSenderSettings";
import { useSetupBuilder } from "./hooks/useSetupBuilder";
import { DEFAULT_SENDER_URL } from "./lib/senderApi";
import { OverlaySection } from "./sections/OverlaySection";
import { PairingGateModal } from "./sections/PairingGateModal";
import { SenderSection } from "./sections/SenderSection";
import { SetupBuilderSection } from "./sections/SetupBuilderSection";
import { Button, Notice, Panel, Segmented, StatusPill } from "./ui";

type SectionId = "setup-manager" | "sender" | "overlay" | "intercom" | "radio";
type SetupWorkspaceId = "builder" | "analysis";

const SECTIONS: ReadonlyArray<{ id: SectionId; label: string }> = [
  { id: "setup-manager", label: "SETUP" },
  { id: "sender", label: "SENDER" },
  { id: "overlay", label: "OVERLAY" },
  { id: "intercom", label: "INTERCOM" },
  { id: "radio", label: "ENGINEER" },
];

const SETUP_WORKSPACES: ReadonlyArray<{ id: SetupWorkspaceId; label: string }> = [
  { id: "builder", label: "SETUP BUILDER" },
  { id: "analysis", label: "SESSION ANALYSIS" },
];

const WINDOW_TITLEBAR_INSET = window.electronAPI?.platform === "win32" ? 32 : 0;

export function F1SetupManager() {
  const senderUrl = DEFAULT_SENDER_URL;
  const [section, setSection] = useState<SectionId>("setup-manager");
  const [setupWorkspace, setSetupWorkspace] = useState<SetupWorkspaceId>("builder");

  const driverIntercom = useDriverIntercom();
  const engineerRadio = useEngineerRadio(senderUrl, driverIntercom.state);
  const { connected: senderConnected, status: senderStatus, session: liveSession, player: livePlayer, detectedTrack, latestRaceResult } = useSenderConnection(senderUrl);
  const { gate: pairingGate, platformBaseUrl: pairingPlatformBaseUrl, markJustPaired } = usePairingGate(senderUrl, senderConnected, senderStatus);
  const builder = useSetupBuilder({ detectedTrack, liveSession, livePlayer, latestRaceResult });
  const senderSettings = useSenderSettings(senderUrl);
  const overlay = useOverlayControls(senderUrl, senderStatus);
  const recording = useLiveRecording(livePlayer);

  const pairingGateActive = pairingGate === "unpaired";
  // sender.setup.read 자문 게이트 — 구 sender(필드 없음)·미확인(null)·sender 미연결은
  // 전부 허용(fail-open). 카탈로그 데이터는 빌드타임 번들이므로 이 게이트는 UI 안내일
  // 뿐 보안 경계가 아니다. 매칭 규칙 canonical: internal/rbac (includes 금지).
  const setupAllowed =
    !senderStatus || senderStatus.permissions == null || hasPermission(senderStatus.permissions, "sender.setup.read");
  const rootContentRef = useRef<HTMLDivElement>(null);
  const udpPortInputRef = useRef<HTMLInputElement>(null);
  const [udpPortFocusRequest, setUdpPortFocusRequest] = useState(0);
  const udpBindError = senderStatus?.udpBindError ?? null;
  const openUdpPortSettings = () => {
    setSection("sender");
    setUdpPortFocusRequest((current) => current + 1);
  };

  // UDP 포트 점유 알림창(메인 프로세스)의 "UDP 포트 변경" 버튼
  useEffect(() => {
    return window.electronAPI?.onOpenSenderUdpSettings?.(() => {
      setSection("sender");
      setUdpPortFocusRequest((current) => current + 1);
    });
  }, []);

  // Sender 섹션이 렌더된 뒤 UDP 포트 입력란으로 이동
  useEffect(() => {
    if (udpPortFocusRequest === 0 || section !== "sender") return;
    const input = udpPortInputRef.current;
    if (!input) return;
    input.scrollIntoView({ block: "center" });
    input.focus();
    input.select();
  }, [udpPortFocusRequest, section]);

  // React 18: inert 프로퍼티가 없어 ref로 DOM 속성을 직접 set/remove
  useEffect(() => {
    const node = rootContentRef.current;
    if (!node) return;
    if (pairingGateActive) {
      node.setAttribute("inert", "");
    } else {
      node.removeAttribute("inert");
    }
  }, [pairingGateActive]);

  const intercomJoined = driverIntercom.state.status === "joined";
  const contextNote =
    builder.autoContext?.source === "live-session" ? "Live context synced" : builder.autoContext?.source === "race-result" ? "Result context ready" : null;

  return (
    <>
      <div
        ref={rootContentRef}
        style={{
          height: "100%",
          minHeight: 0,
          minWidth: 0,
          paddingTop: WINDOW_TITLEBAR_INSET,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <header
          style={{
            flex: "none",
            margin: "12px 16px 0",
            display: "flex",
            flexDirection: "column",
            gap: 10,
            padding: "11px 14px",
            background: "var(--bg-panel)",
            border: "1px solid var(--bg-panel-border)",
            borderRadius: "var(--radius-lg)",
            boxShadow: "var(--shadow-panel)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: "var(--font-racing)", fontWeight: 800, fontSize: 16, letterSpacing: "0.04em" }}>F1 DRIVER PACK</div>
              <div style={{ fontSize: 10.5, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-muted)" }}>
                {senderConnected
                  ? `Room ${senderStatus?.roomCode || "----"}${contextNote ? ` · ${contextNote}` : ""}`
                  : "Local workspaces available"}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <StatusPill tone={senderConnected ? "lime" : "red"} label={senderConnected ? "SENDER ONLINE" : "SENDER OFFLINE"} />
              <StatusPill
                tone={intercomJoined ? (driverIntercom.state.locallyMuted ? "soft" : "lime") : "muted"}
                label={`INTERCOM ${intercomJoined ? (driverIntercom.state.locallyMuted ? "MUTED" : "LIVE") : driverIntercom.state.status.toUpperCase()}`}
              />
            </div>
          </div>
          <Segmented<SectionId> items={SECTIONS} value={section} onChange={setSection} activeTone="red" ariaLabel="Driver Pack sections" />
        </header>

        <div style={{ flex: 1, minHeight: 0, minWidth: 0, overflowY: "auto", overflowX: "hidden" }}>
          <main style={{ minWidth: 0, padding: "12px 16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
            {udpBindError ? (
              <Notice
                tone="error"
                title={`UDP 포트 ${udpBindError.port} ${udpBindError.reason === "access_denied" ? "접근 불가" : "사용 중"} — 텔레메트리 수신 대기`}
                action={
                  <Button size="sm" variant="danger" onClick={openUdpPortSettings}>
                    UDP 포트 변경
                  </Button>
                }
              >
                SimHub, Crew Chief 등 다른 프로그램을 종료하면 자동으로 연결됩니다. 포트를 바꾸면 게임의 텔레메트리 UDP 포트도 같은 값으로 맞춰 주세요.
              </Notice>
            ) : null}

            {section === "setup-manager" ? (
              <>
                <div>
                  <Segmented<SetupWorkspaceId> items={SETUP_WORKSPACES} value={setupWorkspace} onChange={setSetupWorkspace} ariaLabel="Setup workspace" />
                </div>
                {setupWorkspace === "builder" ? (
                  <SetupBuilderSection builder={builder} setupAllowed={setupAllowed} detectedTrack={detectedTrack} latestRaceResult={latestRaceResult} />
                ) : (
                  <SessionAnalysisSection analysisUrl={normalizeAnalysisServerUrl(senderUrl)} />
                )}
              </>
            ) : null}

            {section === "sender" ? (
              <SenderSection
                senderConnected={senderConnected}
                senderStatus={senderStatus}
                liveSession={liveSession}
                livePlayer={livePlayer}
                detectedTrack={detectedTrack}
                settings={senderSettings}
                recording={recording}
                udpPortInputRef={udpPortInputRef}
              />
            ) : null}

            {section === "overlay" ? <OverlaySection overlay={overlay} /> : null}

            {section === "intercom" ? (
              <Panel title="Pitwall Intercom" detail="Hands-free driver radio">
                <DriverIntercomPanel runtime={driverIntercom.runtime} state={driverIntercom.state} devices={driverIntercom.devices} />
              </Panel>
            ) : null}

            {section === "radio" ? (
              <Panel title="Engineer Radio" detail="Virtual race engineer">
                <EngineerRadioPanel senderUrl={senderUrl} radio={engineerRadio} />
              </Panel>
            ) : null}
          </main>
        </div>
      </div>
      {pairingGateActive ? <PairingGateModal senderUrl={senderUrl} platformBaseUrl={pairingPlatformBaseUrl} onPaired={markJustPaired} /> : null}
    </>
  );
}
