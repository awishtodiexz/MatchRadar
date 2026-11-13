import { test, expect } from '@playwright/test';

import { installBridge } from './bridge';

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-29T12:00:00Z') });
  await page.route('https://**/*', route => route.abort());
  await installBridge(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: /Match details:.*Arsenal.*Chelsea/ })).toBeVisible();
});

test('home filters show the appropriate fixtures', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Hide widget' })).toHaveCount(1);
  await expect(page.locator('.hero')).toHaveCount(0);
  for (const name of ['Live', 'Following', 'Upcoming', 'Results', 'All']) {
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: /^Match details:/ }).first()).toBeVisible();
    if (name === 'Upcoming') await expect(page.getByRole('button', { name: /Match details:.*Arsenal.*Chelsea/ })).toHaveCount(0);
    if (name === 'Results') await expect(page.getByRole('button', { name: /Match details:.*Brighton & Hove Albion.*Everton/ })).toBeVisible();
  }
});

test('Following persists its legacy setting while All includes unfollowed clubs', async ({ page }) => {
  const other = page.getByRole('button', { name: /Match details:.*Crystal Palace.*Fulham/ });
  await expect(other).toBeVisible();
  await page.getByRole('button', { name: 'Following', exact: true }).click();
  await expect(other).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => Reflect.get(window, '__MATCHRADAR_BRIDGE_STATS__').lastSavedSettings?.followedOnly)).toBe(true);
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await expect(other).toBeVisible();
  await expect.poll(() => page.evaluate(() => Reflect.get(window, '__MATCHRADAR_BRIDGE_STATS__').lastSavedSettings?.followedOnly)).toBe(false);
});

test('bell is independent and Match Centre tabs support keyboard navigation', async ({ page }) => {
  await page.getByRole('button', { name: /Match alerts: Arsenal versus Chelsea/ }).click();
  await page.getByRole('button', { name: 'On', exact: true }).click();
  await expect(page.getByRole('button', { name: 'On', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Match details', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: /Match details:.*Arsenal.*Chelsea/ }).click();
  await expect(page.getByRole('tablist', { name: 'Match centre sections' }).getByRole('tab')).toHaveText(['Overview', 'Stats', 'Lineups', 'Commentary']);
  for (const tab of ['Overview', 'Stats', 'Lineups', 'Commentary']) {
    await page.getByRole('tab', { name: tab, exact: true }).click();
    await expect(page.getByRole('tabpanel', { name: tab })).toBeVisible();
  }
  await page.getByRole('tab', { name: 'Lineups', exact: true }).click();
  await expect(page.getByText('Goalkeepers', { exact: true })).toHaveCount(1);
  await page.getByRole('tab', { name: /Chelsea/ }).click();
  await expect(page.getByText('Goalkeepers', { exact: true })).toHaveCount(1);
  await page.getByRole('tab', { name: 'Lineups', exact: true }).press('Home');
  await expect(page.getByRole('tab', { name: 'Overview', exact: true })).toBeFocused();
});

test('timeline period headings scroll with the list instead of covering events', async ({ page }) => {
  await page.getByRole('button', { name: /Match details:.*Arsenal.*Chelsea/ }).click();
  await page.getByRole('tab', { name: 'Commentary', exact: true }).click();
  const period = page.locator('.timeline-period').first();
  await expect(period).toBeVisible();
  // Regression: sticky period labels covered the row scrolling underneath them.
  await expect(period).not.toHaveCSS('position', 'sticky');
});

test('returning home restores scroll and the match-card focus', async ({ page }) => {
  const card = page.getByRole('button', { name: /Match details:.*Brighton & Hove Albion.*Everton/ });
  await card.scrollIntoViewIfNeeded();
  const scroll = await page.locator('.match-list').evaluate(element => element.scrollTop);
  expect(scroll).toBeGreaterThan(0);
  await card.click();
  await page.keyboard.press('Escape');
  await expect(card).toBeFocused();
  await expect.poll(() => page.locator('.match-list').evaluate(element => element.scrollTop)).toBe(scroll);
});

test('theme changes and demo controls are absent from settings', async ({ page }) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Appearance', exact: true }).click();
  for (const theme of ['light', 'dark']) {
    await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption(theme);
    await expect(page.locator('main')).toHaveClass(new RegExp('theme-' + theme));
  }
  await page.getByRole('tab', { name: 'App', exact: true }).click();
  await expect(page.getByText('Demo data', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Demo controls' })).toHaveCount(0);
});

test('upcoming match shows supplied venue and keeps detail tabs available', async ({ page }, info) => {
  await page.getByRole('button', { name: 'Upcoming', exact: true }).click();
  await page.getByRole('button', { name: /Match details:.*Manchester City.*Manchester United/ }).click();
  await expect(page.getByText('Lineups and live coverage appear closer to kick-off.')).toBeVisible();
  await expect(page.getByText('Test Stadium')).toBeVisible();
  await page.screenshot({path:info.outputPath('upcoming-details.png'),animations:'disabled'});
  for (const name of ['Stats', 'Lineups', 'Commentary']) {
    await page.getByRole('tab', { name, exact: true }).click();
    await expect(page.getByRole('tabpanel', { name })).toBeVisible();
  }
});

for (const [width, theme] of [[320, 'light'], [390, 'dark']] as const) {
  test(`upcoming details fit at ${width}px in ${theme}`, async ({ page }, info) => {
    await page.setViewportSize({width,height:700});
    await page.getByRole('button',{name:'Settings',exact:true}).click();
    await page.getByRole('tab',{name:'Appearance'}).click();
    await page.getByRole('combobox',{name:'Theme'}).selectOption(theme);
    await page.getByRole('button',{name:'Back to matches'}).click();
    await page.getByRole('button',{name:'Upcoming',exact:true}).click();
    await page.getByRole('button',{name:/Match details:.*Manchester City.*Manchester United/}).click();
    await expect(page.getByText('Test Stadium')).toBeVisible();
    expect(await page.locator('.detail-body').evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
    await page.screenshot({path:info.outputPath('upcoming.png'),animations:'disabled'});
  });
  test(`Match Centre stays within ${width}px in ${theme} theme`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 });
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('tab', { name: 'Appearance', exact: true }).click();
    await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption(theme);
    await page.getByRole('button', { name: 'Back to matches', exact: true }).click();
    await page.getByRole('button', { name: /Match details:.*Arsenal.*Chelsea/ }).click();
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
    await page.getByRole('button', { name: /Match details:.*Arsenal.*Chelsea/ }).click();
    for (const name of ['Commentary', 'Stats', 'Lineups']) {
      await page.getByRole('tab', { name, exact: true }).click();
      expect(await page.locator('.detail-body').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    }
  });
}
