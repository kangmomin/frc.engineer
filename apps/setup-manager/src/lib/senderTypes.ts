// Embedded Sender HTTP API(/api/status, /api/debug, /api/config, /api/local-ops) 응답 타입.
export type SenderStorageMode = "resultOnly" | "summary" | "advanced";

export interface SenderInvite {
  dashboardUrl?: string;
  signalingUrl?: string;
  roomId?: string;
  roomCode?: string;
  link?: string;
  passwordRequired?: boolean;
}

export interface SenderPeer {
  peerId?: string;
  state?: string;
  view?: string;
}

export interface SenderCurrentTrack {
  name?: string;
  filename?: string;
  hasRecordedPreview?: boolean;
}

export interface SenderStatus {
  currentTrack?: SenderCurrentTrack;
  radarActive?: boolean;
  weatherActive?: boolean;
  strategyActive?: boolean;
  radioActive?: boolean;
  roomCode?: string;
  roomId?: string;
  roomName?: string;
  roomProtected?: boolean;
  connectedEngineers?: number;
  udpPort?: number;
  saveFiles?: boolean;
  raceStorageMode?: SenderStorageMode | "off";
  invite?: SenderInvite;
  peers?: SenderPeer[];
  paired?: boolean;
  // null/부재 = UDP 수신 중, 객체 = 포트 점유로 바인드 대기 중(sender가 3초마다 자동 재시도)
  udpBindError?: SenderUdpBindError | null;
}

export interface SenderUdpBindError {
  port: number;
  reason?: "in_use" | "access_denied" | "unknown";
  detail?: string;
}

export interface SenderSession {
  sessionType?: string;
  weather?: string;
  trackTemp?: number;
  trackName?: string;
}

export interface SenderDynamics {
  understeerPct?: number;
  oversteerPct?: number;
  lockupCount?: number;
}

export interface SenderPlayer {
  name?: string;
  teamId?: number;
  position?: number;
  tireWear?: number[];
  tireInnerTemp?: number[];
  fuelRemainingLaps?: number;
  tireAge?: number;
  tireCompound?: string;
  topSpeed?: number;
  bestLapTime?: number;
  lastLapTime?: number;
  brakeBias?: number;
  currentLapNum?: number;
  dynamics?: SenderDynamics[];
}


export interface OverlayHotkeys {
  radar: string;
  weather: string;
  strategy: string;
  radio: string;
}

export interface SenderForwardTargetResponse {
  host?: string;
  port?: number;
  enabled?: boolean;
}

export interface SenderForwardTargetDraft {
  host: string;
  port: string;
  enabled: boolean;
}

export interface SenderConfigResponse {
  udpPort?: number;
  saveFiles?: boolean;
  dataStorageMode?: SenderStorageMode;
  trackRecording?: boolean;
  roomName?: string;
  roomPassword?: string;
  forwardTargets?: SenderForwardTargetResponse[];
}

export interface SenderConfigConflictResponse {
  error?: string;
  requiresOverwriteConfirm?: boolean;
  currentTrack?: SenderCurrentTrack;
}

export interface SenderConfigDraft {
  udpPort: string;
  saveFiles: boolean;
  dataStorageMode: SenderStorageMode;
  trackRecording: boolean;
  roomName: string;
  roomPassword: string;
  forwardTargets: SenderForwardTargetDraft[];
}

export interface SenderStorageInfo {
  selected: string | null;
  effective: string;
  usingCustom: boolean;
}
