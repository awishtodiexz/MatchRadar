import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { installBridge } from './bridge';
import { mockSnapshot } from '../../src/test-fixtures/fixtures';

async function open(page: Page, width = 320, height = 460) {
  await page.setViewportSize({ width, height });
  await page.clock.install({ time: new Date('2026-10-29T12:00:00Z') });
  await page.route('https://**/*', (route) => route.abort());
  await installBridge(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: /Match details:.*Arsenal.*Chelsea/ })).toBeVisible();
}

test('a new fixture view or competition starts the list at the top', async ({ page }) => {
  await open(page);
  const list = page.locator('.match-list');
  await list.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  expect(await list.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Following only', exact: true }).click();
  await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBe(0);

  await page.getByRole('button', { name: 'Following only', exact: true }).click();
  await list.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  expect(await list.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await page.getByRole('button', { name: /Competition: Premier League/ }).click();
  await page.getByRole('option', { name: /Both competitions/ }).click();
  await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBe(0);
});

test('showing filtered-out matches returns keyboard focus to the first card', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 460 });
  await page.clock.install({ time: new Date('2026-10-29T12:00:00Z') });
  await page.route('https://**/*', (route) => route.abort());
  await installBridge(page, {
    snapshot: { ...mockSnapshot, settings: { ...mockSnapshot.settings, favorites: [], followedOnly: true } },
  });
  await page.goto('/');
  const show = page.getByRole('button', { name: 'Show all matches' });
  await show.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /Match details:.*Arsenal.*Chelsea/ })).toBeFocused();
});

test('startup says live status is being checked rather than unavailable', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 460 });
  await page.route('https://**/*', (route) => route.abort());
  await page.addInitScript(() => {
    Object.assign(window, {
      isTauri: true,
      __TAURI_INTERNALS__: {
        metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' } },
        transformCallback: () => 1,
        unregisterCallback: () => {},
        invoke: async (command: string) => {
          if (command === 'get_snapshot') return new Promise(() => {});
          if (command === 'plugin:event|listen') return 1;
          return null;
        },
      },
    });
  });
  await page.goto('/');
  await expect(page.getByLabel('Loading fixtures')).toBeVisible();
  await expect(page.locator('.live-pill')).toHaveText('CHECKING LIVE');
  await expect(page.locator('.live-pill')).toHaveAttribute('aria-label', /checking live status/);
  await expect(page.locator('footer')).toContainText('CONNECTING');
});

test('compact cards grow for long statuses instead of clipping them', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 460 });
  await page.clock.install({ time: new Date('2026-10-29T12:00:00Z') });
  await page.route('https://**/*', (route) => route.abort());
  const match = {
    ...mockSnapshot.matches[0],
    id: 'compact-tall',
    league: 'championsLeague' as const,
    competition: 'Champions League',
    status: 'unknown' as const,
    detail: 'Status unavailable',
    scoreStale: true,
    home: { id: '380', name: 'Wolverhampton Wanderers', short: 'WOL' },
    away: { id: '331', name: 'Brighton & Hove Albion', short: 'BHA' },
  };
  await installBridge(page, {
    snapshot: {
      ...mockSnapshot,
      settings: { ...mockSnapshot.settings, compact: true, competitionView: 'both' },
      matches: [match],
    },
  });
  await page.goto('/');
  const open = page.locator('.match-card .match-open').first();
  await expect(open).toBeVisible();
  expect(await open.evaluate((element) => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
  const status = page.locator('.match-card .fixture-time span').first();
  expect(await status.evaluate((element) => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
});

test('a failed first load offers an error state and retry', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 460 });
  await page.route('https://**/*', (route) => route.abort());
  await page.addInitScript(() => {
    Object.assign(window, {
      isTauri: true,
      __TAURI_INTERNALS__: {
        metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' } },
        transformCallback: () => 1,
        unregisterCallback: () => {},
        invoke: async (command: string) => {
          if (command === 'get_snapshot') throw new Error('Unavailable');
          if (command === 'plugin:event|listen') return 1;
          return null;
        },
      },
    });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Unable to load matches' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Could not load the widget state.');
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  await expect(page.locator('footer')).toContainText('NOT CONNECTED');
  await expect(page.locator('.error-banner')).toHaveCount(0);
});
