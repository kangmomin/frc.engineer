/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Signaling server WebSocket URL. When set at build time, the app defaults to remote mode. */
  readonly VITE_SIGNALING_URL?: string;
  /** Enable frontend-only mock telemetry feed. */
  readonly VITE_MOCK_MODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
