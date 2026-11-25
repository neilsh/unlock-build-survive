/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Production builds are served from https://<user>.github.io/unlock-build-survive/.
// Dev and e2e keep '/' so the local server and Playwright baseURL stay unchanged.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/unlock-build-survive/' : '/',
  plugins: [react(), tailwindcss()],
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
}));
