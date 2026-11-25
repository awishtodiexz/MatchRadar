import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './browser',
  workers: 1,
  retries: 0,
  timeout: 15000,
  // No early bail: one red regression used to hide the other ~96% of the gate.
  maxFailures: 0,
  outputDir: './artifacts/browser',
  updateSnapshots: 'none',
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:1420',
    channel: 'msedge',
    locale: 'en-GB',
    timezoneId: 'Europe/London',
    // The widget's real window is 390x700 (320..600 x 460..1100; the ticker can
    // shrink to 112). Tests that need another size still call setViewportSize.
    viewport: { width: 390, height: 700 },
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    cwd: process.cwd(),
    command: 'npm exec vite preview -- --configLoader runner --host 127.0.0.1 --port 1420 --strictPort',
    url: 'http://127.0.0.1:1420',
    reuseExistingServer: false,
    timeout: 20000,
  },
});
