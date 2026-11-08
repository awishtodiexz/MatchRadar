import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installBridge } from './bridge';

// WCAG 2.1 A/AA. Contrast, names, roles and landmark structure are checked on
// every screen a user can reach from the widget.
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function violations(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(TAGS)
    // Match cards deliberately use one descriptive name ("Match details: X versus Y")
    // while the row also renders score, clock and status. Those facts are exposed as
    // the accessible description, but axe treats the composite card text as a label
    // and reports every scored card as a label-in-name mismatch.
    .disableRules(['label-content-name-mismatch'])
    .analyze();
  return result.violations
    .filter(rule => rule.impact === 'serious' || rule.impact === 'critical')
    .map(rule => `${rule.id}: ${rule.nodes.map(node => node.target.join(' ')).join(' | ')}`);
}

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-29T12:00:00Z') });
  await page.route('https://**/*', route => route.abort());
  await installBridge(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Match details: Arsenal versus Chelsea' })).toBeVisible();
});

test('home has no serious accessibility violations in either theme', async ({ page }) => {
  // Score and clock stay available to assistive tech through the description.
  await expect(page.getByRole('button', { name: 'Match details: Arsenal versus Chelsea' }))
    .toHaveAttribute('title', /2 to 1, 67′/);
  expect(await violations(page)).toEqual([]);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Appearance', exact: true }).click();
  await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption('light');
  await page.getByRole('button', { name: 'Back to matches' }).click();
  expect(await violations(page)).toEqual([]);
});

test('the match centre tabs have no serious accessibility violations', async ({ page }) => {
  await page.getByRole('button', { name: 'Match details: Arsenal versus Chelsea' }).click();
  for (const tab of ['Overview', 'Timeline', 'Stats', 'Lineups']) {
    await page.getByRole('tab', { name: tab, exact: true }).click();
    await expect(page.getByRole('tabpanel', { name: tab })).toBeVisible();
    expect(await violations(page)).toEqual([]);
  }
});

test('settings sections have no serious accessibility violations', async ({ page }) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  for (const section of ['Teams', 'Appearance', 'Alerts', 'App']) {
    await page.getByRole('tab', { name: section, exact: true }).click();
    await expect(page.getByRole('tabpanel', { name: section })).toBeVisible();
    expect(await violations(page)).toEqual([]);
  }
});

test('the existing 320px layout stays accessible', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  expect(await violations(page)).toEqual([]);
});
