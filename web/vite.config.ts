import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // Dev server proxy only applies in local (default) mode.
  // Remote mode (standalone deploy) has no backend to proxy to.
  server: mode === 'remote' ? {
    port: 3000,
    host: true,
  } : {
    port: 3000,
    host: true,
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
