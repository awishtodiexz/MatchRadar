import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installBridge } from './bridge';
import { mockSnapshot, mockSnapshotWithUcl } from '../../src/test-fixtures/fixtures';
import { largeSnapshot } from '../fixtures/large';
import { matchesView } from '../../src/matchViews';
import type { Settings, Snapshot } from '../../src/types';

// Reliability journeys the happy-path suite never reaches: failed startup reads,
// failed refreshes with cached data, save failures (before and after the Rust
// write), the serialized save queue under latency, and bounded crest retries.
// The shared bridge aborts every remote image so these journeys are offline and
// deterministic; no test here depends on the real network.

interface BridgeStats {
  load: number;
  refresh: number;
  save: number;
  results: number;
  lastSavedSettings: Settings | null;
  commands: string[];
}
const stats = (page: Page) =>
  page.evaluate(() => (window as unknown as { __MATCHRADAR_BRIDGE_STATS__: BridgeStats }).__MATCHRADAR_BRIDGE_STATS__);
const setFailures = (page: Page, failures: { refresh?: number; load?: number; save?: number; results?: number }) =>
  page.evaluate((value) => window.dispatchEvent(new CustomEvent('test:set-failures', { detail: value })), failures);
const nextSnapshot = (page: Page, snapshot: Snapshot) =>
  page.evaluate(
    (value) => window.dispatchEvent(new CustomEvent('test:set-next-snapshot', { detail: value })),
    snapshot,
  );
const pushSnapshot = (page: Page, snapshot: Snapshot) =>
  page.evaluate((value) => window.dispatchEvent(new CustomEvent('test:set-snapshot', { detail: value })), snapshot);

const partialSnapshot = (): Snapshot => {
  const snapshot = structuredClone(mockSnapshot);
  snapshot.updatedAt = '2026-11-06T09:00:00Z';
  snapshot.fixtureUpdatedAt = '2026-11-06T09:00:00Z';
  snapshot.scoreError = 'HTTP 503';
  snapshot.error = 'Partial feed failure';
  snapshot.partial = true;
  snapshot.matches = snapshot.matches.map((match) =>
    match.status === 'live' || match.status === 'halftime' ? { ...match, scoreStale: true } : match,
  );
  return snapshot;
};

const recoveredSnapshot = (): Snapshot => {
  const snapshot = structuredClone(mockSnapshot);
  snapshot.updatedAt = '2026-11-06T09:05:00Z';
  snapshot.fixtureUpdatedAt = '2026-11-06T09:05:00Z';
  snapshot.scoreError = null;
  snapshot.fixtureError = null;
  snapshot.error = null;
  snapshot.partial = false;
  snapshot.matches = snapshot.matches.map((match) =>
    match.id === 'demo-1' ? { ...match, homeScore: 4, scoreStale: false } : { ...match, scoreStale: false },
  );
  return snapshot;
};

async function open(page: Page, options: Parameters<typeof installBridge>[1] = {}) {
  await page.route('https://**/*', (route) => route.abort());
  await installBridge(page, options);
  await page.goto('/');
}

const errorBanner = (page: Page) => page.getByRole('alert');
const offlineBanner = (page: Page) => page.locator('.offline-banner');

test('a failed startup read keeps an error visible and the footer refresh recovers the widget', async ({ page }) => {
  await open(page, { failures: { load: 1 } });
  await expect(errorBanner(page)).toHaveText(/Could not load the widget state/);
  await expect(page.getByRole('button', { name: /Match details:.*Arsenal.*Chelsea/ })).toHaveCount(0);
  expect((await stats(page)).load).toBe(1);

  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('button', { name: /Match details:.*Arsenal.*Chelsea/ })).toBeVisible();
  await expect(errorBanner(page)).toHaveCount(0);
  const after = await stats(page);
  expect(after.refresh).toBe(1);
  expect(after.load).toBe(2);
});

test('a failed refresh keeps cached cards and the next refresh clears the error', async ({ page }) => {
  await open(page);
  await expect(page.getByRole('button', { name: /Match details:.*Arsenal.*Chelsea/ })).toBeVisible();
  await setFailures(page, { refresh: 1 });

  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(errorBanner(page)).toHaveText(/Could not refresh matches/);
  await expect(page.getByRole('button', { name: /Match details:.*Arsenal.*Chelsea/ })).toBeVisible();

  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(errorBanner(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Match details:.*Arsenal.*Chelsea/ })).toBeVisible();
  expect((await stats(page)).refresh).toBe(2);
});

test('Retry on a partial feed requests a refresh and replaces saved scores with confirmed live scores', async ({
  page,
}) => {
  await open(page, { snapshot: partialSnapshot() });
  await expect(offlineBanner(page)).toContainText(/Partial update/);
  await expect(offlineBanner(page).getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  await expect(
    page.getByLabel(/Premier League: 4 in-progress matches, including saved scores awaiting confirmation/),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /Match details:.*Arsenal.*Chelsea/ })).toHaveAccessibleDescription(
    /2 to 1/,
  );

  await nextSnapshot(page, recoveredSnapshot());
  await offlineBanner(page).getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(offlineBanner(page)).toHaveCount(0);
  await expect(page.getByLabel(/Premier League: 4 live matches/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Match details:.*Arsenal.*Chelsea/ })).toHaveAccessibleDescription(
    /4 to 1/,
  );
  expect((await stats(page)).refresh).toBe(1);
});

test('a save failure after the native write reconciles the persisted preference instead of losing it', async ({
  page,
}) => {
  await open(page, { failures: { save: 1 }, savePersistsBeforeFail: true });
  const bell = page.locator('[data-match-id="demo-1"] .match-bell');
  await expect(bell).toHaveAttribute('data-alert-state', 'team');

  await bell.click();
  await page.getByRole('button', { name: 'On', exact: true }).click();
  await expect(errorBanner(page)).toHaveText(/Could not save settings/);
  // The IPC error happened after Rust persisted: the reconciliation read must surface it.
  await expect(bell).toHaveAttribute('data-alert-state', 'on');
  await expect(page.getByRole('button', { name: 'On', exact: true })).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'Muted', exact: true }).click();
  await expect(bell).toHaveAttribute('data-alert-state', 'muted');
  await expect(errorBanner(page)).toHaveCount(0);
  const after = await stats(page);
  expect(after.save).toBe(2);
  expect(after.lastSavedSettings?.matchAlerts['demo-1']?.enabled).toBe(false);
});

test('a rejected save rolls the optimistic bell back and a later retry succeeds', async ({ page }) => {
  await open(page, { failures: { save: 1 } });
  const bell = page.locator('[data-match-id="demo-1"] .match-bell');
  await bell.click();
  await page.getByRole('button', { name: 'On', exact: true }).click();
  await expect(errorBanner(page)).toHaveText(/Could not save settings/);
  await expect(bell).toHaveAttribute('data-alert-state', 'team');
  await expect(page.getByRole('button', { name: 'Team default', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: /Match details:.*Arsenal.*Chelsea/ })).toBeVisible();

  await page.getByRole('button', { name: 'On', exact: true }).click();
  await expect(errorBanner(page)).toHaveCount(0);
  await expect(bell).toHaveAttribute('data-alert-state', 'on');
  expect((await stats(page)).save).toBe(2);
});

test('rapid bell toggles stay serialized and the last persisted preference wins', async ({ page }) => {
  await open(page, { saveDelayMs: 150 });
  const bell = page.locator('[data-match-id="demo-1"] .match-bell');
  await bell.click();
  await page.getByRole('button', { name: 'On', exact: true }).click();
  await page.getByRole('button', { name: 'Muted', exact: true }).click();
  await page.getByRole('button', { name: 'On', exact: true }).click();

  await expect(bell).toHaveAttribute('data-alert-state', 'on');
  await expect.poll(async () => (await stats(page)).save).toBe(3);
  const after = await stats(page);
  // Every optimistic edit is submitted independently, in order, and none are lost.
  expect(after.lastSavedSettings?.matchAlerts['demo-1']?.enabled).toBe(true);
  expect(after.load).toBe(1);
  await expect(page.getByRole('button', { name: 'On', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('crest failures are attempted once per card and not re-requested by snapshot updates', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (/^https?:/i.test(request.url())) requests.push(request.url());
  });
  // One card isolates the two crest chains from every other fixture's badges.
  const single = structuredClone(mockSnapshot);
  single.matches = [single.matches[0]];
  await open(page, { snapshot: single });
  const firstCard = page.locator('[data-match-id="demo-1"]');
  await expect(page.getByRole('button', { name: /Match details:.*Arsenal.*Chelsea/ })).toBeVisible();
  // Every candidate for this card is aborted by the route, so the fallback replaces the images.
  await expect(firstCard.locator('img')).toHaveCount(0);
  const crestRequests = () => requests.filter((url) => /teamlogos\/soccer\/500(?:-dark)?\/(359|363)\.png/.test(url));
  const unique = [...new Set(crestRequests())];
  expect(crestRequests()).toHaveLength(unique.length);
  expect(unique.filter((url) => !url.startsWith('https://a.espncdn.com/'))).toEqual([]);
  // Privacy contract: the widget loads no third-party resource besides ESPN art.
  expect(
    requests.filter((url) => !url.startsWith('http://127.0.0.1') && !url.startsWith('https://a.espncdn.com/')),
  ).toEqual([]);
  // Arsenal and Chelsea: three candidates each in the dark theme.
  expect(unique).toHaveLength(6);
  const before = crestRequests().length;

  const updated = structuredClone(single);
  updated.matches = [{ ...single.matches[0], homeScore: 5 }];
  await pushSnapshot(page, updated);
  await expect(page.getByRole('button', { name: /Match details:.*Arsenal.*Chelsea/ })).toHaveAccessibleDescription(
    /5 to 1/,
  );
  await expect(firstCard.locator('img')).toHaveCount(0);
  // The refreshed snapshot must not restart the failed crest chain.
  expect(crestRequests()).toHaveLength(before);
});

for (const theme of ['dark', 'light'] as const) {
  test(`failure states keep no serious accessibility violations (${theme})`, async ({ page }) => {
    const themed = partialSnapshot();
    themed.settings = { ...themed.settings, theme };
    await open(page, { snapshot: themed, failures: { save: 1 } });
    const bell = page.locator('[data-match-id="demo-1"] .match-bell');
    const violations = async () =>
      (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations
        .filter((rule) => rule.impact === 'serious' || rule.impact === 'critical')
        .map((rule) => `${rule.id}: ${rule.nodes.map((node) => node.target.join(' ')).join(' | ')}`);

    expect(await violations()).toEqual([]);
    await expect(offlineBanner(page)).toBeVisible();
    await bell.click();
    await page.getByRole('button', { name: 'On', exact: true }).click();
    await expect(errorBanner(page)).toHaveText(/Could not save settings/);
    expect(await violations()).toEqual([]);
    await page.getByRole('button', { name: 'Dismiss message' }).click();
    await expect(errorBanner(page)).toHaveCount(0);
  });
}

test('a saved kickoff that cannot be parsed degrades one fixture instead of blanking the widget', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const snapshot = structuredClone(mockSnapshot);
  const broken = snapshot.matches.find((match) => match.status === 'scheduled')!;
  broken.kickoff = 'not-a-date';
  await open(page, { snapshot });

  await expect(page.getByRole('heading', { name: /DATE UNAVAILABLE/ })).toBeVisible();
  const card = page.getByRole('button', {
    name: new RegExp(`Match details:.*${broken.home.name}.*${broken.away.name}`),
  });
  await expect(card).toHaveAccessibleDescription(/Kick-off Time unavailable/);
  // Every healthy fixture is still rendered: one damaged record must not hide the feed.
  await expect(page.getByRole('button', { name: /Match details:.*Arsenal.*Chelsea/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test('a results refresh failure retains cached results and its Retry recovers', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Results', exact: true }).click();
  const resultCard = page.getByRole('button', { name: /Match details:.*Brighton & Hove Albion.*Everton/ });
  await expect(resultCard).toBeVisible();
  await page.getByRole('button', { name: 'All', exact: true }).click();

  await setFailures(page, { results: 1 });
  await page.getByRole('button', { name: 'Results', exact: true }).click();
  await expect(offlineBanner(page)).toContainText('Results update failed · cached results retained');
  await expect(resultCard).toBeVisible();

  await offlineBanner(page).getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(offlineBanner(page)).toHaveCount(0);
  await expect(resultCard).toBeVisible();
  expect((await stats(page)).results).toBe(3);
});

test('switching competition in Results shows a pending state instead of a false empty result', async ({ page }) => {
  await open(page, { snapshot: mockSnapshotWithUcl, resultsDelayMs: 250 });
  await page.getByRole('button', { name: 'Results', exact: true }).click();
  await expect(page.getByRole('button', { name: /Match details:.*Brighton & Hove Albion.*Everton/ })).toBeVisible();

  await page.getByRole('button', { name: /Change competition/ }).click();
  await page.getByRole('option', { name: /^Champions League/ }).click();
  await expect(page.getByRole('status', { name: 'Loading fixtures' })).toBeVisible();
  await expect(page.getByText('No recent results')).toBeVisible();
});

test('a notification for a match no longer cached explains the gap and keeps the widget usable', async ({ page }) => {
  await open(page, { notificationTarget: { requestId: 7, matchId: 'removed-fixture', match: null } });
  await expect(errorBanner(page)).toHaveText(/no longer in the local fixture cache/);
  await expect(page.getByRole('button', { name: /Match details:.*Arsenal.*Chelsea/ })).toBeVisible();
});

test('a season-density fixture list filters and navigates without losing focus', async ({ page }) => {
  const snapshot = largeSnapshot(240);
  const expectedFollowing = matchesView(snapshot.matches, 'All', snapshot.settings.favorites, true).length;
  await open(page, { snapshot });
  await expect(page.locator('.match-card')).toHaveCount(240);

  await page.getByRole('button', { name: 'Following only', exact: true }).click();
  await expect(page.locator('.match-card')).toHaveCount(expectedFollowing);
  const first = page.getByRole('button', { name: /^Match details:/ }).first();
  await first.scrollIntoViewIfNeeded();
  await first.click();
  await expect(page.getByRole('heading', { name: 'Match details' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(first).toBeFocused();
});

test('a complete mocked journey raises no uncaught page or console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    // Aborted crest/logo images log resource errors by design in these offline journeys.
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource'))
      errors.push(`console: ${message.text()}`);
  });
  await open(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  for (const tab of ['Teams', 'Appearance', 'Alerts', 'App']) {
    await page.getByRole('tab', { name: tab, exact: true }).click();
    await expect(page.getByRole('tabpanel', { name: tab, exact: true })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Back to matches' }).click();
  await page.getByRole('button', { name: /Match details:.*Arsenal.*Chelsea/ }).click();
  for (const tab of ['Overview', 'Commentary', 'Stats', 'Lineups']) {
    await page.getByRole('tab', { name: tab, exact: true }).click();
    await expect(page.getByRole('tabpanel', { name: tab, exact: true })).toBeVisible();
  }
  await page.keyboard.press('Escape');
  await page.locator('[data-match-id="demo-1"] .match-bell').click();
  await page.getByRole('button', { name: 'On', exact: true }).click();
  await expect(page.locator('[data-match-id="demo-1"] .match-bell')).toHaveAttribute('data-alert-state', 'on');
  await page.getByRole('button', { name: 'Results', exact: true }).click();
  await expect(page.getByRole('button', { name: /Match details:.*Brighton & Hove Albion.*Everton/ })).toBeVisible();
  expect(errors).toEqual([]);
});
