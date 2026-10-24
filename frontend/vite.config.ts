/// <reference types="vitest/config" />
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  server: {
    // In development the API runs separately; in Docker, nginx proxies /api instead.
    proxy: { '/api': process.env.API_PROXY_TARGET ?? 'http://localhost:8000' },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    // Node's fetch rejects relative URLs, so tests call the API on an absolute origin.
    env: { VITE_API_BASE_URL: 'http://localhost' },
    exclude: ['**/node_modules/**', 'e2e/**'],
    setupFiles: ['./src/test/setup.ts'],
  },
})
