import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installBridge } from './bridge';
import { mockSnapshot } from '../../src/test-fixtures/fixtures';

// WCAG 2.1 A/AA. Contrast, names, roles and landmark structure are checked on
// every screen a user can reach from the widget.
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function violations(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return result.violations
    .filter((rule) => rule.impact === 'serious' || rule.impact === 'critical')
    .map((rule) => `${rule.id}: ${rule.nodes.map((node) => node.target.join(' ')).join(' | ')}`);
}

async function setTheme(page: Page, theme: 'dark' | 'light') {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Appearance', exact: true }).click();
  await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption(theme);
  await page.getByRole('button', { name: 'Back to matches' }).click();
}

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-29T12:00:00Z') });
  await page.route('https://**/*', (route) => route.abort());
  await installBridge(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: /Match details:.*Arsenal.*Chelsea/ })).toBeVisible();
});

test('home has no serious accessibility violations in either theme', async ({ page }) => {
  // Score and clock stay available to assistive tech through the description.
  await expect(page.getByRole('button', { name: /Match details:.*Arsenal.*Chelsea/ })).toHaveAccessibleDescription(
    /2 to 1, 67′/,
  );
  expect(await violations(page)).toEqual([]);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Appearance', exact: true }).click();
  await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption('light');
  await page.getByRole('button', { name: 'Back to matches' }).click();
  expect(await violations(page)).toEqual([]);
});

test('the match centre tabs have no serious accessibility violations in either theme', async ({ page }) => {
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme);
    await page.getByRole('button', { name: /Match details:.*Arsenal.*Chelsea/ }).click();
    for (const tab of ['Overview', 'Commentary', 'Stats', 'Lineups']) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
      await expect(page.getByRole('tabpanel', { name: tab })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    }
    await page.getByRole('button', { name: 'Back to matches', exact: true }).click();
  }
});

test('settings sections have no serious accessibility violations in either theme', async ({ page }) => {
  for (const theme of ['dark', 'light'] as const) {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('tab', { name: 'Appearance', exact: true }).click();
    await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption(theme);
    for (const section of ['Teams', 'Appearance', 'Alerts', 'App']) {
      await page.getByRole('tab', { name: section, exact: true }).click();
      await expect(page.getByRole('tabpanel', { name: section })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    }
    await page.getByRole('button', { name: 'Back to matches' }).click();
  }
});

test('ticker mode at 112px has no serious accessibility violations in either theme', async ({ page }) => {
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme);
    await page.getByRole('button', { name: 'Ticker mode' }).click();
    await page.setViewportSize({ width: 320, height: 112 });
    expect(await violations(page)).toEqual([]);
    await page.setViewportSize({ width: 320, height: 460 });
    await page.getByRole('button', { name: 'Ticker mode' }).click();
  }
});

test('the existing 320px layout stays accessible in either theme', async ({ page }) => {
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme);
    await page.setViewportSize({ width: 320, height: 700 });
    expect(await violations(page)).toEqual([]);
    await page.setViewportSize({ width: 390, height: 700 });
  }
});

test('a scheduled match centre has no serious accessibility violations in either theme', async ({ page }) => {
  // Scheduled fixtures dim Stats/Lineups/Commentary via tab-upcoming; the live
  // fixture in the other tests never renders them.
  const scheduled = structuredClone(mockSnapshot);
  scheduled.matches = scheduled.matches.map((match) => ({ ...match, status: 'scheduled' }));
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme);
    await page.evaluate(
      (snapshot) => window.dispatchEvent(new CustomEvent('test:set-snapshot', { detail: snapshot })),
      scheduled,
    );
    await page
      .getByRole('button', { name: /Match details:/ })
      .first()
      .click();
    const stats = page.getByRole('tab', { name: 'Stats', exact: true });
    await expect(stats).toHaveAccessibleDescription('Available once the match starts');
    await stats.click();
    await expect(page.getByRole('tabpanel', { name: 'Stats' })).toBeVisible();
    expect(await violations(page)).toEqual([]);
    await page.getByRole('button', { name: 'Back to matches', exact: true }).click();
  }
});

test('the rate-limited header has no serious accessibility violations', async ({ page }) => {
  const limited = structuredClone(mockSnapshot);
  limited.rateLimitedUntil = '2026-10-29T12:10:00Z';
  await page.evaluate(
    (snapshot) => window.dispatchEvent(new CustomEvent('test:set-snapshot', { detail: snapshot })),
    limited,
  );
  await expect(page.getByText(/RATE LIMITED/)).toBeVisible();
  expect(await violations(page)).toEqual([]);
});

test('the loading skeleton has no serious accessibility violations', async ({ page }) => {
  await installBridge(page, { loadDelayMs: 3000 });
  await page.goto('/');
  await expect(page.getByRole('status', { name: 'Loading fixtures' })).toBeVisible();
  expect(await violations(page)).toEqual([]);
  await page.clock.fastForward(3000);
  await expect(page.getByRole('button', { name: /Match details:.*Arsenal.*Chelsea/ })).toBeVisible();
});

test('the settings scroller leaves room for the focus ring', async ({ page }) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  // The ring is 2px outline + 2px offset; a flush scrollport edge clips it.
  await expect(page.locator('.settings-body')).toHaveCSS('scroll-padding-bottom', '6px');
});
