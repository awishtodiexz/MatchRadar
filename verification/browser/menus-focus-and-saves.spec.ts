import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installBridge } from './bridge';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 460 });
  await page.clock.install({ time: new Date('2026-10-29T12:00:00Z') });
  await page.route('https://**/*', route => route.abort());
  await installBridge(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: /Match details:.*Arsenal.*Chelsea/ })).toBeVisible();
});

test('bottom fixture alert menu stays inside the minimum viewport', async ({ page }) => {
  const bells = page.getByRole('button', { name: /^Match alerts:/ });
  await bells.last().click();
  const menu = page.getByRole('dialog', { name: 'Match alerts' });
  const bounds = await menu.boundingBox();
  if(!bounds) throw new Error('Alert menu has no visible bounds');
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(460);
  await expect(menu.getByRole('button', { name: 'Muted', exact: true })).toBeInViewport();
});

test('minimum viewport retains opaque sticky navigation and canonical live count', async ({ page }) => {
  const tabs = page.getByRole('navigation', { name: 'Fixture views' });
  await expect(tabs.getByRole('button', { name: 'Live' })).toHaveAttribute('title', '4 matches');
  await expect(page.getByLabel('Premier League: 4 live matches')).toBeVisible();
  await expect(page.locator('.hero')).toHaveCount(0);
  const list = page.locator('.match-list');
  await list.evaluate(element => { element.scrollTop = 100; });
  const heading = page.locator('.match-list > section > .group-title').first();
  for (const element of [tabs, heading]) {
    const style = await element.evaluate(node => ({ position: getComputedStyle(node).position, background: getComputedStyle(node).backgroundColor }));
    expect(style.position).toBe('sticky');
    expect(style.background).toMatch(/^rgb\(/);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test('Escape clears club search before closing settings', async ({ page }) => {
  await page.getByRole('button', { name: 'Settings' }).click();
  const search = page.getByRole('searchbox', { name: 'Search clubs' });
  await search.fill('Arsenal');
  await search.press('Escape');
  await expect(search).toHaveValue('');
  await expect(search).toBeVisible();
  await search.press('Escape');
  await expect(page.getByRole('navigation', { name: 'Fixture views' })).toBeVisible();
});

test('theme selector offers the system preference', async ({ page }) => {
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Appearance' }).click();
  const theme = page.getByRole('combobox', { name: 'Theme' });
  await theme.selectOption('system');
  await expect(theme).toHaveValue('system');
});

test('Escape closes an open alert menu even when focus leaves it', async ({ page }) => {
  const bell = page.getByRole('button', { name: 'Match alerts: Arsenal versus Chelsea, Team default' });
  await bell.click();
  await expect(page.getByRole('dialog', { name: 'Match alerts' })).toBeVisible();
  await page.getByRole('button', { name: 'Settings' }).focus();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Match alerts' })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Fixture views' })).toBeVisible();
});

test('match-card accessible names pass axe without an exemption', async ({ page }) => {
  const result = await new AxeBuilder({ page }).withRules(['label-content-name-mismatch']).analyze();
  expect(result.violations).toEqual([]);
});

test('failed alert saves report failure and retain the inherited state', async ({ page }) => {
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('test:set-failures', {detail:{save:1}})));
  await page.getByRole('button', {name:'Match alerts: Arsenal versus Chelsea, Team default'}).click();
  const menu = page.getByRole('dialog', {name:'Match alerts'});
  await menu.getByRole('button', {name:'On', exact:true}).click();
  await expect(menu.getByRole('status')).toHaveText('Could not save alert preference. Please try again.');
  await expect(menu.getByRole('button', {name:'Team default', exact:true})).toHaveAttribute('aria-pressed', 'true');
});

test('a successful queued alert save reports its own outcome after an earlier failure', async ({ page }) => {
  await installBridge(page, {saveDelayMs:150, failures:{save:1}});
  await page.reload();
  await page.getByRole('button', {name:'Match alerts: Arsenal versus Chelsea, Team default'}).click();
  const menu = page.getByRole('dialog', {name:'Match alerts'});
  await menu.getByRole('button', {name:'On', exact:true}).click();
  await menu.getByRole('button', {name:'Muted', exact:true}).click();
  await expect(menu.getByRole('status')).toHaveText('Match alerts: Muted.');
  await expect(menu.getByRole('button', {name:'Muted', exact:true})).toHaveAttribute('aria-pressed', 'true');
});

test('Following selection rolls back when its preference cannot be saved', async ({ page }) => {
  const tabs = page.locator('.match-list');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('test:set-failures', {detail:{save:1}})));
  await tabs.getByRole('button', {name:'Following only', exact:true}).click();
  await expect(page.getByText('Could not save settings. Please try again.', {exact:true})).toBeVisible();
  await expect(tabs.getByRole('button', {name:'All', exact:true})).toHaveAttribute('aria-pressed', 'true');
  await tabs.getByRole('button', {name:'Following only', exact:true}).click();
  await expect(tabs.getByRole('button', {name:'Following only', exact:true})).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('test:set-failures', {detail:{save:1}})));
  await tabs.getByRole('button', {name:'Following only', exact:true}).click();
  await expect(page.getByText('Could not save settings. Please try again.', {exact:true})).toBeVisible();
  await expect(tabs.getByRole('button', {name:'Following only', exact:true})).toHaveAttribute('aria-pressed', 'true');
});

test('reset confirmation moves and returns keyboard focus', async ({ page }) => {
  await page.getByRole('button', {name:'Match alerts: Arsenal versus Chelsea, Team default'}).click();
  await page.getByRole('dialog', {name:'Match alerts'}).getByRole('button', {name:'On', exact:true}).click();
  await page.getByRole('dialog', {name:'Match alerts'}).press('Escape');
  await page.getByRole('button', {name:'Settings', exact:true}).click();
  await page.getByRole('tab', {name:'Alerts'}).click();
  const trigger = page.getByRole('button', {name:'Reset match bells to team defaults'});
  await trigger.click();
  await expect(page.getByRole('button', {name:'Confirm reset'})).toBeFocused();
  await page.getByRole('button', {name:'Cancel', exact:true}).click();
  await expect(trigger).toBeFocused();
});

for (const colorScheme of ['dark', 'light'] as const) {
  test(`list, Settings and Match Centre pass axe in ${colorScheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('tab', { name: 'Appearance' }).click();
    await page.getByRole('combobox', { name: 'Theme' }).selectOption(colorScheme);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.getByRole('tab', { name: 'Alerts' }).click();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.getByRole('button', { name: 'Back to matches' }).click();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.getByRole('button', { name: /Match details:.*Arsenal.*Chelsea/ }).click();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
}
