import { defineConfig, devices } from '@playwright/test';

const PORT = 5173;
const PROD_PORT = 4173;
// The deployed site lives under this path (see vite.config.ts); `vite preview` is told the same base.
const PROD_BASE = '/unlock-build-survive/';

// Headless Chromium has no GPU; SwiftShader gives three.js a working WebGL context.
const SWIFTSHADER_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

export default defineConfig({
  testDir: './e2e',
  outputDir: 'test-results',
  // CI: one retry for flaky WebGL/CPU stalls, one worker (SwiftShader is CPU-bound), HTML report for the artifact.
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  projects: [
    {
      name: 'chromium',
      testIgnore: /prod\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://localhost:${PORT}`,
        // Full runs are slow (WebGL + Rapier); traces are only recorded for CI retries.
        trace: process.env.CI ? 'on-first-retry' : 'off',
        viewport: { width: 1280, height: 800 },
        launchOptions: { args: SWIFTSHADER_ARGS },
      },
    },
    {
      // The built bundle on a phone-sized screen under the real GitHub Pages base path. The dev server hides
      // whole classes of bugs (debug hooks, no minification, base "/"), so this is what actually ships.
      name: 'production-mobile',
      testMatch: /prod\.spec\.ts/,
      use: {
        ...devices['Pixel 7'],
        baseURL: `http://localhost:${PROD_PORT}${PROD_BASE}`,
        trace: process.env.CI ? 'on-first-retry' : 'off',
        launchOptions: { args: SWIFTSHADER_ARGS },
      },
    },
  ],
  webServer: [
    {
      command: `npm run dev -- --port ${PORT} --strictPort`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'npm run build && npm run preview:pages',
      url: `http://localhost:${PROD_PORT}${PROD_BASE}`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
});
