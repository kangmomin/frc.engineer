import { fileURLToPath } from 'node:url';
export default {
  root: fileURLToPath(new URL('.', import.meta.url)),
  resolve: { alias: {
    react: fileURLToPath(new URL('./node_modules/react', import.meta.url)),
    'react-dom': fileURLToPath(new URL('./node_modules/react-dom', import.meta.url)),
  } },
  esbuild: { jsx: 'automatic' },
  test: { environment: 'node', include: ['tests/analysis*.test.{ts,tsx}', 'tests/radio*.test.{ts,tsx}'] },
};
