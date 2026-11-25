import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installBridge } from './bridge';
import { mockSnapshot } from '../../src/test-fixtures/fixtures';

async function open(page: Page, options: Parameters<typeof installBridge>[1] = {}) {
  await page.route('https://**/*', (route) => route.abort());
  await installBridge(page, options);
  await page.goto('/');
}

test('an empty feed explains the window instead of looking broken', async ({ page }) => {
  const empty = structuredClone(mockSnapshot);
  empty.matches = [];
  await open(page, { snapshot: empty });
  const state = page.locator('.empty');
  await expect(state).toContainText('No fixtures in this window');
  await expect(state).toContainText('No Premier League matches are available for the next 14 days');
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
});

test('ticker mode reports a dead feed instead of a calm empty state', async ({ page }) => {
  await open(page, { failures: { load: 1 } });
  // The startup read failed, so no snapshot ever loaded; collapsing to the
  // ticker must say so rather than claim there are simply no matches.
  await page.getByRole('button', { name: 'Ticker mode' }).click();
  const empty = page.locator('.ticker-empty');
  await expect(empty).toHaveAttribute('role', 'alert');
  await expect(empty).toContainText('Could not load the widget state');
});

test('a results-channel failure does not surface as a ticker feed alert', async ({ page }) => {
  const empty = structuredClone(mockSnapshot);
  empty.matches = [];
  await open(page, { snapshot: empty, failures: { results: 1 } });
  // On the Results view the only failing channel is recent results; the ticker
  // shows fixtures, so that error must not follow the user into ticker mode.
  await page.getByRole('button', { name: 'Results', exact: true }).click();
  await expect.poll(() => page.evaluate(() => Reflect.get(window, '__MATCHRADAR_BRIDGE_STATS__').results)).toBe(1);
  await page.getByRole('button', { name: 'Ticker mode' }).click();
  const state = page.locator('.ticker-empty');
  await expect(state).not.toHaveAttribute('role', 'alert');
  await expect(state).toContainText('No live or upcoming matches');
});
