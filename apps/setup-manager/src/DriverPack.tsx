import { useEffect, useRef, useState } from "react";

import { DriverIntercomPanel } from "./DriverIntercomPanel";
import { EngineerRadioPanel } from "./EngineerRadioPanel";
import { useDriverIntercom } from "./useDriverIntercom";
import { useEngineerRadio } from "./useEngineerRadio";
import { useOverlayControls } from "./hooks/useOverlayControls";
import { usePairingGate, useSenderConnection } from "./hooks/useSenderConnection";
import { useSenderSettings } from "./hooks/useSenderSettings";
import { DEFAULT_SENDER_URL } from "./lib/senderApi";
import { OverlaySection } from "./sections/OverlaySection";
import { PairingGateModal } from "./sections/PairingGateModal";
import { SenderSection } from "./sections/SenderSection";
import { Sidebar, type NavItem } from "./shell/Sidebar";
import { ScreenHeader, TopBar } from "./shell/TopBar";
import styles from "./shell/shell.module.css";
import { Button, Notice, Panel, StatusPill } from "./ui";

type SectionId = "sender" | "overlay" | "intercom" | "radio";

const SECTIONS: ReadonlyArray<NavItem<SectionId> & { title: string; detail: string; context: string }> = [
  { id: "sender", label: "SENDER", short: "SENDER", idx: "01", title: "Sender", detail: "내장 Sender 상태 · 수신 설정 · 엔지니어 룸 공유", context: "SENDER · 텔레메트리 수신" },
  { id: "overlay", label: "OVERLAY", short: "OVERLAY", idx: "02", title: "Overlay", detail: "게임 위 네이티브 오버레이 · 전역 핫키", context: "OVERLAY · 인게임 표시" },
  { id: "intercom", label: "INTERCOM", short: "INTERCOM", idx: "03", title: "Intercom", detail: "핸즈프리 드라이버 무전 · 팀 그룹", context: "INTERCOM · 팀 무전" },
  { id: "radio", label: "ENGINEER", short: "ENGINEER", idx: "04", title: "Engineer Radio", detail: "가상 레이스 엔지니어 콜 · 음성 출력 · 결정 모델", context: "ENGINEER · 가상 레이스 엔지니어" },
];

const WINDOW_TITLEBAR_INSET = window.electronAPI?.platform === "win32" ? 32 : 0;

export function DriverPack() {
  const senderUrl = DEFAULT_SENDER_URL;
  const [section, setSection] = useState<SectionId>("sender");

  const driverIntercom = useDriverIntercom();
  const engineerRadio = useEngineerRadio(senderUrl, driverIntercom.state);
  const { connected: senderConnected, status: senderStatus, session: liveSession, player: livePlayer, trackName } = useSenderConnection(senderUrl);
  const { gate: pairingGate, platformBaseUrl: pairingPlatformBaseUrl, markJustPaired } = usePairingGate(senderUrl, senderConnected, senderStatus);
  const senderSettings = useSenderSettings(senderUrl);
  const overlay = useOverlayControls(senderUrl, senderStatus);

  const pairingGateActive = pairingGate === "unpaired";
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
  const current = SECTIONS.find((item) => item.id === section) ?? SECTIONS[0];
  const senderMeta = senderConnected
    ? `◆ ROOM ${senderStatus?.roomCode || "----"}`
    : udpBindError
      ? `UDP ${udpBindError.port} 대기 중`
      : "내장 Sender 시작 대기";

  return (
    <>
      <div ref={rootContentRef} className={styles.root}>
        {WINDOW_TITLEBAR_INSET ? (
          <div className={styles.titlebar} style={{ height: WINDOW_TITLEBAR_INSET }}>
            F1 DRIVER PACK
          </div>
        ) : null}
        <div className={styles.body}>
          <Sidebar<SectionId> items={SECTIONS} active={section} onNav={setSection} senderConnected={senderConnected} senderMeta={senderMeta} />

          <div className={styles.column}>
            <TopBar context={current.context}>
              <StatusPill tone={senderConnected ? "lime" : "red"} label={senderConnected ? "SENDER ONLINE" : "SENDER OFFLINE"} />
              <StatusPill
                tone={intercomJoined ? (driverIntercom.state.locallyMuted ? "soft" : "lime") : "muted"}
                label={`INTERCOM ${intercomJoined ? (driverIntercom.state.locallyMuted ? "MUTED" : "LIVE") : driverIntercom.state.status.toUpperCase()}`}
              />
            </TopBar>

            <main className={styles.main}>
              <div className={styles.screen}>
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

                <ScreenHeader title={current.title} detail={current.detail} />

                {section === "sender" ? (
                  <SenderSection
                    senderConnected={senderConnected}
                    senderStatus={senderStatus}
                    liveSession={liveSession}
                    livePlayer={livePlayer}
                    trackName={trackName}
                    settings={senderSettings}
                    udpPortInputRef={udpPortInputRef}
                  />
                ) : null}

                {section === "overlay" ? <OverlaySection overlay={overlay} /> : null}

                {section === "intercom" ? (
                  <Panel title="Pitwall Intercom" detail="팀 비밀번호로 그룹을 만들거나 그룹 코드로 참여합니다.">
                    <DriverIntercomPanel runtime={driverIntercom.runtime} state={driverIntercom.state} devices={driverIntercom.devices} />
                  </Panel>
                ) : null}

                {section === "radio" ? <EngineerRadioPanel senderUrl={senderUrl} radio={engineerRadio} /> : null}
              </div>
            </main>
          </div>
        </div>
      </div>
      {pairingGateActive ? <PairingGateModal senderUrl={senderUrl} platformBaseUrl={pairingPlatformBaseUrl} onPaired={markJustPaired} /> : null}
    </>
  );
}
