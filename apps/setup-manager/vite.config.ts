import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  plugins: [react()],
  // web/src/ui 등 레포 공용 소스가 react를 web/node_modules에서 찾지 않도록 이 앱의 사본으로 고정한다.
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
    fs: {
      allow: [repoRoot],
    },
  },
});
