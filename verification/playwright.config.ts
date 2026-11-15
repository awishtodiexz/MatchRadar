import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './browser',
  workers: 1,
  retries: 0,
  timeout: 15000,
  maxFailures: 2,
  outputDir: './artifacts/browser',
  updateSnapshots: 'none',
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:1420',
    channel: 'msedge',
    locale: 'en-GB',
    timezoneId: 'Europe/London',
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
