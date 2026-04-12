import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const sharedRoot = fileURLToPath(new URL('../shared', import.meta.url))

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': sharedRoot,
    },
  },
  // Dev server proxy only applies in local (default) mode.
  // Remote mode (standalone deploy) has no backend to proxy to.
  server: mode === 'remote' ? {
    port: 3000,
    host: true,
    fs: {
      allow: [repoRoot],
    },
  } : {
    port: 3000,
    host: true,
    fs: {
      allow: [repoRoot],
    },
    allowedHosts: ['api.local.mathsecr.com'],
    proxy: {
      '/ws': {
        target: 'ws://localhost:8081',
        ws: true,
        changeOrigin: true,
      },
      '/api': {
        target: 'http://localhost:8081',
        changeOrigin: true,
        timeout: 5 * 60 * 1000,
        proxyTimeout: 5 * 60 * 1000,
      },
    },
  },
}))
