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

test('the ticker stays inside the window at every reachable size', async ({ page }) => {
  await installBridge(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Ticker mode' }).click();
  // Ticker mode drops the minimum to 320x112 but maxHeight stays 1100, so every
  // size between is user-reachable; only 320x112 was previously covered.
  for (const size of [
    { width: 320, height: 112 },
    { width: 320, height: 200 },
    { width: 320, height: 460 },
    { width: 420, height: 112 },
    { width: 600, height: 1100 },
  ]) {
    await page.setViewportSize(size);
    await expect(page.locator('.ticker')).toBeVisible();
    const stage = await page.locator('.ticker-stage').boundingBox();
    expect(stage, `stage missing at ${size.width}x${size.height}`).toBeTruthy();
    expect(stage!.x).toBeGreaterThanOrEqual(0);
    expect(stage!.y).toBeGreaterThanOrEqual(0);
    expect(stage!.x + stage!.width).toBeLessThanOrEqual(size.width);
    expect(stage!.y + stage!.height).toBeLessThanOrEqual(size.height);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow, `horizontal overflow at ${size.width}x${size.height}`).toBe(false);
  }
});

test('tray Settings and match notifications expand the ticker to the requested destination', async ({ page }) => {
  await installBridge(page);
  await page.goto('/');
  const ticker = page.getByRole('button', { name: 'Ticker mode' });
  await ticker.click();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('test:emit', { detail: { event: 'open-settings' } })));
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Back to matches' }).click();
  await ticker.click();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('test:notification-click', { detail: 'demo-2' })));
  await expect(page.getByRole('tab', { name: 'Overview' })).toBeFocused();
  await expect(page.locator('.detail-hero')).toContainText('Liverpool');
  await expect(ticker).toHaveAttribute('aria-pressed', 'false');
});

test('every user-initiated ticker exit has exactly one focus writer - the pressed control', async ({ page }) => {
  // A claimed exit must suppress the transition effect's focus writer entirely.
  // Instrumented focus() calls catch a stray write even when Chromium's own
  // click focus or a later rAF would mask where it landed.
  await page.addInitScript(() => {
    const calls: string[] = [];
    const original = HTMLElement.prototype.focus;
    Reflect.set(window, '__FOCUS_CALLS__', calls);
    HTMLElement.prototype.focus = function (options?: FocusOptions) {
      calls.push(this.id || this.getAttribute('aria-label') || this.className.toString());
      return original.call(this, options);
    };
  });
  await installBridge(page);
  await page.goto('/');
  const ticker = page.getByRole('button', { name: 'Ticker mode' });
  const focusCalls = () => page.evaluate(() => Reflect.get(window, '__FOCUS_CALLS__') as string[]);
  for (let round = 0; round < 8; round++) {
    await ticker.click();
    await expect(page.locator('.ticker')).toBeVisible();
    await page.evaluate(() => (Reflect.get(window, '__FOCUS_CALLS__') as string[]).splice(0));
    await ticker.click();
    // A snapshot commit interleaved mid-exit used to resurrect the suppressed
    // writer: the claim died with its rAF, and a passive effect lagging the
    // frame then wrote #settings-control itself.
    if (round % 2 === 1)
      await page.evaluate(
        (snapshot) => window.dispatchEvent(new CustomEvent('test:set-snapshot', { detail: snapshot })),
        structuredClone(mockSnapshot),
      );
    // The exit plan is consumed by the transition effect as the only allowed
    // writer; a stray call to a card button or #settings-control fails here.
    await expect(ticker).toBeFocused();
    expect(await focusCalls(), `stray focus writer on toggle exit ${round}`).toEqual(['Ticker mode']);
  }
  // The ticker-card exit owns focus for the whole expansion into the match.
  for (let round = 0; round < 4; round++) {
    await ticker.click();
    await page.evaluate(() => (Reflect.get(window, '__FOCUS_CALLS__') as string[]).splice(0));
    await page.getByTitle('Open this match in MatchRadar').click();
    await expect(page.getByRole('tab', { name: 'Overview' })).toBeFocused();
    const calls = await focusCalls();
    expect(new Set(calls).size, `competing focus writers on card exit ${round}`).toBe(1);
    expect(calls[0], `focus did not land on the centre tab ${round}`).toContain('Overview');
  }
});

test('ticker browsing honors Following only and does not implicitly lock', async ({ page }) => {
  const snapshot = structuredClone(mockSnapshot);
  snapshot.settings.favorites = ['364', '382'];
  snapshot.settings.followedOnly = true;
  await installBridge(page, { snapshot });
  await page.goto('/');
  await page.getByRole('button', { name: 'Ticker mode' }).click();
  await expect(page.locator('.ticker-team.home')).toHaveText('LIV');
  await page.getByRole('button', { name: 'Next ticker match' }).click();
  await expect(page.locator('.ticker-team.home')).not.toHaveText('ARS');
  await expect(page.getByRole('button', { name: 'Lock ticker match' })).toHaveAttribute('aria-pressed', 'false');
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
