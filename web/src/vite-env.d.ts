/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Signaling server WebSocket URL. When set at build time, the app defaults to remote mode. */
  readonly VITE_SIGNALING_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
