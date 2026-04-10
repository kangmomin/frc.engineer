/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Signaling server WebSocket URL. When set at build time, the app defaults to remote mode. */
  readonly VITE_SIGNALING_URL?: string;
  /** Optional JSON array of RTCIceServer objects used for WebRTC, including TURN relays. */
  readonly VITE_WEBRTC_ICE_SERVERS?: string;
  /** Enable frontend-only mock telemetry feed. */
  readonly VITE_MOCK_MODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
