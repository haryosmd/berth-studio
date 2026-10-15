import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Builds into dist/, which Tauri bundles (see src-tauri/tauri.conf.json).
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true, target: 'safari16', sourcemap: false },
});
