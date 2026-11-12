/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { devBridgePlugin } from './dev/bridge';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), devBridgePlugin()],
  resolve: {
    alias: {
      '@': path.resolve(rootDir, 'src'),
    },
  },
  clearScreen: false,
  server: {
    host: '127.0.0.1',
    port: 1420,
    strictPort: true,
    watch: {
      // Claude Code keeps its session worktrees under .claude; they are other checkouts.
      ignored: ['**/src-tauri/**', '**/.claude/**'],
    },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    target: 'chrome120',
    minify: 'esbuild',
    sourcemap: false,
    chunkSizeWarningLimit: 1400,
  },
  test: {
    exclude: [...configDefaults.exclude, '.claude/**'],
  },
});
