import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { installBridge } from '../browser/bridge';
import { largeSnapshot } from '../fixtures/large';
import { mockSnapshot } from '../../src/test-fixtures/fixtures';
import { matchesView } from '../../src/matchViews';

// Render/inspection benchmark, not a gate. The only assertions are correctness
// smoke checks; the measurements are written as JSON evidence.
const OUT = 'verification/artifacts/perf';
const RUNS = 3;
const median = (values: number[]) => values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)];

interface Run {
  firstCardMs: number;
  scrollMs: number;
  filterMs: number;
  domNodes: number;
  cards: number;
  images: number;
  longTaskCount: number;
  longTaskTotalMs: number;
  longTaskMaxMs: number;
  layoutShift: number;
  domContentLoadedMs: number;
  loadMs: number;
}

async function measure(
  page: import('@playwright/test').Page,
  cardCount: number,
  snapshot: Parameters<typeof installBridge>[1]['snapshot'],
): Promise<Run[]> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.setViewportSize({ width: 390, height: 700 });
  await page.route('https://**/*', (route) => route.abort());
  await installBridge(page, { snapshot });
  const expectedFollowing = matchesView(snapshot.matches, 'All', snapshot.settings.favorites, true).length;
  const runs: Run[] = [];
  for (let run = 0; run < RUNS; run++) {
    const trace = process.env.MATCHRADAR_PROFILE === '1' && cardCount === 240 && run === 0;
    const traceEvents: unknown[] = [];
    if (trace) {
      cdp.on('Tracing.dataCollected', ({ value }) => traceEvents.push(...value));
      await cdp.send('Tracing.start', {
        categories: 'devtools.timeline,disabled-by-default-devtools.timeline,blink.user_timing',
      });
    }
    const started = Date.now();
    await page.goto('/');
    await expect(page.getByRole('button', { name: /^Match details:/ }).first()).toBeVisible();
    const firstCardMs = Date.now() - started;
    const metrics = await page.evaluate(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const bench = (window as unknown as { __BENCH__: { longTasks: Array<[number, number]>; layoutShift: number } })
        .__BENCH__;
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
      return {
        domNodes: document.querySelectorAll('*').length,
        cards: document.querySelectorAll('.match-card').length,
        images: document.querySelectorAll('.match-list img').length,
        longTaskCount: bench.longTasks.length,
        longTaskTotalMs: bench.longTasks.reduce((total, [, duration]) => total + duration, 0),
        longTaskMaxMs: bench.longTasks.reduce((max, [, duration]) => Math.max(max, duration), 0),
        layoutShift: bench.layoutShift,
        domContentLoadedMs: nav?.domContentLoadedEventEnd ?? 0,
        loadMs: nav?.loadEventEnd ?? 0,
      };
    });
    const scrollMs = await page.locator('.match-list').evaluate(async (element) => {
      const start = performance.now();
      element.scrollTop = element.scrollHeight;
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      return performance.now() - start;
    });
    const filter = page.getByRole('button', { name: 'Following only', exact: true });
    const filterMs = await filter.evaluate(async (button: HTMLButtonElement, trace) => {
      if (trace) performance.mark('filter-start');
      const start = performance.now();
      button.click();
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const duration = performance.now() - start;
      if (trace) performance.mark('filter-end');
      return duration;
    }, trace);
    if (trace) {
      const complete = new Promise<void>((resolve) => cdp.once('Tracing.tracingComplete', () => resolve()));
      await cdp.send('Tracing.end');
      await complete;
      fs.mkdirSync(OUT, { recursive: true });
      fs.writeFileSync(`${OUT}/large-240-trace.json`, JSON.stringify({ traceEvents }));
    }
    expect(metrics.cards).toBe(cardCount);
    await expect(filter).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.match-card')).toHaveCount(expectedFollowing);
    await page.locator('.match-list').evaluate((element) => {
      element.scrollTop = 0;
    });
    runs.push({ firstCardMs, scrollMs, filterMs, ...metrics });
  }
  return runs;
}

function summarize(runs: Run[]) {
  const numeric: Array<keyof Run> = [
    'firstCardMs',
    'scrollMs',
    'filterMs',
    'domNodes',
    'cards',
    'images',
    'longTaskCount',
    'longTaskTotalMs',
    'longTaskMaxMs',
    'layoutShift',
    'domContentLoadedMs',
    'loadMs',
  ];
  return Object.fromEntries(
    numeric.map((key) => [
      key,
      {
        runs: runs.map((run) => Math.round(run[key] * 100) / 100),
        median: Math.round(median(runs.map((run) => run[key])) * 100) / 100,
      },
    ]),
  );
}

async function report(page: import('@playwright/test').Page, name: string, runs: Run[]) {
  const userAgent = await page.evaluate(() => navigator.userAgent);
  const evidence = {
    name,
    capturedAt: new Date().toISOString(),
    environment: { userAgent, node: process.version, viewport: '390x700', cpuThrottle: '4x', runs: RUNS },
    summary: summarize(runs),
    raw: runs,
  };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(`${OUT}/${name}.json`, JSON.stringify(evidence, null, 2));
  console.log(`\n[bench] ${name} ${JSON.stringify(evidence.summary)}`);
}

test('large fixture list render (240 matches)', async ({ page }) => {
  test.setTimeout(30_000);
  await page.addInitScript(() => {
    const bench = { longTasks: [] as Array<[number, number]>, layoutShift: 0 };
    (window as unknown as { __BENCH__: typeof bench }).__BENCH__ = bench;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) bench.longTasks.push([entry.startTime, entry.duration]);
    }).observe({ type: 'longtask', buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
        if (!shift.hadRecentInput) bench.layoutShift += shift.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
  const runs = await measure(page, 240, largeSnapshot(240));
  await report(page, 'large-240', runs);
});

test('baseline home render (12 matches)', async ({ page }) => {
  await page.addInitScript(() => {
    const bench = { longTasks: [] as Array<[number, number]>, layoutShift: 0 };
    (window as unknown as { __BENCH__: typeof bench }).__BENCH__ = bench;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) bench.longTasks.push([entry.startTime, entry.duration]);
    }).observe({ type: 'longtask', buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
        if (!shift.hadRecentInput) bench.layoutShift += shift.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
  const runs = await measure(page, 12, mockSnapshot);
  await report(page, 'baseline-12', runs);
});
