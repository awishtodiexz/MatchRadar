import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-29T12:00:00Z') });
  await page.route('https://**/*', route => route.abort());
  await page.goto('/');
  await expect(page.getByText('DEMO DATA', { exact: true })).toBeVisible();
});

test('home filters show the appropriate fixtures', async ({ page }) => {
  for (const name of ['Live', 'Following', 'Upcoming', 'Results', 'All']) {
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: /^Match details:/ }).first()).toBeVisible();
    if (name === 'Upcoming') await expect(page.getByRole('button', { name: 'Match details: Arsenal versus Chelsea' })).toHaveCount(0);
    if (name === 'Results') await expect(page.getByRole('button', { name: 'Match details: Brighton & Hove Albion versus Everton' })).toBeVisible();
  }
});

test('bell is independent and Match Centre tabs support keyboard navigation', async ({ page }) => {
  await page.getByRole('button', { name: /Enable all alerts.*Arsenal versus Chelsea/ }).click();
  await expect(page.getByRole('heading', { name: 'Match details', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Match details: Arsenal versus Chelsea' }).click();
  for (const tab of ['Overview', 'Timeline', 'Stats', 'Lineups']) {
    await page.getByRole('tab', { name: tab, exact: true }).click();
    await expect(page.getByRole('tabpanel', { name: tab })).toBeVisible();
  }
  await expect(page.getByText('Goalkeepers', { exact: true })).toHaveCount(2);
  await page.getByRole('tab', { name: 'Lineups', exact: true }).press('Home');
  await expect(page.getByRole('tab', { name: 'Overview', exact: true })).toBeFocused();
});

test('returning home restores scroll and the match-card focus', async ({ page }) => {
  const card = page.getByRole('button', { name: 'Match details: Brighton & Hove Albion versus Everton' });
  await card.scrollIntoViewIfNeeded();
  const scroll = await page.locator('.match-list').evaluate(element => element.scrollTop);
  expect(scroll).toBeGreaterThan(0);
  await card.click();
  await page.keyboard.press('Escape');
  await expect(card).toBeFocused();
  await expect.poll(() => page.locator('.match-list').evaluate(element => element.scrollTop)).toBe(scroll);
});

test('theme changes and demo progression/reset remain available in settings', async ({ page }) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Appearance', exact: true }).click();
  for (const theme of ['light', 'dark']) {
    await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption(theme);
    await expect(page.locator('main')).toHaveClass(new RegExp('theme-' + theme));
  }
  await page.getByRole('tab', { name: 'App', exact: true }).click();
  await page.getByRole('button', { name: 'Advance match', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Demo controls' })).toContainText('First half');
  await page.getByRole('button', { name: 'Reset demo', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Demo controls' })).toContainText('Scheduled');
});

test('upcoming match honestly omits unavailable detail tabs', async ({ page }) => {
  await page.getByRole('button', { name: 'Upcoming', exact: true }).click();
  await page.getByRole('button', { name: 'Match details: Manchester City versus Manchester United' }).click();
  await expect(page.getByText('No event timeline is available for this match.')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Stats', exact: true })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Lineups', exact: true })).toHaveCount(0);
});

for (const [width, theme] of [[320, 'light'], [390, 'dark']] as const) {
  test(`Match Centre stays within ${width}px in ${theme} theme`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 });
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('tab', { name: 'Appearance', exact: true }).click();
    await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption(theme);
    await page.getByRole('button', { name: 'Back to matches', exact: true }).click();
    await page.getByRole('button', { name: 'Match details: Arsenal versus Chelsea' }).click();
    for (const tab of ['Stats', 'Lineups']) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await page.locator('.detail-body').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    }
  });
}

for (const [width, theme] of [[320, 'dark'], [390, 'light']] as const) {
  test(`compact ${width}px ${theme} settings and details remain usable`, async ({ page }) => {
    await page.setViewportSize({ width, height: 460 });
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('tab', { name: 'Appearance', exact: true }).click();
    await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption(theme);
    await page.getByText('Compact view', { exact: true }).click();
    for (const name of ['Teams', 'Appearance', 'Alerts', 'App']) {
      await page.getByRole('tab', { name, exact: true }).click();
      await expect(page.getByRole('tabpanel', { name })).toBeVisible();
      expect(await page.locator('.settings-body').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeInViewport();
    }
    await page.getByRole('button', { name: 'Back to matches', exact: true }).click();
    await page.getByRole('button', { name: 'Match details: Arsenal versus Chelsea' }).click();
    for (const name of ['Timeline', 'Stats', 'Lineups']) {
      await page.getByRole('tab', { name, exact: true }).click();
      expect(await page.locator('.detail-body').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    }
  });
}
