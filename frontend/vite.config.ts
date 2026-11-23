import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
// tauri.conf.json is the single source of truth for the app version.
import tauriConfig from '../src-tauri/tauri.conf.json'

const appVersion = tauriConfig.version

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test-setup.ts',
    css: true,
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
