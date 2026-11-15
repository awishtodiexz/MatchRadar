import { test, expect } from '@playwright/test';
import { installBridge } from './bridge';
import { mockSnapshot } from '../../src/test-fixtures/fixtures';
import { matchesView } from '../../src/matchViews';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 460 });
  await page.clock.install({ time: new Date('2026-11-14T12:00:00Z') });
  await page.route('https://**/*', (route) => route.abort());
});

test('Following combines with every view and its counts, including historical results', async ({ page }) => {
  const snapshot = structuredClone(mockSnapshot);
  snapshot.settings.favorites = ['359', '382', '331'];
  await installBridge(page, { snapshot });
  await page.goto('/');
  const following = page.getByRole('button', { name: 'Following only', exact: true });
  await following.click();
  for (const view of ['Live', 'Upcoming', 'Results', 'All'] as const) {
    await page.getByRole('button', { name: view, exact: true }).click();
    const expected = matchesView(snapshot.matches, view, snapshot.settings.favorites, true);
    await expect(page.locator('.match-card')).toHaveCount(expected.length);
    await expect(page.getByRole('button', { name: view, exact: true })).toHaveAttribute(
      'title',
      `${expected.length} ${expected.length === 1 ? 'match' : 'matches'}`,
    );
    await expect(following).toHaveAttribute('aria-pressed', 'true');
  }
  await page.getByRole('button', { name: 'Results', exact: true }).click();
  await following.click();
  await expect(page.getByRole('button', { name: 'Results', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.match-card')).toHaveCount(
    snapshot.matches.filter((match) => match.status === 'fulltime').length,
  );
});

test('ticker prioritizes followed clubs, cycles, locks across updates, and fits the slim window', async ({ page }) => {
  const snapshot = structuredClone(mockSnapshot);
  snapshot.settings.favorites = ['364'];
  await installBridge(page, { snapshot });
  await page.goto('/');
  await page.getByRole('button', { name: 'Ticker mode' }).click();
  await page.setViewportSize({ width: 320, height: 112 });
  await expect(page.locator('.header-actions button')).toHaveCount(4);
  await expect(
    page.getByRole('region', { name: 'Match ticker' }).getByRole('button', { name: 'Next ticker match' }),
  ).toBeVisible();
  await expect(page.locator('.ticker-team.home')).toHaveText('LIV');
  const lock = page.getByRole('button', { name: 'Lock ticker match' });
  await lock.click();
  await expect(lock).toHaveAttribute('aria-pressed', 'true');
  const saved = structuredClone(snapshot);
  saved.matches = saved.matches.map((match) => (match.id === 'demo-2' ? { ...match, scoreStale: true } : match));
  await page.evaluate(
    (snapshot) => window.dispatchEvent(new CustomEvent('test:set-snapshot', { detail: snapshot })),
    saved,
  );
  await expect(page.locator('.ticker-meta')).toContainText('SAVED');
  await expect(page.locator('.ticker .dot')).toHaveCount(0);
  const ended = structuredClone(snapshot);
  ended.matches = ended.matches.map((match) =>
    match.id === 'demo-2' ? { ...match, status: 'fulltime', homeScore: 3, awayScore: 1 } : match,
  );
  await page.evaluate(
    (snapshot) => window.dispatchEvent(new CustomEvent('test:set-snapshot', { detail: snapshot })),
    ended,
  );
  await expect(page.locator('.ticker-team.home')).toHaveText('LIV');
  await expect(page.locator('.ticker-score')).toHaveText('3 – 1');
  await expect(page.locator('.ticker-meta')).toHaveText('FT');
  await page.evaluate(
    (snapshot) =>
      window.dispatchEvent(
        new CustomEvent('test:set-snapshot', {
          detail: { ...snapshot, matches: snapshot.matches.filter((match) => match.id !== 'demo-2') },
        }),
      ),
    ended,
  );
  await expect(page.locator('.ticker-score')).toHaveText('3 – 1');
  await page.getByRole('button', { name: 'Next ticker match' }).click();
  await expect(page.locator('.ticker-team.home')).toHaveText('ARS');
  await page.getByRole('button', { name: 'Previous ticker match' }).click();
  await expect(lock).toHaveAttribute('aria-pressed', 'true');
  const overflow = await page.locator('.shell').evaluate((shell) =>
    [...shell.querySelectorAll('button')].some((button) => {
      const rect = button.getBoundingClientRect();
      return rect.left < 0 || rect.right > innerWidth || rect.top < 0 || rect.bottom > innerHeight;
    }),
  );
  expect(overflow).toBe(false);
  const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(accessibility.violations.filter((rule) => rule.impact === 'serious' || rule.impact === 'critical')).toEqual(
    [],
  );
  await page.locator('.shell').hover({ position: { x: 5, y: 80 } });
  await page.screenshot({ path: 'verification/artifacts/ticker.png' });
  await lock.click();
  await expect(lock).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.ticker-team.home')).toHaveText('ARS');
  // The ticker card opens the match it shows; Back returns to the list.
  await page.getByTitle('Open this match in MatchRadar').click();
  await page.setViewportSize({ width: 320, height: 460 });
  await page.getByRole('button', { name: 'Back to matches', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Fixture views' })).toBeVisible();
});

test('footer refresh updates open match details and scores without leaving Stats', async ({ page }) => {
  await installBridge(page);
  await page.goto('/');
  await page.getByRole('button', { name: /Match details:.*Arsenal.*Chelsea/ }).click();
  await page.getByRole('tab', { name: 'Stats', exact: true }).click();
  const refresh = page.getByRole('button', { name: 'Refresh', exact: true });
  await expect(refresh).toBeEnabled();
  await expect(refresh).toHaveAttribute('title', 'Refresh match details and scores');
  await refresh.click();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, '__MATCHRADAR_BRIDGE_STATS__').detailsForced))
    .toBe(1);
  await expect.poll(() => page.evaluate(() => Reflect.get(window, '__MATCHRADAR_BRIDGE_STATS__').refresh)).toBe(1);
  await expect(page.getByRole('tab', { name: 'Stats', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(refresh).toBeEnabled();
});

test('footer refresh bypasses the Results cache instead of refreshing the fixture feed', async ({ page }) => {
  await installBridge(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Results', exact: true }).click();
  const refresh = page.getByRole('button', { name: 'Refresh', exact: true });
  await expect(refresh).toBeEnabled();
  await expect(refresh).toHaveAttribute('title', 'Refresh results');
  await refresh.click();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, '__MATCHRADAR_BRIDGE_STATS__').resultsForced))
    .toBe(1);
  expect(await page.evaluate(() => Reflect.get(window, '__MATCHRADAR_BRIDGE_STATS__').refresh)).toBe(0);
  await expect(page.getByRole('button', { name: 'Results', exact: true })).toHaveAttribute('aria-pressed', 'true');
});
