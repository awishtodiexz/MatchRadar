import { defineConfig } from '@playwright/test';
import base from '../playwright.config';

// Benchmarks are deliberately outside verify:ui: wall-clock budgets are unstable
// on shared CI hosts. Run explicitly with:
//   npx playwright test --config verification/bench/playwright.bench.config.ts
// Results are written under the gitignored verification/artifacts/perf/.
export default defineConfig({
  ...base,
  testDir: '.',
  outputDir: '../artifacts/perf',
  reporter: [['list']],
  expect: {timeout: 30000},
  use: {...base.use, trace: 'off', screenshot: 'off'}
});
